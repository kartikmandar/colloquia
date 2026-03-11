"""Core session handler — thin WS-to-ADK adapter.

Manages the WebSocket connection and routes messages between the frontend
and ADK's runner.run_live() (voice) and runner.run_async() (text).
"""

import asyncio
import base64
import json
import logging
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect
from google.adk.agents.live_request_queue import LiveRequestQueue
from google.adk.runners import RunConfig
from google.genai import types

from agent_factory import SessionBundle, create_session_bundle
from config import MAX_RECONNECTS, TEXT_MODEL, TEXT_MODEL_FALLBACK
from prompts.lobby import LOBBY_SYSTEM_PROMPT
from prompts.paper import build_paper_prompt
from tools.local_tools import search_academic_papers, get_paper_recommendations
from tools.zotero_tools import create_zotero_tools, resolve_zotero_result

logger: logging.Logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Main session loop
# ---------------------------------------------------------------------------

async def run_session(
    ws: WebSocket,
    config_msg: dict[str, Any],
) -> None:
    """Main event loop for a single WebSocket session.

    Creates an ADK agent + runner, then runs voice via run_live() and
    text via run_async(). Supports session resumption on GoAway.
    """
    api_key: str = config_msg["gemini_api_key"]

    bundle: SessionBundle = await create_session_bundle(api_key=api_key, ws=ws)
    runner = bundle.runner
    session = bundle.session
    zotero_ctx = bundle.zotero_ctx

    resumption_handle: str | None = None
    reconnect_count: int = 0

    while reconnect_count <= MAX_RECONNECTS:
        should_reconnect: bool = False

        try:
            # Create LiveRequestQueue for bidirectional audio
            live_queue: LiveRequestQueue = LiveRequestQueue()

            # Build run config with audio settings
            run_config: RunConfig = RunConfig(
                response_modalities=[types.Modality.AUDIO],
                output_audio_transcription=types.AudioTranscriptionConfig(),
                input_audio_transcription=types.AudioTranscriptionConfig(),
                realtime_input_config=types.RealtimeInputConfig(
                    automatic_activity_detection=types.AutomaticActivityDetection(
                        disabled=False,
                        start_of_speech_sensitivity=types.StartSensitivity.START_SENSITIVITY_HIGH,
                        end_of_speech_sensitivity=types.EndSensitivity.END_SENSITIVITY_HIGH,
                        silence_duration_ms=300,
                    ),
                ),
                # Handle-based resumption only (transparent requires Vertex AI)
                session_resumption=types.SessionResumptionConfig(
                    handle=resumption_handle,
                ) if resumption_handle else None,
            )

            if reconnect_count > 0:
                logger.info(
                    "Reconnecting (attempt %d/%d), handle=%s",
                    reconnect_count, MAX_RECONNECTS,
                    "yes" if resumption_handle else "no",
                )
                await ws.send_json({
                    "type": "session_status",
                    "status": "connected",
                })

            # Gate that pauses audio streaming while tool calls are pending
            audio_gate: asyncio.Event = asyncio.Event()
            audio_gate.set()

            async def forward_user_to_gemini() -> None:
                """Read from frontend WS, push into LiveRequestQueue."""
                try:
                    while True:
                        raw_text: str = await ws.receive_text()
                        raw: dict[str, Any] = json.loads(raw_text)
                        msg_type: str = raw.get("type", "")

                        if msg_type == "audio":
                            await audio_gate.wait()
                            audio_bytes: bytes = base64.b64decode(raw["data"])
                            live_queue.send_realtime(
                                types.Blob(
                                    data=audio_bytes,
                                    mime_type="audio/pcm;rate=16000",
                                )
                            )

                        elif msg_type == "text":
                            text_content: str = raw.get("content", "")
                            # Run as task so the receive loop stays free to
                            # process zotero_action_result messages (avoids
                            # deadlock when tools delegate to frontend).
                            asyncio.create_task(handle_text_message(
                                ws, bundle, text_content, api_key
                            ))

                        elif msg_type == "paper_context":
                            await handle_paper_load(
                                ws, live_queue, raw, bundle
                            )

                        elif msg_type == "zotero_action_result":
                            resolve_zotero_result(raw, zotero_ctx)

                        elif msg_type == "control":
                            action: str = raw.get("action", "")
                            logger.info("Control message: %s", action)
                            if action == "switch_mode" and raw.get("mode") == "lobby":
                                await handle_switch_to_lobby(live_queue, bundle)
                                zotero_ctx.page_dimensions.clear()
                            elif action == "audio_stream_end":
                                # With automatic activity detection enabled,
                                # explicit activity control is not allowed.
                                # The server detects speech start/end automatically.
                                logger.info("audio_stream_end received (auto-detection handles this)")

                except WebSocketDisconnect:
                    logger.info("Frontend WebSocket disconnected")
                    return
                finally:
                    live_queue.close()

            async def forward_gemini_to_user() -> None:
                """Consume ADK events from run_live(), forward to frontend."""
                nonlocal resumption_handle, should_reconnect
                notified_tool_calls: set[str] = set()
                notified_tool_responses: set[str] = set()

                async for event in runner.run_live(
                    session=session,
                    live_request_queue=live_queue,
                    run_config=run_config,
                ):
                    # Audio data
                    if event.content and event.content.parts:
                        for part in event.content.parts:
                            if hasattr(part, 'inline_data') and part.inline_data and part.inline_data.data:
                                encoded: str = base64.b64encode(
                                    part.inline_data.data
                                ).decode()
                                await ws.send_json({
                                    "type": "audio",
                                    "data": encoded,
                                })
                            elif hasattr(part, 'text') and part.text and event.partial:
                                # Streaming text from model
                                pass

                    # Tool calls — ADK handles execution, we just notify frontend
                    if event.actions and event.actions.state_delta:
                        # State updates from tool callbacks
                        pass

                    # Transcripts
                    if event.output_transcription:
                        await ws.send_json({
                            "type": "transcript",
                            "role": "model",
                            "text": event.output_transcription.text,
                            "isFinal": True,
                        })

                    if event.input_transcription:
                        await ws.send_json({
                            "type": "transcript",
                            "role": "user",
                            "text": event.input_transcription.text,
                            "isFinal": True,
                        })

                    # Interruption (barge-in)
                    if event.interrupted:
                        logger.info("Model output interrupted (barge-in)")
                        await ws.send_json({"type": "interrupted"})

                    # Token usage
                    if event.usage_metadata:
                        total: int = getattr(
                            event.usage_metadata, "total_token_count", 0
                        )
                        await ws.send_json({
                            "type": "context_usage",
                            "totalTokens": total,
                            "maxTokens": 128000,
                        })

                    # Session resumption handle
                    if event.live_session_resumption_update:
                        new_handle: str | None = getattr(
                            event.live_session_resumption_update, "new_handle", None
                        )
                        if new_handle:
                            resumption_handle = new_handle
                            logger.info("Session resumption handle received")

                    # Tool call notifications to frontend (dedup by id/name)
                    if event.content and event.content.parts:
                        for part in event.content.parts:
                            if hasattr(part, 'function_call') and part.function_call:
                                fc = part.function_call
                                fc_id: str = getattr(fc, 'id', '') or fc.name
                                if fc_id not in notified_tool_calls:
                                    notified_tool_calls.add(fc_id)
                                    await ws.send_json({
                                        "type": "tool_call",
                                        "toolName": fc.name,
                                        "status": "calling",
                                        "input": fc.args,
                                    })
                            if hasattr(part, 'function_response') and part.function_response:
                                fr = part.function_response
                                fr_id: str = getattr(fr, 'id', '') or fr.name
                                if fr_id not in notified_tool_responses:
                                    notified_tool_responses.add(fr_id)
                                    await ws.send_json({
                                        "type": "tool_call",
                                        "toolName": fr.name,
                                        "status": "done",
                                        "output": fr.response,
                                    })

            # Run both tasks concurrently
            task_user: asyncio.Task[None] = asyncio.create_task(
                forward_user_to_gemini()
            )
            task_gemini: asyncio.Task[None] = asyncio.create_task(
                forward_gemini_to_user()
            )

            try:
                done, pending = await asyncio.wait(
                    [task_user, task_gemini],
                    return_when=asyncio.FIRST_COMPLETED,
                )
                for task in pending:
                    task.cancel()
                for task in pending:
                    try:
                        await task
                    except (asyncio.CancelledError, Exception):
                        pass
                for task in done:
                    if task.exception():
                        raise task.exception()  # type: ignore[misc]

                # If Gemini task ended (not frontend), reconnect
                if not should_reconnect and task_gemini in done:
                    if resumption_handle:
                        logger.info("Gemini session ended, reconnecting with handle")
                    else:
                        logger.info("Gemini session ended, reconnecting without handle")
                    should_reconnect = True
                elif task_user in done:
                    logger.info("Frontend task ended, not reconnecting")
            finally:
                if not should_reconnect:
                    zotero_ctx.cleanup()

        except Exception as e:
            logger.error("Session error: %s", str(e))
            if reconnect_count < MAX_RECONNECTS:
                should_reconnect = True
            else:
                zotero_ctx.cleanup()
                raise

        if should_reconnect:
            reconnect_count += 1
            logger.info(
                "Reconnecting in 1 second (attempt %d/%d)...",
                reconnect_count, MAX_RECONNECTS,
            )
            try:
                await ws.send_json({
                    "type": "session_status",
                    "status": "reconnecting",
                })
            except Exception:
                break
            await asyncio.sleep(1)
            continue
        else:
            break


