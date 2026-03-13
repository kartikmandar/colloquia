"""Main Colloquia agent — LlmAgent with dynamic instruction and all tools.

Uses dynamic_instruction to switch between lobby and paper prompts based
on session state.
"""

from typing import Any

from fastapi import WebSocket
from google.adk.agents import LlmAgent
from google.adk.agents.readonly_context import ReadonlyContext
from google.adk.models.google_llm import Gemini
from google.genai import types

from config import LIVE_MODEL, AGENT_NAME
from prompts.lobby import LOBBY_SYSTEM_PROMPT
from prompts.paper import build_paper_prompt
from tools.embedding_service import EmbeddingService
from tools.local_tools import search_academic_papers, get_paper_recommendations
from tools.vector_search import create_semantic_search_tool
from tools.zotero_tools import ZoteroToolContext, create_zotero_tools


def _dynamic_instruction(context: ReadonlyContext) -> str:
    """Return lobby or paper prompt based on session state."""
    state: dict[str, Any] = context.state
    mode: str = state.get("session_mode", "lobby")

    if mode == "paper":
        paper_ctx: dict[str, Any] = state.get("paper_context", {})
        return build_paper_prompt(
            title=paper_ctx.get("title", ""),
            authors=paper_ctx.get("authors", ""),
            year=paper_ctx.get("year", ""),
            doi=paper_ctx.get("doi", ""),
            venue=paper_ctx.get("venue", ""),
            annotation_count=paper_ctx.get("annotation_count", 0),
            note_count=paper_ctx.get("note_count", 0),
            pdf_attachment_key=paper_ctx.get("pdf_attachment_key", ""),
            user_annotations_summary=paper_ctx.get("user_annotations_summary", ""),
        )

    return LOBBY_SYSTEM_PROMPT


def create_colloquia_agent(
    ws: WebSocket,
    zotero_ctx: ZoteroToolContext,
    model: Gemini | None = None,
    embedding_service: EmbeddingService | None = None,
) -> LlmAgent:
    """Create the main Colloquia agent with all tools.

    Args:
        ws: The WebSocket for this session (Zotero tools close over it).
        zotero_ctx: Per-session Zotero tool context.
        model: Pre-configured Gemini model instance (for BYOK).
        embedding_service: Optional embedding service for semantic search.

    Returns:
        Configured LlmAgent.
    """
    zotero_tools: list[Any] = create_zotero_tools(
        ws, zotero_ctx, embedding_service=embedding_service
    )

    local_tools: list[Any] = [
        search_academic_papers,
        get_paper_recommendations,
    ]

    if embedding_service is not None:
        local_tools.append(create_semantic_search_tool(embedding_service))

    all_tools: list[Any] = local_tools + zotero_tools

    return LlmAgent(
        name=AGENT_NAME,
        model=model if model else LIVE_MODEL,
        instruction=_dynamic_instruction,
        tools=all_tools,
        generate_content_config=types.GenerateContentConfig(
            response_modalities=[types.Modality.AUDIO],
            speech_config=types.SpeechConfig(
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(
                        voice_name="Aoede",
                    ),
                ),
            ),
        ),
    )
