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

from fastapi import WebSocket, WebSocketDisconnect
from google import genai
from google.genai import types

from prompts.lobby import LOBBY_SYSTEM_PROMPT
from prompts.paper import build_paper_prompt
from tools.pdf_processing import gemini_to_pdf_coords, validate_annotation_coords
from tools.semantic_scholar import (
    search_academic_papers,
    get_paper_recommendations,
)
from tools.deep_analysis import deep_analysis
from conversation_state import ConversationState

logger: logging.Logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Tool registry — start with a test echo tool, expand in later phases
# ---------------------------------------------------------------------------

async def echo_tool(message: str = "") -> dict[str, str]:
    """Test tool that echoes back the input."""
    return {"echo": message}


TOOL_REGISTRY: dict[str, Any] = {
    "echo": echo_tool,
    "search_academic_papers": search_academic_papers,
    "get_paper_recommendations": get_paper_recommendations,
    "deep_analysis": deep_analysis,
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
    types.FunctionDeclaration(
        name="search_zotero_library",
        description=(
            "Search the user's Zotero library for papers by title, author, "
            "tag, or collection. Returns matching items with metadata."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "query": types.Schema(
                    type=types.Type.STRING,
                    description="Search text matching title, creator, or year",
                ),
                "tag": types.Schema(
                    type=types.Type.STRING,
                    description="Filter by tag name",
                ),
                "collection": types.Schema(
                    type=types.Type.STRING,
                    description="Filter by collection key",
                ),
                "author": types.Schema(
                    type=types.Type.STRING,
                    description="Filter by author name",
                ),
            },
        ),
    ),
    types.FunctionDeclaration(
        name="create_note",
        description=(
            "Create a note attached to a paper in Zotero. "
            "Use this to save discussion insights, analysis, or summaries."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "parentItemKey": types.Schema(
                    type=types.Type.STRING,
                    description="Zotero item key of the parent paper",
                ),
                "noteContent": types.Schema(
                    type=types.Type.STRING,
                    description="HTML content for the note",
                ),
                "tags": types.Schema(
                    type=types.Type.ARRAY,
                    items=types.Schema(type=types.Type.STRING),
                    description="Tags to add to the note",
                ),
            },
            required=["parentItemKey", "noteContent"],
        ),
    ),
    types.FunctionDeclaration(
        name="manage_tags",
        description=(
            "Add or remove tags on one or more Zotero items. "
            "Always confirm with the user before applying."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "action": types.Schema(
                    type=types.Type.STRING,
                    description="'add' or 'remove'",
                ),
                "itemKeys": types.Schema(
                    type=types.Type.ARRAY,
                    items=types.Schema(type=types.Type.STRING),
                    description="Zotero item keys to modify",
                ),
                "tags": types.Schema(
                    type=types.Type.ARRAY,
                    items=types.Schema(type=types.Type.STRING),
                    description="Tags to add or remove",
                ),
            },
            required=["action", "itemKeys", "tags"],
        ),
    ),
    types.FunctionDeclaration(
        name="link_related_items",
        description=(
            "Create a bidirectional 'related' link between two papers in Zotero."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "itemKey1": types.Schema(
                    type=types.Type.STRING,
                    description="First item key",
                ),
                "itemKey2": types.Schema(
                    type=types.Type.STRING,
                    description="Second item key",
                ),
            },
            required=["itemKey1", "itemKey2"],
        ),
    ),
    types.FunctionDeclaration(
        name="annotate_zotero_pdf",
        description=(
            "Create a visual annotation on the PDF in Zotero's reader. "
            "Use this when discussing a specific figure, equation, table, or text region "
            "to highlight it for the user. Annotations appear live in Zotero."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "parentItemKey": types.Schema(
                    type=types.Type.STRING,
                    description="Zotero item key of the PDF attachment or parent item",
                ),
                "annotationType": types.Schema(
                    type=types.Type.STRING,
                    description="Type of annotation: 'highlight', 'image', or 'note'",
                ),
                "pageIndex": types.Schema(
                    type=types.Type.INTEGER,
                    description="Zero-indexed page number",
                ),
                "boundingBox": types.Schema(
                    type=types.Type.ARRAY,
                    items=types.Schema(type=types.Type.INTEGER),
                    description=(
                        "Bounding box as [y_min, x_min, y_max, x_max] in 0-1000 coordinate space. "
                        "Origin is top-left. Will be converted to PDF coordinates."
                    ),
                ),
                "comment": types.Schema(
                    type=types.Type.STRING,
                    description="Text comment for the annotation",
                ),
            },
            required=["parentItemKey", "annotationType", "pageIndex", "boundingBox", "comment"],
        ),
    ),
    types.FunctionDeclaration(
        name="search_academic_papers",
        description=(
            "Search Semantic Scholar for academic papers by query. "
            "Returns titles, authors, years, citation counts, DOIs, and abstracts. "
            "Use this to help users discover papers not in their Zotero library."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "query": types.Schema(
                    type=types.Type.STRING,
                    description="Search query (keywords, topic, etc.)",
                ),
                "year": types.Schema(
                    type=types.Type.STRING,
                    description="Year range filter, e.g. '2020-2024' or '2023'",
                ),
                "limit": types.Schema(
                    type=types.Type.INTEGER,
                    description="Max results to return (default 5, max 100)",
                ),
            },
            required=["query"],
        ),
    ),
    types.FunctionDeclaration(
        name="get_paper_recommendations",
        description=(
            "Get paper recommendations based on a seed paper from Semantic Scholar. "
            "Provide the Semantic Scholar paper ID to find similar papers."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "paper_id": types.Schema(
                    type=types.Type.STRING,
                    description="Semantic Scholar paper ID (or 'DOI:10.xxx/yyy' format)",
                ),
                "limit": types.Schema(
                    type=types.Type.INTEGER,
                    description="Max recommendations to return (default 5)",
                ),
            },
            required=["paper_id"],
        ),
    ),
    types.FunctionDeclaration(
        name="deep_analysis",
        description=(
            "Perform deep, thorough analysis of paper content, methodology, or comparisons. "
            "Delegates to a more powerful model for complex reasoning tasks. "
            "Use when the user asks for critique, methodology review, or detailed comparison."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "query": types.Schema(
                    type=types.Type.STRING,
                    description="The specific analysis question or task",
                ),
                "context": types.Schema(
                    type=types.Type.STRING,
                    description="Relevant context from the conversation or paper content",
                ),
            },
            required=["query", "context"],
        ),
    ),
    types.FunctionDeclaration(
        name="manage_collection",
        description=(
            "Manage Zotero collections: list all collections, create a new collection, "
            "add items to a collection, or remove items from a collection. "
            "Always confirm with the user before modifying."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "action": types.Schema(
                    type=types.Type.STRING,
                    description="'list', 'create', 'addItems', or 'removeItems'",
                ),
                "name": types.Schema(
                    type=types.Type.STRING,
                    description="Collection name (for 'create' action)",
                ),
                "collectionKey": types.Schema(
                    type=types.Type.STRING,
                    description="Collection key (for addItems/removeItems)",
                ),
                "itemKeys": types.Schema(
                    type=types.Type.ARRAY,
                    items=types.Schema(type=types.Type.STRING),
                    description="Item keys to add/remove (for addItems/removeItems)",
                ),
                "parentCollectionKey": types.Schema(
                    type=types.Type.STRING,
                    description="Parent collection key (for 'create' action, optional)",
                ),
            },
            required=["action"],
        ),
    ),
    types.FunctionDeclaration(
        name="trash_items",
        description=(
            "Move Zotero items to the trash. This is recoverable — items can be restored from trash. "
            "Always confirm with the user before trashing items."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "itemKeys": types.Schema(
                    type=types.Type.ARRAY,
                    items=types.Schema(type=types.Type.STRING),
                    description="Zotero item keys to move to trash",
                ),
            },
            required=["itemKeys"],
        ),
    ),
    types.FunctionDeclaration(
        name="add_paper_to_zotero",
        description=(
            "Add a discovered paper to the user's Zotero library. "
            "Provide a DOI for best results (automatic metadata lookup). "
            "Always confirm with the user before adding."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "doi": types.Schema(
                    type=types.Type.STRING,
                    description="Paper DOI for automatic metadata import",
                ),
                "title": types.Schema(
                    type=types.Type.STRING,
                    description="Paper title (fallback if DOI lookup fails)",
                ),
                "authors": types.Schema(
                    type=types.Type.STRING,
                    description="Comma-separated author names (fallback)",
                ),
                "url": types.Schema(
                    type=types.Type.STRING,
                    description="Paper URL (fallback)",
                ),
                "abstract": types.Schema(
                    type=types.Type.STRING,
                    description="Paper abstract (fallback)",
                ),
                "collectionKey": types.Schema(
                    type=types.Type.STRING,
                    description="Optional Zotero collection key to add the paper to",
                ),
            },
        ),
    ),
]

