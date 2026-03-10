"""Core session handler — manages the Gemini Live API event loop.

Handles audio forwarding, tool call interception, transcript extraction,
and mid-session system prompt swaps (lobby → paper).
"""

import asyncio
import base64
import json
import logging
import time
import uuid
from typing import Any

from fastapi import WebSocket
from google import genai
from google.genai import types

from prompts.lobby import LOBBY_SYSTEM_PROMPT

logger: logging.Logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Tool registry — start with a test echo tool, expand in later phases
# ---------------------------------------------------------------------------

async def echo_tool(message: str = "") -> dict[str, str]:
    """Test tool that echoes back the input."""
    return {"echo": message}


TOOL_REGISTRY: dict[str, Any] = {
    "echo": echo_tool,
}

TOOL_DECLARATIONS: list[types.FunctionDeclaration] = [
    types.FunctionDeclaration(
        name="echo",
        description="Test tool that echoes back a message. Use this to verify tool calling works.",
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "message": types.Schema(
                    type=types.Type.STRING,
                    description="The message to echo back",
                ),
            },
            required=["message"],
        ),
    ),
]

# Zotero write tools that need to be delegated to the frontend (Day 3+)
ZOTERO_WRITE_TOOLS: set[str] = {
    "annotate_zotero_pdf",
    "manage_tags",
    "manage_collection",
    "add_paper_to_zotero",
    "link_related_items",
    "trash_items",
}

# Per-session registry of pending Zotero write operations
# Key: request_id, Value: asyncio.Future
_pending_zotero: dict[str, asyncio.Future[dict[str, Any]]] = {}


# ---------------------------------------------------------------------------
# LiveConnectConfig builder
# ---------------------------------------------------------------------------

def build_live_config(system_prompt: str | None = None) -> types.LiveConnectConfig:
    """Build the LiveConnectConfig for a Gemini Live API session."""
    return types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        system_instruction=system_prompt or LOBBY_SYSTEM_PROMPT,
        tools=[
            types.Tool(function_declarations=TOOL_DECLARATIONS),
            types.Tool(google_search=types.GoogleSearch()),
        ],
        session_resumption=types.SessionResumptionConfig(),
        output_audio_transcription=types.AudioTranscriptionConfig(),
        input_audio_transcription=types.AudioTranscriptionConfig(),
    )


LIVE_MODEL: str = "gemini-2.5-flash-native-audio-latest"


# ---------------------------------------------------------------------------
# Main session loop
# ---------------------------------------------------------------------------

