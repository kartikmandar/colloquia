import json
import logging
from typing import Any

from fastapi import FastAPI, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from chat_store import ChatStore
from session_handler import run_session, set_chat_store

logging.basicConfig(level=logging.INFO)
logger: logging.Logger = logging.getLogger(__name__)

app: FastAPI = FastAPI(title="Colloquia Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_chat_store: ChatStore = ChatStore()


@app.on_event("startup")
async def startup() -> None:
    await _chat_store.initialize()
    set_chat_store(_chat_store)
    logger.info("ChatStore initialized at startup")


@app.on_event("shutdown")
async def shutdown() -> None:
    await _chat_store.close()
    logger.info("ChatStore closed at shutdown")


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


# ------------------------------------------------------------------
# Chat history REST endpoints
# ------------------------------------------------------------------


class RenameChatBody(BaseModel):
    title: str


@app.get("/chats")
async def list_chats(
    api_key: str = Query(..., alias="api_key"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    """List chats for a user (identified by hashed API key)."""
    key_hash: str = ChatStore.hash_api_key(api_key)
    chats: list[dict[str, Any]] = await _chat_store.list_chats(
        key_hash, limit=limit, offset=offset
    )
    return {"chats": chats}


@app.get("/chats/{chat_id}")
async def get_chat(chat_id: str) -> dict[str, Any]:
    """Get a single chat with its messages."""
    chat: dict[str, Any] = await _chat_store.get_chat(chat_id)
    if not chat:
        return {"error": "Chat not found"}
    messages: list[dict[str, Any]] = await _chat_store.get_messages(chat_id)
    return {"chat": chat, "messages": messages}


@app.patch("/chats/{chat_id}")
async def rename_chat(chat_id: str, body: RenameChatBody) -> dict[str, Any]:
    """Rename a chat."""
    await _chat_store.update_chat_title(chat_id, body.title)
    return {"success": True, "chatId": chat_id, "title": body.title}


@app.delete("/chats/{chat_id}")
async def delete_chat(chat_id: str) -> dict[str, Any]:
    """Delete a chat and all its messages."""
    await _chat_store.delete_chat(chat_id)
    return {"success": True, "chatId": chat_id}


# ------------------------------------------------------------------
# WebSocket
# ------------------------------------------------------------------


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    await websocket.accept()
    logger.info("WebSocket connection accepted")

    try:
        # Await config message with API key
        raw_config: str = await websocket.receive_text()
        config: dict[str, Any] = json.loads(raw_config)

        api_key: str | None = config.get("gemini_api_key")
        if not api_key:
            await websocket.send_json({
                "type": "error",
                "message": "Missing gemini_api_key in config",
            })
            await websocket.close()
            return

        masked_key: str = api_key[:8] + "..."
        logger.info("Received API key: %s", masked_key)

        # Send session status
        await websocket.send_json({
            "type": "session_status",
            "status": "connected",
        })

        # Hand off to the ADK-based session handler
        await run_session(websocket, config)

    except WebSocketDisconnect:
        logger.info("WebSocket disconnected")
    except Exception as e:
        logger.error("WebSocket error: %s", str(e))
        try:
            await websocket.send_json({
                "type": "error",
                "message": str(e),
            })
            await websocket.close()
        except Exception:
            pass