# Zotero tools that need to be delegated to the frontend
# (executed via the Colloquia Zotero plugin running on the user's machine)
ZOTERO_WRITE_TOOLS: set[str] = {
    "search_zotero_library",
    "create_note",
    "annotate_zotero_pdf",
    "manage_tags",
    "manage_collection",
    "add_paper_to_zotero",
    "link_related_items",
    "trash_items",
}

# Map Gemini tool names (snake_case) → Zotero plugin endpoint names (camelCase)
ZOTERO_TOOL_TO_ENDPOINT: dict[str, str] = {
    "search_zotero_library": "searchLibrary",
    "create_note": "createNote",
    "add_paper_to_zotero": "addPaper",
    "link_related_items": "addRelated",
    "trash_items": "trashItems",
}

# Per-session registry of pending Zotero write operations
# Key: request_id, Value: asyncio.Future
_pending_zotero: dict[str, asyncio.Future[dict[str, Any]]] = {}

# Per-session page dimensions from loaded PDF (populated by handle_paper_load)
# Key: page_index (0-based), Value: {"width": float, "height": float}
_page_dimensions: dict[int, dict[str, float]] = {}


# ---------------------------------------------------------------------------
# LiveConnectConfig builder
# ---------------------------------------------------------------------------

def build_live_config(
    system_prompt: str | None = None,
    resumption_handle: str | None = None,
) -> types.LiveConnectConfig:
    """Build the LiveConnectConfig for a Gemini Live API session.

    Args:
        system_prompt: Optional system prompt override (defaults to LOBBY_SYSTEM_PROMPT).
        resumption_handle: Optional session resumption handle for reconnection.
    """
    session_resumption: types.SessionResumptionConfig = types.SessionResumptionConfig()
    if resumption_handle:
        session_resumption = types.SessionResumptionConfig(
            handle=resumption_handle,
        )

    return types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        system_instruction=system_prompt or LOBBY_SYSTEM_PROMPT,
        tools=[
            types.Tool(function_declarations=TOOL_DECLARATIONS),
            types.Tool(google_search=types.GoogleSearch()),
        ],
        session_resumption=session_resumption,
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

    Supports session resumption: when a GoAway message is received from the
    server, the session reconnects using the stored resumption handle, up to
    ``max_reconnects`` times.
    """
    session_request_ids: set[str] = set()
    resumption_handle: str | None = None
    api_key: str = config_msg["gemini_api_key"]
    s2_api_key: str | None = config_msg.get("s2_api_key")
    conversation_state: ConversationState = ConversationState()
    should_reconnect: bool = False
    max_reconnects: int = 5
    reconnect_count: int = 0

    while reconnect_count <= max_reconnects:
        live_config: types.LiveConnectConfig = build_live_config(
            resumption_handle=resumption_handle,
        )

        if resumption_handle:
            logger.info(
                "Reconnecting with resumption handle (attempt %d/%d)",
                reconnect_count, max_reconnects,
            )

        should_reconnect = False

        try:
            async with client.aio.live.connect(
                model=LIVE_MODEL, config=live_config
            ) as session:
                logger.info("Gemini Live session connected (model=%s)", LIVE_MODEL)

                if reconnect_count > 0:
                    await ws.send_json({
                        "type": "session_status",
                        "status": "connected",
                    })

                async def forward_user_to_gemini() -> None:
                    """Read from frontend WebSocket, send to Gemini Live session."""
                    try:
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
                                text_content: str = raw.get("content", "")
                                # Route text through the generateContent text handler
                                await handle_text_message(
                                    ws, text_content, api_key, conversation_state
                                )

                            elif msg_type == "paper_context":
                                await handle_paper_load(ws, session, raw, conversation_state)

                            elif msg_type == "zotero_action_result":
                                resolve_zotero_result(raw)

                            elif msg_type == "control":
                                action: str = raw.get("action", "")
                                logger.info("Control message: %s", action)
                                if action == "switch_mode" and raw.get("mode") == "lobby":
                                    await handle_switch_to_lobby(session)
                                    _page_dimensions.clear()
                                elif action == "audio_stream_end":
                                    await session.send_realtime_input(audio_stream_end=True)
                                    logger.info("Sent audio_stream_end to flush cached audio")
                    except WebSocketDisconnect:
                        logger.info("Frontend WebSocket disconnected")
                        return

                async def forward_gemini_to_user() -> None:
                    """Read from Gemini Live session, handle tool calls, forward to frontend."""
                    nonlocal resumption_handle, should_reconnect

                    async for message in session.receive():
                        # Audio data -> forward to frontend
                        if message.data:
                            encoded: str = base64.b64encode(message.data).decode()
                            await ws.send_json({
                                "type": "audio",
                                "data": encoded,
                            })

                        # Tool calls -> execute and respond
                        if message.tool_call:
                            await handle_tool_calls(
                                ws, session, message.tool_call,
                                session_request_ids, api_key,
                                s2_api_key=s2_api_key,
                                conversation_state=conversation_state,
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
                                conversation_state.add_message("assistant", sc.output_transcription.text)

                            if hasattr(sc, "input_transcription") and sc.input_transcription:
                                await ws.send_json({
                                    "type": "transcript",
                                    "role": "user",
                                    "text": sc.input_transcription.text,
                                    "isFinal": True,
                                })
                                conversation_state.add_message("user", sc.input_transcription.text)

                            if hasattr(sc, "interrupted") and sc.interrupted:
                                logger.info("Model output interrupted (barge-in)")
                                await ws.send_json({"type": "interrupted"})

                        # Token usage -> forward to frontend
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
                            logger.warning("Received GoAway — will reconnect with resumption handle")
                            await ws.send_json({
                                "type": "session_status",
                                "status": "reconnecting",
                            })
                            if resumption_handle:
                                should_reconnect = True
                                return  # Exit the receive loop to trigger reconnection

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
                    # If Gemini session ended normally (not GoAway) and we
                    # have a resumption handle, auto-reconnect to preserve context
                    if resumption_handle and not should_reconnect:
                        if task_gemini in done and not task_gemini.exception():
                            logger.info("Gemini session ended, reconnecting with resumption handle")
                            should_reconnect = True
                finally:
                    if not should_reconnect:
                        # Cleanup orphaned Zotero futures only on actual exit
                        for rid in session_request_ids:
                            future: asyncio.Future[dict[str, Any]] | None = _pending_zotero.pop(rid, None)
                            if future and not future.done():
                                future.cancel()

        except Exception as e:
            logger.error("Session error: %s", str(e))
            if resumption_handle and reconnect_count < max_reconnects:
                should_reconnect = True
            else:
                # Cleanup orphaned Zotero futures before raising
                for rid in session_request_ids:
                    future_cleanup: asyncio.Future[dict[str, Any]] | None = _pending_zotero.pop(rid, None)
                    if future_cleanup and not future_cleanup.done():
                        future_cleanup.cancel()
                raise

        if should_reconnect:
            reconnect_count += 1
            logger.info(
                "Reconnecting in 1 second (attempt %d/%d)...",
                reconnect_count, max_reconnects,
            )
            await asyncio.sleep(1)  # Brief pause before reconnect
            continue
        else:
            break


# ---------------------------------------------------------------------------
# Paper context loading
# ---------------------------------------------------------------------------

async def handle_paper_load(
    ws: WebSocket,
    session: Any,
    raw: dict[str, Any],
    conversation_state: ConversationState | None = None,
) -> None:
    """Load a paper into the session, swapping to paper mode.

    Receives paper_context message with fulltext, metadata, annotations,
    and optional page images. Swaps the system prompt and injects the
    paper content as structured context turns.
    """
    paper_key: str = raw.get("paperKey", "unknown")
    metadata: dict[str, Any] = raw.get("metadata", {})
    fulltext: str = raw.get("fulltext", "")
    annotations: list[dict[str, Any]] = raw.get("annotations", [])
    page_images: list[dict[str, Any]] = raw.get("pageImages", [])

    logger.info(
        "Loading paper: %s (%s) — %d chars fulltext, %d annotations, %d page images",
        metadata.get("title", "Unknown"),
        paper_key,
        len(fulltext),
        len(annotations),
        len(page_images),
    )

    # Store page dimensions for annotation coordinate conversion
    _page_dimensions.clear()
    for page_img in page_images:
        idx: int = page_img.get("pageIndex", 0)
        _page_dimensions[idx] = {
            "width": float(page_img.get("width", 612)),
            "height": float(page_img.get("height", 792)),
        }

    # Build annotation summary for the prompt
    annotation_summary: str = ""
    if annotations:
        summaries: list[str] = []
        for ann in annotations[:20]:  # Limit to 20 annotations
            ann_type: str = ann.get("type", "note")
            comment: str = ann.get("comment", "")
            text: str = ann.get("text", "")
            page: str = ann.get("pageLabel", "?")
            if comment or text:
                content: str = comment or text
                summaries.append(f"  - [{ann_type}] p.{page}: {content[:150]}")
        if summaries:
            annotation_summary = "User's existing annotations:\n" + "\n".join(summaries)

    # Find PDF attachment key from metadata or annotations
    pdf_attachment_key: str = metadata.get("pdfAttachmentKey", paper_key)

    # Build paper system prompt
    paper_prompt: str = build_paper_prompt(
        title=metadata.get("title", ""),
        authors=", ".join(metadata.get("authors", [])),
        year=str(metadata.get("year", "")),
        doi=metadata.get("doi", ""),
        venue=metadata.get("journal", ""),
        annotation_count=len(annotations),
        note_count=0,
        pdf_attachment_key=pdf_attachment_key,
        user_annotations_summary=annotation_summary,
    )

    # Swap system prompt via send_client_content with role="system"
    # turn_complete=False so Gemini doesn't auto-respond to context injection
    await session.send_client_content(
        turns=types.Content(
            role="user",
            parts=[types.Part(text=f"[SYSTEM INSTRUCTION UPDATE]\n\n{paper_prompt}")],
        ),
        turn_complete=False,
    )

    # Inject paper fulltext as a user turn
    context_parts: list[types.Part] = []

    if fulltext:
        # Truncate very long fulltext to stay within token limits
        max_chars: int = 100_000  # ~25K tokens
        truncated: str = fulltext[:max_chars]
        if len(fulltext) > max_chars:
            truncated += "\n\n[... text truncated for context window ...]"
        context_parts.append(
            types.Part(text=f"[PAPER FULL TEXT]\n\n{truncated}")
        )

    # Inject page images as inline data
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
        await session.send_client_content(
            turns=types.Content(
                role="user",
                parts=context_parts,
            ),
            turn_complete=False,
        )

    # Notify frontend that paper is loaded
    await ws.send_json({
        "type": "session_status",
        "status": "connected",
    })

    # Update conversation state with paper context
    if conversation_state is not None:
        conversation_state.set_mode("paper", paper_context={
            "title": metadata.get("title", ""),
            "authors": ", ".join(metadata.get("authors", [])),
            "year": str(metadata.get("year", "")),
            "doi": metadata.get("doi", ""),
            "fulltext": fulltext[:10000] if fulltext else "",
            "annotation_count": len(annotations),
        })

    logger.info("Paper loaded successfully: %s", metadata.get("title", paper_key))


# ---------------------------------------------------------------------------
# Switch back to lobby mode
# ---------------------------------------------------------------------------

async def handle_switch_to_lobby(session: Any) -> None:
    """Switch the session back to lobby mode by re-injecting the lobby prompt."""
    await session.send_client_content(
        turns=types.Content(
            role="user",
            parts=[types.Part(text=f"[SYSTEM INSTRUCTION UPDATE]\n\n{LOBBY_SYSTEM_PROMPT}")],
        ),
        turn_complete=False,
    )
    logger.info("Switched back to lobby mode")


# ---------------------------------------------------------------------------
# Tool call handling
# ---------------------------------------------------------------------------

async def handle_tool_calls(
    ws: WebSocket,
    session: Any,
    tool_call: Any,
    session_request_ids: set[str],
    api_key: str,
    s2_api_key: str | None = None,
    conversation_state: ConversationState | None = None,
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

            elif fc.name == "annotate_zotero_pdf":
                # Convert Gemini bounding box → PDF rects before delegating
                bbox: list[int] = fc.args.get("boundingBox", [0, 0, 0, 0])
                page_idx: int = fc.args.get("pageIndex", 0)

                # Use stored page dimensions or defaults (8.5x11 inches)
                page_width: float = _page_dimensions.get(page_idx, {}).get("width", 612.0)
                page_height: float = _page_dimensions.get(page_idx, {}).get("height", 792.0)

                # Validate input bbox
                is_valid, validation_msg = validate_annotation_coords(
                    [bbox], page_width, page_height
                )
                if not is_valid:
                    result = {"error": f"Invalid annotation coordinates: {validation_msg}"}
                else:
                    pdf_rects: list[list[float]] = gemini_to_pdf_coords(
                        bbox, page_width, page_height
                    )
                    # Build params for the plugin endpoint
                    annotation_params: dict[str, Any] = {
                        "parentItemKey": fc.args.get("parentItemKey", ""),
                        "annotationType": fc.args.get("annotationType", "image"),
                        "pageIndex": page_idx,
                        "rects": pdf_rects,
                        "comment": fc.args.get("comment", ""),
                    }
                    result = await delegate_to_frontend(
                        ws, "createAnnotation", annotation_params, session_request_ids
                    )

            elif fc.name == "deep_analysis":
                call_args = dict(fc.args)
                call_args["api_key"] = api_key
                result = await deep_analysis(**call_args)

            elif fc.name == "manage_collection":
                action_name: str = fc.args.get("action", "list")
                action_map: dict[str, str] = {
                    "list": "listCollections",
                    "create": "createCollection",
                    "addItems": "addToCollection",
                    "removeItems": "removeFromCollection",
                }
                endpoint: str = action_map.get(action_name, "listCollections")
                params: dict[str, Any] = {
                    k: v for k, v in fc.args.items() if k != "action"
                }
                result = await delegate_to_frontend(
                    ws, endpoint, params, session_request_ids
                )

            elif fc.name == "manage_tags":
                action_name = fc.args.get("action", "add")
                endpoint = "addTags" if action_name == "add" else "removeTags"
                params = {k: v for k, v in fc.args.items() if k != "action"}
                result = await delegate_to_frontend(
                    ws, endpoint, params, session_request_ids
                )

            elif fc.name in ZOTERO_WRITE_TOOLS:
                endpoint = ZOTERO_TOOL_TO_ENDPOINT.get(fc.name, fc.name)
                result = await delegate_to_frontend(
                    ws, endpoint, fc.args, session_request_ids
                )

            elif fc.name in TOOL_REGISTRY:
                tool_fn = TOOL_REGISTRY[fc.name]
                # Inject api_key for tools that need it
                call_args: dict[str, Any] = dict(fc.args)
                if fc.name in ("search_academic_papers", "get_paper_recommendations"):
                    call_args["api_key"] = s2_api_key
                result = await tool_fn(**call_args)

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

            if conversation_state is not None:
                conversation_state.add_tool_call(fc.name, dict(fc.args))
                conversation_state.add_tool_result(
                    fc.name, str(result)[:500], success=True
                )

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

            if conversation_state is not None:
                conversation_state.add_tool_call(fc.name, dict(fc.args))
                conversation_state.add_tool_result(
                    fc.name, str(e)[:500], success=False
                )

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


# ---------------------------------------------------------------------------
# Text chat mode — uses generateContent (non-streaming)
# ---------------------------------------------------------------------------

TEXT_MODEL: str = "gemini-3.1-flash-lite-preview"
TEXT_MODEL_FALLBACK: str = "gemini-2.5-flash"


async def handle_text_message(
    ws: WebSocket,
    content: str,
    api_key: str,
    conversation_state: ConversationState,
) -> None:
    """Handle a text chat message via streaming generateContent API.

    Builds context from ConversationState, streams response chunks to the
    frontend as text_response_chunk messages, then sends a text_response_done.
    """
    conversation_state.add_message("user", content)

    # Notify frontend that we're generating a response
    await ws.send_json({"type": "text_response_start"})

    try:
        client: genai.Client = genai.Client(
            api_key=api_key,
            http_options={"timeout": 30000},
        )

        # Build context from conversation history
        context_contents: list[dict[str, Any]] = conversation_state.to_text_context(
            token_budget=30000
        )

        # Build system instruction based on mode
        if conversation_state.session_mode == "paper" and conversation_state.paper_context:
            ctx: dict[str, Any] = conversation_state.paper_context
            system_instruction: str = (
                f"You are Colloquia, an AI research assistant. "
                f"You are currently discussing the paper: {ctx.get('title', 'Unknown')} "
                f"by {ctx.get('authors', 'Unknown')} ({ctx.get('year', '')}).\n"
                f"Provide helpful, precise responses in markdown format. "
                f"When deep analysis is needed, say so explicitly."
            )
        else:
            system_instruction = (
                "You are Colloquia, an AI research assistant for managing "
                "and discussing academic papers in Zotero. "
                "Respond helpfully in markdown format."
            )

        full_text: str = ""
        used_model: str = TEXT_MODEL
        streamed: bool = False

        for model_name in (TEXT_MODEL, TEXT_MODEL_FALLBACK):
            try:
                logger.info("Trying text model: %s", model_name)
                stream = await client.aio.models.generate_content_stream(
                    model=model_name,
                    contents=context_contents,
                    config=types.GenerateContentConfig(
                        system_instruction=system_instruction,
                        temperature=0.7,
                        max_output_tokens=2048,
                    ),
                )
                used_model = model_name
                async for chunk in stream:
                    chunk_text: str = chunk.text or ""
                    if chunk_text:
                        full_text += chunk_text
                        await ws.send_json({
                            "type": "text_response_chunk",
                            "content": chunk_text,
                            "model": model_name,
                        })
                streamed = True
                break
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

        conversation_state.add_message("assistant", full_text)

        # Signal end of stream
        await ws.send_json({
            "type": "text_response_done",
            "model": used_model,
        })

    except Exception as e:
        logger.error("Text message handling failed: %s", str(e))
        error_msg: str = f"Text response failed: {str(e)}"
        await ws.send_json({
            "type": "error",
            "message": error_msg,
        })
