"""Configuration constants for the Colloquia backend."""

# Live API (bidirectional audio streaming)
LIVE_MODEL: str = "gemini-2.5-flash-native-audio-latest"

# Text chat (streaming generateContent)
TEXT_MODEL: str = "gemini-3.1-flash-lite-preview"
TEXT_MODEL_FALLBACK: str = "gemini-2.5-flash"

# Agent name
AGENT_NAME: str = "colloquia"
APP_NAME: str = "colloquia-app"

# Session defaults
MAX_RECONNECTS: int = 5
ZOTERO_TIMEOUT: float = 10.0
TEXT_TOKEN_BUDGET: int = 30000
MAX_FULLTEXT_CHARS: int = 100_000
MAX_HISTORY_TURNS: int = 20  # ~10 user-model exchanges

# OpenAlex polite pool email (for higher rate limits, no key needed)
OPENALEX_MAILTO: str = "colloquia-app@users.noreply.github.com"

# Embeddings (ChromaDB + Gemini)
EMBEDDING_MODEL: str = "gemini-embedding-001"
CHROMADB_PERSIST_DIR: str = "data/chromadb"
RAG_CHUNK_SIZE: int = 1000
RAG_CHUNK_OVERLAP: int = 200
RAG_TOP_K: int = 10

# Persistent chat history (SQLite)
CHAT_DB_PATH: str = "data/chats.db"
TITLE_GEN_THRESHOLD: int = 6  # messages (3 exchanges) before auto-title
TITLE_GEN_MODEL: str = "gemini-2.5-flash"