# ---------------------------------------------------------------------------
# Paper context loading
# ---------------------------------------------------------------------------

async def handle_paper_load(
    ws: WebSocket,
    live_queue: LiveRequestQueue,
    raw: dict[str, Any],
    bundle: SessionBundle,
) -> None:
    """Load a paper into the session, switching to paper mode."""
    metadata: dict[str, Any] = raw.get("metadata", {})
    fulltext: str = raw.get("fulltext", "")
    annotations: list[dict[str, Any]] = raw.get("annotations", [])
    page_images: list[dict[str, Any]] = raw.get("pageImages", [])
    paper_key: str = raw.get("paperKey", "unknown")

    logger.info(
        "Loading paper: %s (%s) — %d chars, %d annotations, %d images",
        metadata.get("title", "Unknown"),
        paper_key,
        len(fulltext),
        len(annotations),
        len(page_images),
    )

    # Store page dimensions for annotation coordinate conversion
    bundle.zotero_ctx.page_dimensions.clear()
    for page_img in page_images:
        idx: int = page_img.get("pageIndex", 0)
        bundle.zotero_ctx.page_dimensions[idx] = {
            "width": float(page_img.get("width", 612)),
            "height": float(page_img.get("height", 792)),
        }

    # Build annotation summary
    annotation_summary: str = ""
    if annotations:
        summaries: list[str] = []
        for ann in annotations[:20]:
            ann_type: str = ann.get("type", "note")
            comment: str = ann.get("comment", "")
            text: str = ann.get("text", "")
            page: str = ann.get("pageLabel", "?")
            if comment or text:
                content: str = comment or text
                summaries.append(f"  - [{ann_type}] p.{page}: {content[:150]}")
        if summaries:
            annotation_summary = "User's existing annotations:\n" + "\n".join(summaries)

    pdf_attachment_key: str = metadata.get("pdfAttachmentKey", paper_key)

    # Update session state so dynamic_instruction picks up paper mode
    paper_context: dict[str, Any] = {
        "title": metadata.get("title", ""),
        "authors": ", ".join(metadata.get("authors", [])),
        "year": str(metadata.get("year", "")),
        "doi": metadata.get("doi", ""),
        "venue": metadata.get("journal", ""),
        "annotation_count": len(annotations),
        "note_count": 0,
        "pdf_attachment_key": pdf_attachment_key,
        "user_annotations_summary": annotation_summary,
    }

    # Update state via session service
    session = bundle.session
    session.state["session_mode"] = "paper"
    session.state["paper_context"] = paper_context

    # Inject paper content as user message via LiveRequestQueue
    context_parts: list[types.Part] = []

    # System prompt update
    paper_prompt: str = build_paper_prompt(**paper_context)
    context_parts.append(
        types.Part(text=f"[SYSTEM INSTRUCTION UPDATE]\n\n{paper_prompt}")
    )

    if fulltext:
        max_chars: int = 100_000
        truncated: str = fulltext[:max_chars]
        if len(fulltext) > max_chars:
            truncated += "\n\n[... text truncated for context window ...]"
        context_parts.append(
            types.Part(text=f"[PAPER FULL TEXT]\n\n{truncated}")
        )

    # Inject page images
    for page_img in page_images:
        image_b64: str = page_img.get("data", page_img.get("imageBase64", ""))
        page_idx: int = page_img.get("pageIndex", 0)
        if image_b64:
            img_width: float = float(page_img.get("width", 612))
            img_height: float = float(page_img.get("height", 792))
            context_parts.append(
                types.Part(
                    text=(
                        f"[PAGE {page_idx + 1} IMAGE — "
                        f"dimensions: {img_width:.0f}x{img_height:.0f} pts, "
                        f"pageIndex={page_idx}. "
                        f"Use annotate_zotero_pdf with this pageIndex to annotate regions.]"
                    )
                )
            )
            context_parts.append(
                types.Part(
                    inline_data=types.Blob(
                        data=base64.b64decode(image_b64),
                        mime_type="image/jpeg",
                    )
                )
            )

    if context_parts:
        live_queue.send_content(
            types.Content(role="user", parts=context_parts)
        )

    await ws.send_json({
        "type": "session_status",
        "status": "connected",
    })

    logger.info("Paper loaded successfully: %s", metadata.get("title", paper_key))


