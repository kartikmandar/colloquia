"""Persistent chat history — SQLite-backed via aiosqlite.

Stores chats, messages, and session mode transitions. Uses SHA-256 hash
of the API key for user isolation (BYOK — key never stored).
"""

import hashlib
import json
import logging
from typing import Any

import aiosqlite

from config import CHAT_DB_PATH

logger: logging.Logger = logging.getLogger(__name__)

_CREATE_TABLES_SQL: str = """
CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT 'New Chat',
    chat_type TEXT NOT NULL CHECK(chat_type IN ('voice', 'text')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    api_key_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK(role IN ('user', 'model', 'system')),
    content TEXT NOT NULL DEFAULT '',
    timestamp TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    session_mode TEXT NOT NULL DEFAULT 'lobby',
    model_used TEXT DEFAULT NULL,
    tool_calls TEXT DEFAULT NULL,
    thinking TEXT DEFAULT NULL,
    media_refs TEXT DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS session_mode_transitions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    from_mode TEXT NOT NULL,
    to_mode TEXT NOT NULL,
    paper_title TEXT DEFAULT NULL,
    paper_key TEXT DEFAULT NULL,
    timestamp TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
"""


class ChatStore:
    """Async SQLite store for persistent chat history."""

    def __init__(self, db_path: str = CHAT_DB_PATH) -> None:
        self.db_path: str = db_path
        self._db: aiosqlite.Connection | None = None

    async def initialize(self) -> None:
        """Open the database and create tables if needed."""
        import os
        os.makedirs(os.path.dirname(self.db_path) or ".", exist_ok=True)

        self._db = await aiosqlite.connect(self.db_path)
        self._db.row_factory = aiosqlite.Row
        await self._db.execute("PRAGMA journal_mode=WAL")
        await self._db.execute("PRAGMA foreign_keys=ON")
        await self._db.executescript(_CREATE_TABLES_SQL)
        await self._db.commit()
        logger.info("ChatStore initialized: %s", self.db_path)

    async def close(self) -> None:
        """Close the database connection."""
        if self._db:
            await self._db.close()
            self._db = None

    @staticmethod
    def hash_api_key(api_key: str) -> str:
        """SHA-256 hash of the API key for user isolation."""
        return hashlib.sha256(api_key.encode()).hexdigest()

    # ------------------------------------------------------------------
    # Chat CRUD
    # ------------------------------------------------------------------

    async def create_chat(
        self, chat_id: str, chat_type: str, api_key_hash: str
    ) -> dict[str, Any]:
        """Create a new chat. Returns the created chat row."""
        assert self._db is not None
        await self._db.execute(
            "INSERT INTO chats (id, chat_type, api_key_hash) VALUES (?, ?, ?)",
            (chat_id, chat_type, api_key_hash),
        )
        await self._db.commit()
        return await self.get_chat(chat_id)

    async def list_chats(
        self, api_key_hash: str, limit: int = 50, offset: int = 0
    ) -> list[dict[str, Any]]:
        """List chats for a user, most recent first."""
        assert self._db is not None
        cursor = await self._db.execute(
            """
            SELECT c.id, c.title, c.chat_type, c.created_at, c.updated_at,
                   COUNT(m.id) AS message_count
            FROM chats c
            LEFT JOIN messages m ON m.chat_id = c.id
            WHERE c.api_key_hash = ?
            GROUP BY c.id
            ORDER BY c.updated_at DESC
            LIMIT ? OFFSET ?
            """,
            (api_key_hash, limit, offset),
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]

    async def get_chat(self, chat_id: str) -> dict[str, Any]:
        """Get a single chat by ID."""
        assert self._db is not None
        cursor = await self._db.execute(
            "SELECT * FROM chats WHERE id = ?", (chat_id,)
        )
        row = await cursor.fetchone()
        if row is None:
            return {}
        return dict(row)

    async def update_chat_title(self, chat_id: str, title: str) -> None:
        """Rename a chat."""
        assert self._db is not None
        await self._db.execute(
            """UPDATE chats SET title = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
               WHERE id = ?""",
            (title, chat_id),
        )
        await self._db.commit()

    async def delete_chat(self, chat_id: str) -> None:
        """Delete a chat and all associated messages (CASCADE)."""
        assert self._db is not None
        await self._db.execute("DELETE FROM chats WHERE id = ?", (chat_id,))
        await self._db.commit()

    async def touch_chat(self, chat_id: str) -> None:
        """Update the updated_at timestamp."""
        assert self._db is not None
        await self._db.execute(
            """UPDATE chats SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
               WHERE id = ?""",
            (chat_id,),
        )
        await self._db.commit()

    # ------------------------------------------------------------------
    # Messages
    # ------------------------------------------------------------------

    async def add_message(
        self,
        chat_id: str,
        role: str,
        content: str,
        session_mode: str = "lobby",
        model_used: str | None = None,
        tool_calls: list[dict[str, Any]] | None = None,
        thinking: str | None = None,
        media_refs: list[str] | None = None,
    ) -> int:
        """Add a message. Returns the new message ID."""
        assert self._db is not None
        cursor = await self._db.execute(
            """INSERT INTO messages
               (chat_id, role, content, session_mode, model_used, tool_calls, thinking, media_refs)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                chat_id,
                role,
                content,
                session_mode,
                model_used,
                json.dumps(tool_calls) if tool_calls else None,
                thinking,
                json.dumps(media_refs) if media_refs else None,
            ),
        )
        await self._db.commit()
        # Also touch the chat's updated_at
        await self.touch_chat(chat_id)
        return cursor.lastrowid or 0

    async def get_messages(
        self, chat_id: str, limit: int = 200, offset: int = 0
    ) -> list[dict[str, Any]]:
        """Retrieve messages for a chat, oldest first."""
        assert self._db is not None
        cursor = await self._db.execute(
            """SELECT id, chat_id, role, content, timestamp, session_mode,
                      model_used, tool_calls, thinking, media_refs
               FROM messages WHERE chat_id = ?
               ORDER BY id ASC LIMIT ? OFFSET ?""",
            (chat_id, limit, offset),
        )
        rows = await cursor.fetchall()
        result: list[dict[str, Any]] = []
        for r in rows:
            d: dict[str, Any] = dict(r)
            # Parse JSON fields
            if d.get("tool_calls"):
                try:
                    d["tool_calls"] = json.loads(d["tool_calls"])
                except (json.JSONDecodeError, TypeError):
                    pass
            if d.get("media_refs"):
                try:
                    d["media_refs"] = json.loads(d["media_refs"])
                except (json.JSONDecodeError, TypeError):
                    pass
            result.append(d)
        return result

    async def get_message_count(self, chat_id: str) -> int:
        """Count messages in a chat."""
        assert self._db is not None
        cursor = await self._db.execute(
            "SELECT COUNT(*) FROM messages WHERE chat_id = ?", (chat_id,)
        )
        row = await cursor.fetchone()
        return row[0] if row else 0

    async def needs_title(self, chat_id: str) -> bool:
        """Check if a chat still has the default title."""
        chat: dict[str, Any] = await self.get_chat(chat_id)
        return chat.get("title", "") == "New Chat"

    # ------------------------------------------------------------------
    # Mode transitions
    # ------------------------------------------------------------------

    async def add_transition(
        self,
        chat_id: str,
        from_mode: str,
        to_mode: str,
        paper_title: str | None = None,
        paper_key: str | None = None,
    ) -> None:
        """Record a session mode transition."""
        assert self._db is not None
        await self._db.execute(
            """INSERT INTO session_mode_transitions
               (chat_id, from_mode, to_mode, paper_title, paper_key)
               VALUES (?, ?, ?, ?, ?)""",
            (chat_id, from_mode, to_mode, paper_title, paper_key),
        )
        await self._db.commit()
