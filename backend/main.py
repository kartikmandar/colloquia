import json
import logging
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from session_handler import run_session

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


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


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