# ---------------------------------------------------------------------------
# Switch back to lobby mode
# ---------------------------------------------------------------------------

async def handle_switch_to_lobby(
    live_queue: LiveRequestQueue,
    bundle: SessionBundle,
) -> None:
    """Switch the session back to lobby mode."""
    bundle.session.state["session_mode"] = "lobby"
    bundle.session.state["paper_context"] = {}

    live_queue.send_content(
        types.Content(
            role="user",
            parts=[types.Part(text=f"[SYSTEM INSTRUCTION UPDATE]\n\n{LOBBY_SYSTEM_PROMPT}")],
        )
    )
    logger.info("Switched back to lobby mode")


# ---------------------------------------------------------------------------
# Text chat mode — uses raw genai SDK (text models don't support live audio model)
# ---------------------------------------------------------------------------

async def handle_text_message(
    ws: WebSocket,
    bundle: SessionBundle,
    content: str,
    api_key: str,
) -> None:
    """Handle a text chat message via streaming generateContent API.

    Uses the raw genai SDK since the live audio model doesn't support
    generateContent. Registers tools so Gemini can call Zotero, Semantic
    Scholar, etc. Handles multi-turn function calling automatically.
    """
    from google import genai

    await ws.send_json({"type": "text_response_start"})

    try:
        client: genai.Client = genai.Client(
            api_key=api_key,
            http_options={"timeout": 30000},
        )

        # Build system instruction from session state
        session_mode: str = bundle.session.state.get("session_mode", "lobby")
        if session_mode == "paper":
            paper_ctx: dict[str, Any] = bundle.session.state.get("paper_context", {})
            system_instruction: str = (
                f"You are Colloquia, an AI research assistant. "
                f"You are currently discussing the paper: {paper_ctx.get('title', 'Unknown')} "
                f"by {paper_ctx.get('authors', 'Unknown')} ({paper_ctx.get('year', '')}).\n"
                f"Provide helpful, precise responses in markdown format. "
                f"When deep analysis is needed, say so explicitly.\n\n"
                f"## Tools Available\n"
                f"- search_zotero_library — search the user's Zotero library\n"
                f"- search_academic_papers — search Semantic Scholar\n"
                f"- add_paper_to_zotero — add a paper (confirm first)\n"
                f"- get_paper_recommendations — find similar papers\n"
                f"- manage_tags, manage_collection — organize the library\n"
                f"- create_note — save notes to Zotero items\n"
                f"Use tools proactively when the user asks about their library or papers.\n\n"
                f"## CRITICAL Tool Usage Rules\n"
                f"Call each tool ONCE per turn. Never call the same tool multiple times "
                f"with different or similar parameters in a single response. One call with "
                f"broad parameters is enough."
            )
        else:
            system_instruction = LOBBY_SYSTEM_PROMPT

        # --- Build tool functions and lookup map ---
        zotero_tool_funcs: list[Any] = create_zotero_tools(ws, bundle.zotero_ctx)
        local_tool_funcs: list[Any] = [search_academic_papers, get_paper_recommendations]
        all_tool_funcs: list[Any] = zotero_tool_funcs + local_tool_funcs
        tool_map: dict[str, Any] = {func.__name__: func for func in all_tool_funcs}

        # Conversation history for multi-turn function calling
        context_contents: list[Any] = [
            genai.types.Content(
                role="user",
                parts=[genai.types.Part.from_text(text=content)],
            ),
        ]

        full_text: str = ""
        used_model: str = TEXT_MODEL
        max_tool_turns: int = 5
        # Track executed tool calls across all turns to prevent re-execution
        executed_tool_keys: set[str] = set()

        for model_name in (TEXT_MODEL, TEXT_MODEL_FALLBACK):
            try:
                logger.info("Trying text model: %s", model_name)
                used_model = model_name

                for _turn in range(max_tool_turns):
                    response_parts: list[Any] = []
                    function_calls: list[Any] = []
                    turn_text: str = ""

                    stream = await client.aio.models.generate_content_stream(
                        model=model_name,
                        contents=context_contents,
                        config=genai.types.GenerateContentConfig(
                            system_instruction=system_instruction,
                            temperature=0.7,
                            max_output_tokens=2048,
                            tools=all_tool_funcs,
                            automatic_function_calling=genai.types.AutomaticFunctionCallingConfig(
                                disable=True,
                            ),
                        ),
                    )

                    async for chunk in stream:
                        if not chunk.candidates:
                            continue
                        for part in chunk.candidates[0].content.parts:
                            response_parts.append(part)
                            if part.function_call:
                                function_calls.append(part.function_call)
                            elif part.text:
                                turn_text += part.text
                                full_text += part.text
                                await ws.send_json({
                                    "type": "text_response_chunk",
                                    "content": part.text,
                                    "model": model_name,
                                })

                    # If no function calls, we're done
                    if not function_calls:
                        break

                    # Append model response (with function call parts) to history
                    context_contents.append(
                        genai.types.Content(role="model", parts=response_parts)
                    )

                    # Deduplicate: mark which calls to actually execute vs skip.
                    # Use json.dumps for reliable protobuf MapComposite serialization.
                    # Strip empty/falsy values so {action:"list"} matches
                    # {action:"list", name:""}.
                    import json as _json

                    def _dedup_key(fc: Any) -> str:
                        try:
                            raw: dict[str, Any] = {
                                str(k): v for k, v in (fc.args.items() if fc.args else [])
                            }
                        except Exception:
                            raw = {}
                        normalized: dict[str, Any] = {k: v for k, v in raw.items() if v}
                        return f"{fc.name}:{_json.dumps(normalized, sort_keys=True)}"

                    # Execute each function call and collect results.
                    # Skipped duplicates still get a response part so Gemini's
                    # context stays consistent (one response per function_call).
                    function_response_parts: list[Any] = []
                    tool_result_cache: dict[str, dict[str, Any]] = {}
                    for fc in function_calls:
                        fn_name: str = fc.name
                        fn_args: dict[str, Any] = dict(fc.args) if fc.args else {}
                        key: str = _dedup_key(fc)

                        # If we already executed this exact call, reuse the
                        # cached result — no re-execution, no frontend badge.
                        if key in executed_tool_keys:
                            cached: dict[str, Any] = tool_result_cache.get(
                                key, {"result": "duplicate call skipped"}
                            )
                            logger.info("Skipping duplicate tool call: %s(%s)", fn_name, fn_args)
                            function_response_parts.append(
                                genai.types.Part.from_function_response(
                                    name=fn_name,
                                    response=cached if isinstance(cached, dict) else {"result": cached},
                                )
                            )
                            continue

                        executed_tool_keys.add(key)
                        logger.info("Text mode tool call: %s(%s)", fn_name, fn_args)

                        # Notify frontend about the tool call
                        await ws.send_json({
                            "type": "tool_call",
                            "toolName": fn_name,
                            "status": "calling",
                            "input": fn_args,
                        })

                        tool_failed: bool = False
                        try:
                            fn_callable = tool_map.get(fn_name)
                            if fn_callable is None:
                                result: dict[str, Any] = {"error": f"Unknown tool: {fn_name}"}
                                tool_failed = True
                            else:
                                result = await fn_callable(**fn_args)
                        except Exception as tool_err:
                            logger.warning("Tool %s failed: %s", fn_name, str(tool_err))
                            result = {"error": str(tool_err)}
                            tool_failed = True

                        # Cache the result for potential duplicate calls
                        tool_result_cache[key] = result if isinstance(result, dict) else {"result": result}

                        # Notify frontend about tool completion or error
                        try:
                            if tool_failed or "error" in result:
                                await ws.send_json({
                                    "type": "tool_call",
                                    "toolName": fn_name,
                                    "status": "error",
                                    "error": result.get("error", "Unknown error"),
                                })
                            else:
                                await ws.send_json({
                                    "type": "tool_call",
                                    "toolName": fn_name,
                                    "status": "done",
                                    "output": result,
                                })
                        except Exception:
                            pass  # WebSocket may already be closed

                        function_response_parts.append(
                            genai.types.Part.from_function_response(
                                name=fn_name,
                                response=result if isinstance(result, dict) else {"result": result},
                            )
                        )

                    # Append function results as a user turn
                    context_contents.append(
                        genai.types.Content(role="user", parts=function_response_parts)
                    )

                break  # Model succeeded, don't try fallback
            except Exception as model_err:
                logger.warning(
                    "Text model %s failed: %s: %s",
                    model_name, type(model_err).__name__, str(model_err),
                )
                if model_name == TEXT_MODEL_FALLBACK:
                    raise

        if not full_text:
            full_text = "I couldn't generate a response."
            await ws.send_json({
                "type": "text_response_chunk",
                "content": full_text,
                "model": used_model,
            })

        await ws.send_json({
            "type": "text_response_done",
            "model": used_model,
        })

    except Exception as e:
        logger.error("Text message handling failed: %s", str(e))
        try:
            await ws.send_json({
                "type": "error",
                "message": f"Text response failed: {str(e)}",
            })
        except Exception:
            logger.warning("Could not send error to frontend — WebSocket already closed")
