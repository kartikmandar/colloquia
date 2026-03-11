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
