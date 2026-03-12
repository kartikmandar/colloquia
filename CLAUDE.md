# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Colloquia is a voice-powered AI research assistant for Zotero library management, built for the Gemini Live Agent Challenge. It uses Gemini's Live API for bidirectional audio and streaming text for chat. Users bring their own Gemini API key (BYOK — key stays client-side, set as env var per session).

## Monorepo Structure

- `frontend/` — Vite + React 19 + TypeScript (pnpm)
- `backend/` — FastAPI + Google ADK + Python (conda env `colloquia`, Python 3.11)
- `zotero-colloquia-plugin/` — Zotero 7 plugin (npm, TypeScript)

## Commands

### Frontend (`frontend/`)
```bash
pnpm install          # install deps
pnpm dev              # dev server on :5173
pnpm build            # typecheck + production build (always run to verify changes)
pnpm lint             # ESLint
pnpm format           # Prettier format
pnpm format:check     # check formatting only
```

### Backend (`backend/`)
```bash
conda activate colloquia
uvicorn main:app --reload --host 0.0.0.0 --port 8000    # dev server
python -m pytest tests/ -v                                # integration tests (needs Zotero running + GEMINI_API_KEY)
python -m pytest tests/test_tools.py -v                   # single test file
```

### Zotero Plugin (`zotero-colloquia-plugin/`)
```bash
npm install
npm run start         # serve plugin to Zotero (dev)
npm run build         # build + typecheck
npm run lint:check    # check lint + format
npm run lint:fix      # fix lint + format
```

### Full Stack
```bash
bash start.sh         # starts backend (uvicorn :8000) + frontend (vite) together
```

## Architecture

### Communication Flow
```
Frontend ──WebSocket──► Backend ──► Gemini Live API (voice) / generateContent (text)
Frontend ──HTTP proxy──► Zotero (localhost:23119) via Vite proxy config
Backend ──WebSocket──► Frontend (delegates Zotero writes back to client)
```

### Frontend Key Files
- `src/App.tsx` → `SetupScreen` (API key + Zotero check) or `MainApp` (paper browser + chat)
- `src/hooks/useWebSocket.ts` — central WebSocket connection, message dispatch, reconnection
- `src/hooks/useAudioCapture.ts` — mic input, PCM16 encoding
- `src/lib/protocol.ts` — WebSocket message type definitions (discriminated unions on `type` field)
- `src/lib/zoteroApi.ts` — direct HTTP to Zotero for reads
- `src/lib/paperLoader.ts` — parallel paper fetch + context builder
- `src/lib/audio-streamer.ts` — 24kHz PCM16 audio playback
- `vite.config.ts` — proxies `/zotero-api/*`, `/zotero-plugin/*`, `/api/ws`

### Backend Key Files
- `main.py` — FastAPI app, `/health`, `/ws` endpoint
- `session_handler.py` — event loop for voice (`run_live()`) and text (`run_async()`) modes
- `agent_factory.py` — creates ADK agent + runner per session
- `config.py` — model names, timeouts, token budgets
- `prompts/lobby.py` — system prompt for general mode (no paper loaded)
- `prompts/paper.py` — system prompt for paper discussion mode
- `tools/zotero_tools.py` — Zotero operations delegated to frontend via WebSocket
- `tools/openalex.py` — OpenAlex API (search, DOI, recommendations)
- `tools/pdf_processing.py` — PyMuPDF PDF rendering, coordinate mapping

### Zotero Plugin Key Files
- `src/addon.ts` — registers HTTP endpoints via `Zotero.Server.Endpoints`
- `src/modules/endpoints.ts` — 10+ POST endpoints at `/colloquia/<action>` (ping, createNote, addTags, searchLibrary, createAnnotation, addPaper, etc.)

### Key Design Patterns
- **Delegation**: Backend delegates Zotero writes to frontend via WebSocket `zotero_action` messages; frontend executes and returns `zotero_action_result`
- **Prompt swapping**: Session transitions between "lobby" (general) and "paper" (deep discussion) modes
- **Paper context injection**: Full text + page images sent as single turn to Gemini before conversation starts
- **Async futures**: Tool responses resolved via `asyncio.Future` keyed by `requestId`
- **BYOK**: API key set as env var during session creation, never stored server-side

## Code Style

### Frontend
- Strict TypeScript (`noUnusedLocals`, `noUnusedParameters`, no implicit `any`)
- ESLint enforces explicit function return types and module boundary types (warn)
- Prettier: double quotes, semicolons, trailing commas, 80 char width, 2-space indent
- Tailwind CSS v4 with design tokens in `index.css` (surface, border, text, accent colors)

### Backend
- Python type hints throughout
- 4-space indentation
- Async/await for all I/O (httpx, WebSocket, Gemini calls)

### Zotero Plugin
- Plugin endpoints are async classes with `init()` method
- Request body via `parseBody(request.data)` (handles pre-parsed objects)
- Response format: `[statusCode, "application/json", JSON.stringify(body)]`

## Gemini Models
- **Voice (Live API)**: `gemini-2.5-flash-native-audio-latest` — requires `response_modalities=['AUDIO']`
- **Text (primary)**: `gemini-3.1-flash-lite-preview` — frequently 503s, fallback essential
- **Text (fallback)**: `gemini-2.5-flash` — reliable
- **Deep analysis**: `gemini-2.5-pro`
- Do NOT use `gemini-3-flash-preview` — hangs on streaming

## Testing
- Tests are integration tests using real Zotero plugin + OpenAlex (no mocks)
- Prerequisites: Zotero running with plugin installed, `GEMINI_API_KEY` set