async def run_session(
    ws: WebSocket,
    client: genai.Client,
    config_msg: dict[str, Any],
) -> None:
    """Main event loop for a single WebSocket session.

    Connects to Gemini Live API and runs two concurrent tasks:
    - forward_user_to_gemini: reads from frontend WS, sends to Gemini
    - forward_gemini_to_user: reads from Gemini, handles tool calls, forwards to frontend
    """
    session_request_ids: set[str] = set()
    resumption_handle: str | None = None
    api_key: str = config_msg["gemini_api_key"]

    live_config: types.LiveConnectConfig = build_live_config()

    async with client.aio.live.connect(
        model=LIVE_MODEL, config=live_config
    ) as session:
        logger.info("Gemini Live session connected (model=%s)", LIVE_MODEL)

        async def forward_user_to_gemini() -> None:
            """Read from frontend WebSocket, send to Gemini Live session."""
            while True:
                raw_text: str = await ws.receive_text()
                raw: dict[str, Any] = json.loads(raw_text)
                msg_type: str = raw.get("type", "")

                if msg_type == "audio":
                    audio_bytes: bytes = base64.b64decode(raw["data"])
                    await session.send_realtime_input(
                        audio=types.Blob(
                            data=audio_bytes,
                            mime_type="audio/pcm;rate=16000",
                        )
                    )

                elif msg_type == "text":
                    content: str = raw.get("content", "")
                    await session.send_client_content(
                        turns=types.Content(
                            role="user",
                            parts=[types.Part(text=content)],
                        ),
                        turn_complete=True,
                    )

                elif msg_type == "paper_context":
                    # Day 3 — full implementation of handle_paper_load
                    logger.info(
                        "Paper context received: %s (stub — full impl Day 3)",
                        raw.get("paperKey", "unknown"),
                    )

                elif msg_type == "zotero_action_result":
                    resolve_zotero_result(raw)

                elif msg_type == "control":
                    action: str = raw.get("action", "")
                    logger.info("Control message: %s", action)

        async def forward_gemini_to_user() -> None:
            """Read from Gemini Live session, handle tool calls, forward to frontend."""
            nonlocal resumption_handle

            async for message in session.receive():
                # Audio data → forward to frontend
                if message.data:
                    encoded: str = base64.b64encode(message.data).decode()
                    await ws.send_json({
                        "type": "audio",
                        "data": encoded,
                    })

                # Tool calls → execute and respond
                if message.tool_call:
                    await handle_tool_calls(
                        ws, session, message.tool_call,
                        session_request_ids, api_key,
                    )

                # Server content (transcripts, interruptions)
                if message.server_content:
                    sc: Any = message.server_content

                    if hasattr(sc, "output_transcription") and sc.output_transcription:
                        await ws.send_json({
                            "type": "transcript",
                            "role": "model",
                            "text": sc.output_transcription.text,
                            "isFinal": True,
                        })

                    if hasattr(sc, "input_transcription") and sc.input_transcription:
                        await ws.send_json({
                            "type": "transcript",
                            "role": "user",
                            "text": sc.input_transcription.text,
                            "isFinal": True,
                        })

                    if hasattr(sc, "interrupted") and sc.interrupted:
                        logger.info("Model output interrupted (barge-in)")

                # Token usage → forward to frontend
                if message.usage_metadata:
                    total: int = getattr(
                        message.usage_metadata, "total_token_count", 0
                    )
                    await ws.send_json({
                        "type": "context_usage",
                        "totalTokens": total,
                        "maxTokens": 128000,
                    })

                # Session resumption handle
                if hasattr(message, "session_resumption_update") and message.session_resumption_update:
                    resumption_handle = getattr(
                        message.session_resumption_update, "new_handle", None
                    )
                    if resumption_handle:
                        logger.info("Session resumption handle received")

                # GoAway — server about to disconnect
                if hasattr(message, "go_away") and message.go_away:
                    logger.warning("Received GoAway — session will disconnect soon")
                    await ws.send_json({
                        "type": "session_status",
                        "status": "reconnecting",
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
            for task in done:
                if task.exception():
                    raise task.exception()  # type: ignore[misc]
        finally:
            # Cleanup orphaned Zotero futures for this session
            for rid in session_request_ids:
                future: asyncio.Future[dict[str, Any]] | None = _pending_zotero.pop(rid, None)
                if future and not future.done():
                    future.cancel()


# ---------------------------------------------------------------------------
# Tool call handling
# ---------------------------------------------------------------------------

async def handle_tool_calls(
    ws: WebSocket,
    session: Any,
    tool_call: Any,
    session_request_ids: set[str],
    api_key: str,
) -> None:
    """Execute tool calls and send responses back to Gemini."""
    responses: list[types.FunctionResponse] = []

    for fc in tool_call.function_calls:
        tool_id: str = str(uuid.uuid4())

        # Notify frontend: tool call starting
        await ws.send_json({
            "type": "tool_call",
            "toolName": fc.name,
            "status": "calling",
            "input": fc.args,
        })

        start: float = time.time()
        try:
            if fc.name == "google_search":
                # Google Search grounding fallback (March 5 bug workaround)
                search_client: genai.Client = genai.Client(api_key=api_key)
                search_resp = await search_client.aio.models.generate_content(
                    model="gemini-3.1-flash-lite",
                    contents=[{
                        "role": "user",
                        "parts": [{"text": fc.args.get("query", "")}],
                    }],
                    config=types.GenerateContentConfig(
                        tools=[types.Tool(google_search=types.GoogleSearch())],
                    ),
                )
                result: dict[str, Any] = {"answer": search_resp.text}

            elif fc.name in ZOTERO_WRITE_TOOLS:
                result = await delegate_to_frontend(
                    ws, fc.name, fc.args, session_request_ids
                )

            elif fc.name in TOOL_REGISTRY:
                tool_fn = TOOL_REGISTRY[fc.name]
                result = await tool_fn(**fc.args)

            else:
                result = {
                    "error": f"Unknown tool: {fc.name}. "
                    f"Available: {list(TOOL_REGISTRY.keys())}"
                }

            duration_ms: int = int((time.time() - start) * 1000)

            await ws.send_json({
                "type": "tool_call",
                "toolName": fc.name,
                "status": "done",
                "output": result,
                "durationMs": duration_ms,
            })

            responses.append(
                types.FunctionResponse(
                    name=fc.name, id=fc.id, response=result
                )
            )

        except Exception as e:
            duration_ms = int((time.time() - start) * 1000)
            logger.error("Tool %s failed: %s", fc.name, str(e))

            await ws.send_json({
                "type": "tool_call",
                "toolName": fc.name,
                "status": "error",
                "error": str(e),
                "durationMs": duration_ms,
            })

            responses.append(
                types.FunctionResponse(
                    name=fc.name, id=fc.id, response={"error": str(e)}
                )
            )

    # Send all tool responses back to Gemini
    await session.send_tool_response(function_responses=responses)


# ---------------------------------------------------------------------------
# Zotero frontend delegation (Day 3+)
# ---------------------------------------------------------------------------

class ToolError(Exception):
    """Raised when a tool call fails."""
    pass


async def delegate_to_frontend(
    ws: WebSocket,
    action: str,
    params: dict[str, Any],
    session_request_ids: set[str],
) -> dict[str, Any]:
    """Send a Zotero write action to the frontend, wait for result."""
    request_id: str = str(uuid.uuid4())
    loop: asyncio.AbstractEventLoop = asyncio.get_running_loop()
    future: asyncio.Future[dict[str, Any]] = loop.create_future()
    _pending_zotero[request_id] = future
    session_request_ids.add(request_id)

    await ws.send_json({
        "type": "zotero_action",
        "requestId": request_id,
        "action": action,
        "params": params,
    })

    try:
        result: dict[str, Any] = await asyncio.wait_for(future, timeout=10.0)
        return result
    except asyncio.TimeoutError:
        raise ToolError(
            f"Zotero plugin didn't respond within 10s — "
            f"is Zotero running? Is the tab in the foreground?"
        )
    finally:
        _pending_zotero.pop(request_id, None)


def resolve_zotero_result(msg: dict[str, Any]) -> None:
    """Called when the frontend sends a zotero_action_result message."""
    request_id: str = msg["requestId"]
    future: asyncio.Future[dict[str, Any]] | None = _pending_zotero.get(request_id)
    if future and not future.done():
        if msg.get("success"):
            future.set_result(msg.get("data", {}))
        else:
            future.set_exception(
                ToolError(msg.get("error", "Unknown Zotero error"))
            )
