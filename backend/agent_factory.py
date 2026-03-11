"""Per-session ADK agent, runner, and session construction.

Handles BYOK by setting GOOGLE_API_KEY env var before creating the
Gemini model instance (which caches its Client on first access).
Uses asyncio.Lock to prevent races when multiple sessions connect.
"""

import asyncio
import logging
import os
import uuid
from dataclasses import dataclass, field
from typing import Any

from fastapi import WebSocket
from google.adk.models.google_llm import Gemini
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService, Session

from agents.colloquia_agent import create_colloquia_agent
from config import APP_NAME, DEEP_ANALYSIS_MODEL, LIVE_MODEL
from tools.zotero_tools import ZoteroToolContext

logger: logging.Logger = logging.getLogger(__name__)

# Lock to prevent race conditions when setting GOOGLE_API_KEY
_api_key_lock: asyncio.Lock = asyncio.Lock()


@dataclass
class SessionBundle:
    """Everything needed to run a session."""
    runner: Runner
    session: Session
    session_service: InMemorySessionService
    zotero_ctx: ZoteroToolContext
    text_chat_history: list[Any] = field(default_factory=list)
    text_chat_lock: asyncio.Lock = field(default_factory=asyncio.Lock)


async def create_session_bundle(
    api_key: str,
    ws: WebSocket,
    user_id: str = "default_user",
    session_id: str | None = None,
) -> SessionBundle:
    """Create a complete ADK session bundle for a new WebSocket connection.

    Args:
        api_key: User's Gemini API key (BYOK).
        ws: The WebSocket for this session.
        user_id: User identifier.
        session_id: Optional session ID (auto-generated if not provided).

    Returns:
        SessionBundle with runner, session, and context objects.
    """
    if session_id is None:
        session_id = str(uuid.uuid4())

    zotero_ctx: ZoteroToolContext = ZoteroToolContext()

    # BYOK: Set API key in env, create Gemini instances (each caches its Client),
    # then create agent with the pre-initialized models.
    async with _api_key_lock:
        os.environ["GOOGLE_API_KEY"] = api_key
        model: Gemini = Gemini(model=LIVE_MODEL)
        deep_model: Gemini = Gemini(model=DEEP_ANALYSIS_MODEL)
        # Force Client creation now while env var is correct
        _ = model.api_client
        _ = model._live_api_client
        _ = deep_model.api_client

    agent = create_colloquia_agent(
        ws, zotero_ctx, model=model, deep_analysis_model=deep_model
    )

    session_service: InMemorySessionService = InMemorySessionService()

    session: Session = await session_service.create_session(
        app_name=APP_NAME,
        user_id=user_id,
        session_id=session_id,
        state={
            "session_mode": "lobby",
            "paper_context": {},
        },
    )

    runner: Runner = Runner(
        agent=agent,
        app_name=APP_NAME,
        session_service=session_service,
    )

    logger.info(
        "Session bundle created: user=%s, session=%s",
        user_id, session_id,
    )

    return SessionBundle(
        runner=runner,
        session=session,
        session_service=session_service,
        zotero_ctx=zotero_ctx,
    )
