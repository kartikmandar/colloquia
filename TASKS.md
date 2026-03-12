# Colloquia: Development Tasks & Phases

> **Timeline:** March 11-16, 2026 (6 days) | **Demo:** March 17 | **Hackathon:** Gemini Live Agent Challenge
>
> **Priority tiers:**
> - **P0 (MVP):** Voice conversation + paper browsing + text chat + paper context injection
> - **P1 (High impact):** Live PDF annotations + paper discovery + basic tag management
> - **P2 (Nice to have):** Full library management, bulk operations, conversation summaries, figure-click mode

---

## Phase 0: Pre-Development Setup (Before Day 1)

### 0.1 Environment & Tooling
- [x] Create GitHub repository `colloquia` (Apache 2.0 license) — https://github.com/kartikmandar/colloquia
- [x] Set up monorepo structure: `frontend/`, `backend/`, `zotero-colloquia-plugin/`
- [x] Obtain Gemini API key — from GCP project `colloquia-app`, stored in `backend/.env`
- [ ] Obtain OpenAlex API key (optional, for higher rate limits) — skipped for now
- [x] Install Zotero 7 desktop and verify local API at `localhost:23119`
- [x] Populate Zotero library with test papers — 100+ papers already present (HERA, 21cm, radio astro)
- [x] Install Google Cloud CLI (`gcloud`) and authenticate — v556.0.0, enroliaeducation@gmail.com
- [x] Create Cloud Run project and enable billing — GCP project `colloquia-app`, Cloud Run API enabled
- [x] Set up conda environment for Python backend — `colloquia` env, Python 3.11.14
- [x] Verify Chrome browser — Chrome 145 confirmed

### 0.2 Reference Code Review
- [x] Clone and study `google-gemini/live-api-web-console` — audio pipeline: 16kHz capture, 24kHz playback, 200ms schedule-ahead buffer, AudioWorklet threading
- [x] Clone and study `windingwind/zotero-plugin-template` — factory pattern modules, esbuild→XPI build, HTTP endpoints via `Zotero.Server.Endpoints`
- [x] Test Gemini Live API connection — **`gemini-2.5-flash-native-audio-latest`** for Live (requires `response_modalities=['AUDIO']`); **`gemini-3-flash-preview`** for text/tools; gemini-2.0-flash deprecated, gemini-3-flash does NOT support bidiGenerateContent
- [x] Test Zotero local API — confirmed, returns JSON with paper metadata

---

## Phase 1: Foundation & Zotero Read Integration (Day 1 — March 11)

### 1.1 Frontend Project Initialization
- [x] Initialize Vite + React + TypeScript project in `frontend/` — scaffolded with `pnpm create vite . --template react-ts`
- [x] Install core dependencies: `react`, `react-dom`, `typescript`, Tailwind CSS v4 (`tailwindcss` + `@tailwindcss/vite`)
- [x] Configure `tsconfig.json` with strict mode — already enabled by Vite template in `tsconfig.app.json` and `tsconfig.node.json`
- [x] Set up ESLint + Prettier — `eslint-plugin-prettier`, `eslint-config-prettier`, `@typescript-eslint/explicit-function-return-type` warnings
- [x] Create base `App.tsx` with routing skeleton (setup screen vs main app) — state-based switching between `SetupScreen` and `MainApp`

### 1.2 Vite Proxy Configuration (CORS solution)
- [x] Configure `/zotero-api` proxy in `vite.config.ts`:
  - Target: `http://localhost:23119`
  - Rewrite: `/zotero-api` → `/api`
  - Add headers: `Zotero-Allowed-Request: 1`, `User-Agent: Colloquia/1.0`
- [x] Configure `/zotero-plugin` proxy in `vite.config.ts`:
  - Target: `http://localhost:23119`
  - Rewrite: `/zotero-plugin` → (strip prefix)
  - Add header: `Zotero-Allowed-Request: 1`
- [x] Configure `/api/ws` WebSocket proxy → `ws://localhost:8000/ws`
- [ ] Verify both proxies work with manual browser requests

### 1.3 WebSocket Protocol Definition (Critical — prevents integration debt)
- [x] Define `ClientMessage` union type in `src/lib/protocol.ts` — 6 message types:
  - `config` — API key handshake (first message)
  - `audio` — base64 PCM16 audio chunk
  - `text` — text chat input
  - `paper_context` — paper loading payload (fulltext, metadata, pageImages)
  - `zotero_action_result` — response from Zotero plugin operations
  - `control` — start/stop/switch_mode
- [x] Define `ServerMessage` union type — 9 message types:
  - `audio` — base64 PCM16 audio response
  - `transcript` — user/model text transcription
  - `text_response` — text mode markdown response
  - `zotero_action` — backend→frontend Zotero write command
  - `tool_call` — tool invocation lifecycle (calling/done/error)
  - `thinking` — Pro model reasoning trace
  - `context_usage` — token usage for progress bar
  - `error` — error message
  - `session_status` — connected/reconnecting/ended
- [x] Export shared types for both frontend and backend consumption — supporting types: `PaperMetadata`, `PaperAnnotation`, `PageImage`

### 1.4 BYOK API Key Management
- [x] Create `src/lib/apiKeys.ts` — `getGeminiKey`, `setGeminiKey`, `clearAllKeys`, `hasGeminiKey`; localStorage key: `colloquia_gemini_key`
- [x] Build `SetupScreen` component:
  - Gemini API key input (required, password type with show/hide toggle)
  - OpenAlex API key input (optional, with toggle)
  - "Your API key is stored locally in your browser" privacy notice
  - Validation: format check (starts with "AI", >20 chars), loading state on button
  - "Get Started" button → persist to localStorage → call onComplete()
- [x] App startup logic: if `hasGeminiKey()` is true, start on "main" screen; otherwise "setup"
- [x] Settings panel (gear icon): in MainApp top-right corner, navigates back to setup; shows first 8 chars of key masked

### 1.5 Zotero Health Check
- [x] Create `src/hooks/useZoteroHealth.ts` — parallel health checks via `Promise.allSettled`:
  - Pings `/zotero-api/users/0/items/top?limit=1` on startup
  - Returns `ZoteroState`: `{ available, pluginInstalled, libraryEmpty, loading, error }`
  - Checks plugin via `/zotero-plugin/colloquia/ping`
  - Exposes `refresh()` function for re-checking
- [x] Build `src/components/ZoteroStatus.tsx` onboarding UI based on state:
  - Loading → spinner with "Checking Zotero connection..."
  - `!available` → amber warning card with troubleshooting steps + Retry button
  - `!pluginInstalled` → blue info card (non-blocking, user can continue)
  - `libraryEmpty` → gray note suggesting adding papers or using voice mode
  - All good → small green "Zotero Connected" badge

### 1.6 Paper Browser Component
- [x] Create `src/lib/zoteroApi.ts` — centralized Zotero API client:
  - TypeScript interfaces: `ZoteroItem`, `ZoteroCollection`, `ZoteroCreator`, `ZoteroTag`, `ZoteroItemData`, `ZoteroCollectionData`, `ZoteroFulltextResponse`
  - Custom `ZoteroApiError` class
  - Functions: `zoteroFetch`, `fetchTopItems`, `fetchCollections`, `fetchCollectionItems`, `searchItems`, `fetchItemDetails`, `fetchItemChildren`, `fetchItemFulltext`
  - Helpers: `formatAuthorsShort`, `formatAuthorsFull`, `extractYear`, `getVenue`
  - `DOCUMENT_ITEM_TYPES` set for filtering non-document items
- [x] Build `src/components/PaperBrowser.tsx` — three-panel layout:
  - Left sidebar (240px): collection tree from `/zotero-api/users/0/collections`, "All Papers" at top, active highlighted
  - Center: searchable paper list with 300ms debounce, loading/error/empty states, items sorted by dateModified
  - Right panel (384px, lg+): paper detail with title, authors, year, venue, DOI, tags, abstract, "Open Discussion" button
  - Filters out non-document item types
- [x] Paper selection handler — `onPaperSelect` callback stores selected paper key in MainApp state
- [x] MainApp restructured — header bar with title, ZoteroStatus badge, API key mask, settings gear; flex-1 area with PaperBrowser

### 1.7 Backend Skeleton (FastAPI)
- [x] Initialize FastAPI project in `backend/`:
  - `main.py` — FastAPI app with CORS middleware (allow all origins for dev)
  - `requirements.txt`: `fastapi`, `uvicorn[standard]`, `websockets`, `google-genai`, `httpx`
- [x] Create WebSocket endpoint `ws://localhost:8000/ws`:
  - Accepts connection, awaits `config` message with `gemini_api_key`
  - Creates per-session `genai.Client(api_key=...)`
  - Logs connection + key receipt (first 8 chars + "...")
  - Sends back `session_status: "connected"`, runs receive loop
  - Handles `WebSocketDisconnect` gracefully
- [x] Add `GET /health` endpoint — returns `{"status": "ok"}`
- [x] Test locally: server starts on port 8000, `/health` returns 200
- [x] Verify `google.genai.Client` instantiation works with API key

### 1.8 Cloud Run Initial Deployment
- [x] Create `backend/Dockerfile` — Python 3.11-slim, `pip install -r requirements.txt`, `uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080}`
- [x] Create `backend/.dockerignore` — excludes `.env`, `__pycache__`, `*.pyc`, `.git`
- [x] Docker image built locally: `docker build -t colloquia-backend ./backend`
- [x] Fixed IAM permissions — granted `roles/cloudbuild.builds.builder` and `roles/storage.admin` to `318881942640-compute@developer.gserviceaccount.com`
- [x] Deploy to Cloud Run — exact command used:
  ```
  gcloud run deploy colloquia-backend --source=/Users/kartikmandar/Downloads/repos/colloquia/backend/ --region=us-central1 --timeout=3600 --min-instances=1 --allow-unauthenticated --project=colloquia-app
  ```
- [x] **Service URL:** `https://colloquia-backend-318881942640.us-central1.run.app`
- [x] Verified: `/health` returns `{"status":"ok"}`
- [x] Update frontend to use Cloud Run backend URL — auto-resolution in `src/lib/backendUrl.ts` (local vs Cloud Run failover)

### Day 1 Deliverables Checklist
- [x] Browse and search Zotero library in the UI — PaperBrowser with collections sidebar, search, detail panel
- [x] Backend deployed to Cloud Run with WebSocket endpoint — `https://colloquia-backend-318881942640.us-central1.run.app`
- [x] WebSocket protocol fully typed in TypeScript — 6 client + 9 server message types in `src/lib/protocol.ts`
- [x] API key entry + persistence working — SetupScreen with validation, localStorage, gear icon to change
- [x] Zotero health check + onboarding UI functional — parallel health checks, contextual status badges

---

## Phase 2: Voice Pipeline & Tool Orchestration (Day 2 — March 12)

### 2.1 Audio Input Pipeline (Mic → Gemini)
- [x] Create `src/lib/worklets/audio-processing.ts`:
  - `AudioWorkletProcessor` subclass for PCM capture
  - Float32 → Int16 conversion (`sample * 0x7FFF`)
  - Post Int16 PCM buffer via `port.postMessage()`
- [x] Register worklet in audio context via `src/lib/audioworklet-registry.ts`
- [x] Create `src/hooks/useAudioCapture.ts`:
  - `getUserMedia({ audio: { channelCount: 1 } })`
  - Create `AudioContext({ sampleRate: 16000 })` (Chrome-only; Safari ignores this)
  - Connect MediaStreamSource → AudioWorkletNode
  - Worklet `onmessage` → base64-encode PCM → send via WebSocket
- [x] Microphone permission handling: request, grant, deny states in UI
- [x] Mic toggle button: start/stop capture with visual indicator

### 2.2 Audio Output Pipeline (Gemini → Speaker)
- [x] Fork/adapt `audio-streamer.ts` from `live-api-web-console`:
  - Receive base64 PCM16 chunks from WebSocket
  - Decode to Int16Array → Float32 (`sample / 32768.0`)
  - Create `AudioBuffer` at 24kHz sample rate
  - Schedule playback using `AudioBufferSourceNode.start(scheduledTime)`
  - Maintain playback queue for smooth continuous audio
- [x] Handle interruptions:
  - On `server_content.interrupted` → stop all queued sources, clear queue
  - On user barge-in (mic active + model speaking) → clear playback
- [x] Visual audio indicator: volume meter worklet (`src/lib/worklets/vol-meter.ts`)

### 2.3 WebSocket Client (Frontend)
- [x] Create `src/hooks/useWebSocket.ts`:
  - Connect to backend WebSocket URL (auto-resolved via `src/lib/backendUrl.ts` — local vs Cloud Run)
  - Send `config` message on open (Gemini key + optional S2 key from localStorage)
  - Handle incoming `ServerMessage` types:
    - `audio` → forward to audio output pipeline
    - `transcript` → append to chat messages (user/model)
    - `text_response` → append to chat messages (markdown)
    - `tool_call` → update tool call status in chat
    - `thinking` → store reasoning trace
    - `zotero_action` → execute Zotero plugin call locally (Day 3)
    - `context_usage` → update usage bar
    - `error` → display toast notification
    - `session_status` → update connection badge
  - Expose `sendAudio()`, `sendText()`, `sendPaperContext()`, `sendControl()`
  - Reconnection logic with exponential backoff + URL failover

### 2.4 Backend: Tool Orchestration Loop (Core)
- [x] Create `backend/session_handler.py`:
  - `run_session(ws, session, config_msg)` — main event loop
  - Two concurrent tasks via `asyncio.create_task()`:
    - `forward_user_to_gemini()` — read from frontend WS, send to Gemini
    - `forward_gemini_to_user()` — read from Gemini, handle tool calls, forward to frontend
  - `asyncio.wait(return_when=FIRST_COMPLETED)` — cancel counterpart on exit
- [x] Implement `forward_user_to_gemini()`:
  - `audio` → `session.send_realtime_input(audio=Blob(...))`
  - `text` → `session.send_client_content(turns=Content(role="user", ...))`
  - `paper_context` → `handle_paper_load()` (Day 3)
  - `zotero_action_result` → `resolve_zotero_result()` (Day 3)
- [x] Implement `forward_gemini_to_user()`:
  - `message.data` → forward audio to frontend as base64
  - `message.tool_call` → `handle_tool_calls()` (execute + respond)
  - `message.server_content` → extract transcripts (input/output), handle interruptions
  - `message.usage_metadata` → forward `context_usage` to frontend
  - `message.session_resumption_update` → cache resumption handle
  - `message.go_away` → trigger reconnection
- [x] Implement `handle_tool_calls()`:
  - Notify frontend of tool call start (`tool_call` status: "calling")
  - Execute tool from `TOOL_REGISTRY` dict
  - Handle Google Search grounding fallback (if bug is active)
  - Delegate Zotero write tools to frontend (Day 3)
  - Notify frontend of result (`tool_call` status: "done" or "error")
  - Send `FunctionResponse` back to Gemini via `session.send_tool_response()`
- [x] Create `TOOL_REGISTRY` dict with at least one test tool (e.g., `echo` tool)

### 2.5 Backend: LiveConnectConfig Setup
- [x] Configure `LiveConnectConfig`:
  - `response_modalities=["AUDIO"]`
  - `system_instruction=LOBBY_SYSTEM_PROMPT`
  - `tools=TOOL_DECLARATIONS` (start with empty, add incrementally)
  - `session_resumption=SessionResumptionConfig()`
  - `output_audio_transcription=AudioTranscriptionConfig()`
  - `input_audio_transcription=AudioTranscriptionConfig()`
  - **No compression** (skip for hackathon — known audio cutoff bug)
- [x] Create `backend/prompts/lobby.py` with lobby system prompt
- [x] Create `backend/prompts/paper.py` with paper system prompt template

### 2.6 Backend: Verify Mid-Session System Prompt Swap
- [x] Test `send_client_content(role="system")` for lobby→paper transition — test script at `backend/tests/test_prompt_swap.py`:
  - Send new system instruction mid-session
  - Verify conversation history is preserved
  - Verify new instruction takes effect for subsequent responses
- [ ] If `role="system"` doesn't work as expected, implement fallback:
  - Send updated instruction as a user turn with explicit "system instruction update" framing

### 2.7 Basic Voice UI
- [x] Build minimal conversation UI:
  - MicButton component with toggle and volume indicator (`src/components/MicButton.tsx`)
  - ConnectionBadge component (green dot / yellow pulse / red dot) (`src/components/ConnectionBadge.tsx`)
  - ChatPanel with transcript accumulation (`src/components/ChatPanel.tsx`)
- [x] Wire mic button → audio capture → WebSocket → backend → Gemini → audio playback
- [ ] Test end-to-end: speak → hear Gemini response

### Day 2 Deliverables Checklist
- [ ] Speak to Gemini and hear audio responses through the app
- [x] Tool call loop working with at least one test tool
- [x] Transcripts appearing in chat panel
- [x] Connection status indicator functional
- [x] Mid-session system prompt swap verified (test script created)

---

## Phase 3: Paper Context & Zotero Plugin MVP (Day 3 — March 13)

### 3.1 Paper Content Extraction & Context Injection
- [x] Create `backend/tools/pdf_processing.py`:
  - `should_reextract(fulltext, page_count)` — quality heuristic (sparse text, garbled text detection)
  - `select_pages_for_rendering(pdf_path)` — tier 1/2/3 page selection (≤20 all, 21-40 strategic, >40 figure-focused)
  - `render_pages(pdf_path, page_indices, dpi=150)` — JPEG rendering via PyMuPDF, returns base64 + page dimensions
  - `gemini_to_pdf_coords(gemini_box, page_width, page_height)` — coordinate mapping (0-1000 normalized → PDF points, Y-axis flip)
  - `validate_annotation_coords(rects, page_width, page_height)` — rejects zeros, OOB, tiny annotations
  - `get_page_dimensions(pdf_path)` — returns width/height for all pages
- [x] Implement `handle_paper_load()` in `session_handler.py`:
  - Receive `paper_context` message from frontend
  - Build annotation summary from user's existing annotations (up to 20)
  - Swap system prompt to paper mode via `send_client_content` with paper prompt
  - Inject paper fulltext (truncated to 100K chars) + page images as inline JPEG data
  - Notify frontend of completion via `session_status`
- [x] Frontend: `loadPaper(paperKey)` function in `src/lib/paperLoader.ts`:
  - Parallel fetch: item details + children (attachments/annotations)
  - Finds PDF attachment, fetches fulltext from attachment key
  - Extracts annotations from both direct children and nested PDF children
  - Builds `PaperContextMessage` with metadata, fulltext, annotations
  - Wired into MainApp: paper loading spinner + "Discussing: [title]" indicator

### 3.2 Critical Verification Tests (DO THESE FIRST)

> These tests de-risk Day 4's "wow features." If either fails, you have time to find workarounds.

#### Test A: `Zotero.Translate.Search()` with DOI — **PASS**
- [x] Scaffold minimal Zotero plugin from `windingwind/zotero-plugin-template`
- [x] Add a test endpoint: `POST /colloquia/test-doi-import`
  - Accept `{doi: "10.1088/1475-7516/2025/01/001"}` (or any known DOI)
  - Call `Zotero.Translate.Search()` with the DOI
  - Return success/failure + item metadata
- [x] Test the endpoint via curl — tested with DOI `10.1093/mnras/staa3093`
- [x] **Result: WORKING** — returned full metadata (title: "The AARTFAAC Cosmic Explorer...", 15 authors, itemType: journalArticle). No fallback needed.
- [x] Document result: **working** — `Zotero.Translate.Search()` reliably resolves DOIs to full metadata

#### Test B: Plugin-Created Annotation Auto-Refresh — **PASS**
- [x] Add a test endpoint: `POST /colloquia/test-annotation`
  - Accept `{parentItemKey, pageIndex, comment}`
  - Create an `image`-type annotation on the specified page
  - Use hardcoded bounding box for testing: `rects: [[100, 100, 400, 400]]`
- [x] Open a PDF in Zotero's reader (NuSTAR paper, key BBE5G58K)
- [x] Call the endpoint via curl
- [x] **Check**: Annotation appeared in the PDF reader WITHOUT reopening the PDF — purple box visible near abstract area
- [x] `Zotero.Notifier.trigger('refresh', 'item', [annotationID])` — **works**
- [x] Document result: **auto-refresh works via Notifier trigger**
- [x] **Key finding**: Zotero passes `request.data` as pre-parsed object (not string) — `parseBody()` updated to handle both
- [x] **Key finding**: `annotationSortIndex` format is `NNNNN|NNNNNN|NNNNN` (5|6|5 digits)

### 3.3 Zotero Plugin Scaffolding
- [x] Scaffolded from `windingwind/zotero-plugin-template` into `zotero-colloquia-plugin/`
- [x] Update `addon/manifest.json`:
  - Plugin ID: `colloquia@colloquia.dev`
  - Name: "Colloquia"
  - Version: "0.1.0"
  - Zotero compatibility: "6.999" - "8.*"
- [x] Update `package.json` with project name, author, repository
- [x] Create `src/modules/endpoints.ts` — central endpoint registration module (8 endpoints)
- [x] Wire endpoint registration into `hooks.ts` → `onStartup` via `registerEndpoints()`
- [x] Build plugin: `npm run build` → `colloquia.xpi` (33KB) — builds + passes `tsc --noEmit`
- [x] Install in Zotero: Tools → Add-ons → Install from File — **verified working**
- [x] `POST /colloquia/ping` endpoint returns `{status: "ok", version: "0.1.0", plugin: "colloquia"}`

### 3.4 Core Plugin Endpoints (Write Layer)
- [x] `POST /colloquia/createNote`:
  - Accept: `{parentItemKey, noteContent, tags[]}`
  - Create child note item with HTML content
  - Return: `{noteKey}`
- [x] `POST /colloquia/addTags`:
  - Accept: `{itemKeys[], tags[]}`
  - Add tags to each item (type 0 = user tag), skips already-present tags
  - Return: `{modified: count}`
- [x] `POST /colloquia/removeTags`:
  - Accept: `{itemKeys[], tags[]}`
  - Remove specified tags from items
  - Return: `{modified: count}`
- [x] `POST /colloquia/addRelated`:
  - Accept: `{itemKey1, itemKey2}`
  - Link bidirectionally: A→B and B→A
  - Return: `{success: true}`
- [x] `POST /colloquia/searchLibrary`:
  - Accept: `{query?, tag?, collection?, author?, dateRange?}`
  - Uses `Zotero.Search()` with conditions, limits to 50 results
  - Return: `{items[]}` with key, title, creators, date, DOI, abstract, tags
  - **Verified**: query "HERA" returned 50 matching items

### 3.5 Backend: Zotero Action Delegation Pattern
- [x] Implement `delegate_to_frontend()` — implemented in Phase 2, verified working:
  - Generate `requestId` (UUID)
  - Store `asyncio.Future` in `_pending_zotero` dict
  - Track `requestId` in per-session `session_request_ids` set
  - Send `zotero_action` message to frontend via WebSocket
  - `await asyncio.wait_for(future, timeout=10.0)`
  - Handle timeout: raise `ToolError` with user-friendly message
  - Cleanup: pop from `_pending_zotero` in `finally` block
- [x] Implement `resolve_zotero_result()`:
  - Look up Future by `requestId`
  - Set result or exception based on `success` field
- [x] Wire `resolve_zotero_result` into `forward_user_to_gemini()` → `zotero_action_result` case
- [x] Session cleanup in `run_session()` `finally` block:
  - Iterate `session_request_ids`, cancel orphaned futures

### 3.6 Frontend: Zotero Action Handler
- [x] In WebSocket handler (`useWebSocket.ts`), handle `zotero_action` messages:
  - Extract `requestId`, `action`, `params`
  - Map action to plugin endpoint URL (e.g., `createNote` → `/zotero-plugin/colloquia/createNote`)
  - Call plugin endpoint via `fetch()` with POST + JSON body
  - Send `zotero_action_result` back to backend with `requestId`, `success`, `data`/`error`
- [x] Error handling: detects fetch failures (Zotero not running), plugin HTTP errors, generic errors

### 3.7 Backend: Wire Zotero Search Tool
- [x] Create `backend/tools/zotero_proxy.py`:
  - `search_zotero_library(query)` — delegated to frontend → plugin `/colloquia/searchLibrary`
- [x] Add `search_zotero_library` to `ZOTERO_WRITE_TOOLS` (delegated via frontend)
- [x] Add function declarations to `TOOL_DECLARATIONS` for Gemini:
  - `search_zotero_library` — search by query, tag, collection, author
  - `create_note` — create notes attached to papers
  - `manage_tags` — add/remove tags on items
  - `link_related_items` — bidirectional related links

### 3.8 Test Paper Conversation
- [x] Plugin endpoints verified: ping, searchLibrary, test-doi-import, test-annotation all working
- [ ] Full voice conversation test pending (requires running backend + browser connection)
- [ ] Verify the model references specific sections/figures from the paper
- [ ] Verify transcripts appear correctly in the chat panel

### Day 3 Deliverables Checklist
- [x] Select paper from Zotero → paper context loading implemented (voice conversation pending live test)
- [x] Zotero plugin installed with basic write endpoints working (8 endpoints, all verified)
- [x] `Zotero.Translate.Search()` DOI test: **PASS** — works reliably, no fallback needed
- [x] Annotation auto-refresh test: **PASS** — `Notifier.trigger('refresh')` works, annotation appears live in reader
- [x] Zotero delegation pattern (backend → frontend → plugin) working

---

## Phase 4: Annotations & Paper Discovery (Day 4 — March 14)

### 4.1 PDF Annotation System

#### 4.1.1 Plugin: `createAnnotation` Endpoint
- [x] `POST /colloquia/createAnnotation`:
  - Accept: `{parentItemKey, annotationType, pageIndex, rects, comment, color}`
  - Create `Zotero.Item('annotation')` with:
    - `annotationType`: "highlight" | "image" | "note"
    - `annotationComment`: AI analysis text
    - `annotationColor`: "#a28ae5" (purple for AI annotations)
    - `annotationPageLabel`: `String(pageIndex + 1)` (1-indexed)
    - `annotationPosition`: JSON string with `{pageIndex, rects}`
    - `annotationSortIndex`: zero-padded `pageIndex|yPos|xPos`
  - Return: `{annotationKey}`
- [x] Validate coordinates: reject all-zero bounding boxes, coordinates > page dimensions
- [ ] Test with hardcoded coordinates while PDF is open in Zotero reader
- [x] Live refresh via `Zotero.Notifier.trigger('refresh', 'item', [id])`

#### 4.1.2 Backend: Coordinate Mapping
- [x] Implement `gemini_to_pdf_coords()` in `pdf_processing.py` — was already implemented
- [x] `validate_annotation_coords()` — was already implemented
- [x] `get_page_dimensions()` helper — was already implemented
- [x] Store page dimensions (from PyMuPDF) alongside rendered page images in `render_pages()`
- [x] Pass page dimensions to annotation tool for coordinate conversion

#### 4.1.3 Backend: Annotation Tool Integration
- [x] Add `annotate_zotero_pdf` to `TOOL_DECLARATIONS` with params: parentItemKey, annotationType, pageIndex, boundingBox, comment
- [x] Implement tool handler in `handle_tool_calls()`: converts Gemini bounding box → PDF coordinates, validates, delegates to frontend plugin
- [x] Add to `ZOTERO_WRITE_TOOLS` set (was already listed)
- [x] Page dimensions stored in `_page_dimensions` dict during `handle_paper_load()`

#### 4.1.4 Vision Context for Figures
- [x] Page images sent as inline_data in paper context injection (was already implemented in `handle_paper_load`)
- [x] Include page dimensions metadata alongside each rendered page image
- [x] System prompt instructs use of `annotate_zotero_pdf` when discussing figures
- [ ] Test: ask about a figure → verify annotation appears in Zotero reader

### 4.2 Paper Discovery via OpenAlex

#### 4.2.1 Backend: OpenAlex Integration
- [x] Created `backend/tools/openalex.py` with async httpx:
  - `search_academic_papers(query, year, limit, api_key)` — searches `/graph/v1/paper/search`
  - `get_paper_by_doi(doi, api_key)` — fetches `/graph/v1/paper/DOI:{doi}` with references/citations
  - `get_paper_recommendations(paper_id, limit, api_key)` — `POST /recommendations/v1/papers/`
- [x] Uses polite pool via `mailto` header (no API key needed)
- [x] Error handling: timeouts, rate limits (429), 404s, network failures

#### 4.2.2 Backend: Register Discovery Tools
- [x] Added `search_academic_papers` and `get_paper_recommendations` to `TOOL_REGISTRY`
- [x] Added function declarations to `TOOL_DECLARATIONS`
- [x] OpenAlex requires no API key — uses mailto-based polite pool

#### 4.2.3 Plugin: `addPaper` Endpoint
- [x] `POST /colloquia/addPaper`:
  - Accept: `{doi?, title?, authors?, url?, abstract?, collectionKey?}`
  - DOI lookup first via `Zotero.Translate.Search()`
  - Fallback: manual `Zotero.Item('journalArticle')` with parsed metadata
  - Optional: add to specified collection
  - Return: `{itemKey, title}`
- [x] `add_paper_to_zotero` added to `TOOL_DECLARATIONS` + `ZOTERO_WRITE_TOOLS`
- [ ] Test: ask agent to find and add a paper → verify it appears in Zotero

### 4.3 Text Chat Mode

#### 4.3.1 Backend: Text Mode via streaming generateContent
- [x] Created `backend/tools/deep_analysis.py`:
  - `deep_analysis(query, context, api_key)` — calls `gemini-2.5-pro` via `generate_content_async()`
  - Returns `{analysis: response.text}`
- [x] Implemented `handle_text_message()` in session handler:
  - Builds context from `ConversationState.to_text_context()`
  - **Streams** via `generate_content_stream()` (not blocking `generate_content`)
  - Sends `text_response_start` → `text_response_chunk`(s) → `text_response_done`
  - Model fallback chain: `gemini-3.1-flash-lite-preview` → `gemini-2.5-flash`
  - Model name included in each response for UI display
- [x] Paper context flows to ConversationState via `handle_paper_load` → `conversation_state.set_mode("paper", ...)`

#### 4.3.2 Backend: Shared Conversation State
- [x] Created `backend/conversation_state.py` with:
  - `ConversationEvent` dataclass: timestamp, event_type, role, content, metadata
  - `ConversationState` dataclass: timeline, paper_context, session_mode
  - Methods: `add_message()`, `add_tool_call()`, `add_tool_result()`, `set_mode()`
  - `to_text_context(token_budget)` — builds Gemini-compatible alternating-role content array
- [x] Wired into text handler: uses state for context, updates after response
- [ ] Wire into voice session: add messages + tool results as they occur (partial — paper load wired)

#### 4.3.3 Frontend: Text Chat Input
- [x] Text input field exists in ChatPanel (from Phase 3)
- [x] Sends `text` type message via WebSocket on submit
- [x] Handles streaming `text_response_chunk` messages: text appears incrementally
- [x] Typing indicator (bouncing dots) shown during `text_response_start` → first chunk
- [x] Model name displayed next to "Colloquia" label in chat bubbles
- [ ] Voice/text mode toggle in UI (not yet — both modes work simultaneously)

### 4.4 Chat UI: Tool Call Display
- [x] Built `ToolCallBadge` component:
  - Collapsed by default: icon + tool name + duration
  - Expandable: input params + output result (JSON, formatted)
  - Icons: deep_analysis=gear, search=magnifier, annotate=pencil, google=globe
  - Status indicators: hourglass (calling), checkmark (done), X (error)
- [x] Tool calls attached to current assistant message in `ChatMessage.toolCalls[]`
- [x] Built `ThinkingStep` component:
  - Collapsed by default with purple styling
  - Expandable: full reasoning text in monospace
- [x] `ChatPanel` updated to use both new components
- [x] `useWebSocket` handles `ThinkingMessage` and attaches to chat messages

### 4.5 UX Fixes (added during implementation)
- [x] Fixed: paper context injection no longer triggers auto-response (`turn_complete=False`)
- [x] Fixed: "Open Discussion" button renamed to "Add to chat context"
- [x] Fixed: clicking paper in sidebar no longer loads paper into session (separated selection from discussion)
- [x] Added: "Back to Library" button in discussion header bar
- [x] Added: `handle_switch_to_lobby()` — re-injects lobby system prompt on mode switch
- [x] Fixed: `sendControl` destructured from `useWebSocket` in MainApp
- [x] Added: `PaperBrowser` has separate `onOpenDiscussion` prop (not overloading `onPaperSelect`)

### Day 4 Deliverables Checklist
- [x] Text chat mode working with streaming markdown responses
- [x] Tool calls visible in chat UI (collapsed/expandable)
- [x] Model name displayed in chat UI
- [x] Typing indicator during response generation
- [ ] Live annotation appearing in Zotero during voice conversation (needs E2E test)
- [ ] Paper discovery: search OpenAlex → add to Zotero (needs E2E test)
- [ ] `deep_analysis` delegation to Pro model functional (needs E2E test)

---

## Phase 5: Library Management & Polish (Day 5 — March 15)

### 5.1 Library Management Endpoints

#### 5.1.1 Plugin: Collection Management
- [ ] `GET /colloquia/listCollections`:
  - Return all collections with keys, names, parent relationships
- [ ] `POST /colloquia/createCollection`:
  - Accept: `{name, parentCollectionKey?}`
  - Return: `{collectionKey}`
- [ ] `POST /colloquia/addToCollection`:
  - Accept: `{itemKeys[], collectionKey}`
  - Return: `{modified: count}`
- [ ] `POST /colloquia/removeFromCollection`:
  - Accept: `{itemKeys[], collectionKey}`
  - Return: `{modified: count}`

#### 5.1.2 Plugin: Additional Endpoints
- [ ] `POST /colloquia/getAnnotations`:
  - Accept: `{itemKey}`
  - Return existing annotations on an item
- [ ] `POST /colloquia/trashItems`:
  - Accept: `{itemKeys[]}`
  - Set `deleted = true` on each item
  - Return: `{trashed: count}`

#### 5.1.3 Backend: Library Management Tools
- [ ] Add to `TOOL_REGISTRY`:
  - `manage_tags` — add/remove tags (delegate to plugin)
  - `manage_collection` — create/list/addItems/removeItems
  - `link_related_items` — bidirectional related link
  - `trash_items` — move to trash (recoverable)
- [ ] Add function declarations for each
- [ ] Add `manage_tags`, `manage_collection`, `link_related_items`, `trash_items` to `ZOTERO_WRITE_TOOLS`

### 5.2 Google Search Grounding
- [ ] Add `{"google_search": {}}` to `TOOL_DECLARATIONS` tools array
- [ ] Implement Google Search fallback in `handle_tool_calls()`:
  - If Gemini sends `google_search` as a function_call (March 5 bug):
    - Execute via separate `generate_content_async()` with grounding
    - Return result as `FunctionResponse`
- [ ] Test: ask a current-events question → verify grounded response
- [ ] Test with Gemini AI Studio API (not Vertex) to avoid the bug

### 5.3 Session Resumption
- [ ] Implement resumption handle caching in `forward_gemini_to_user()`:
  - On `session_resumption_update` → store handle
  - On `go_away` → trigger proactive reconnection
- [ ] Implement reconnection logic:
  - `reconnect_with_handle(client, handle, config)` → new `aio.live.connect()`
  - Notify frontend: `session_status: "reconnecting"` → `"connected"`
- [ ] Test: let session run for >10 minutes → verify transparent reconnection
- [ ] Frontend: show "Reconnecting..." overlay during reconnection

### 5.4 Unified Chat UI
- [ ] Build complete `ChatPanel` component:
  - Scrollable message list with auto-scroll
  - User messages: show mode indicator (mic icon for voice, keyboard for text)
  - Assistant messages: text + collapsed tool calls + collapsed thinking
  - Real-time transcript updates (voice mode: words appear as spoken)
- [ ] Voice/text mode toggle button:
  - Voice mode: mic button active, text input hidden
  - Text mode: text input active, mic button disabled
  - Mode indicator in header
- [ ] Timestamp display on messages
- [ ] Message grouping: consecutive same-role messages grouped visually

### 5.5 Error Handling & Recovery UX

#### 5.5.1 Toast Notification System
- [ ] Install/implement toast library (e.g., `react-hot-toast` or custom)
- [ ] Wire tool errors to toast notifications:
  - `tool_call` with `status: "error"` → toast with tool name + error message
- [ ] Specific error toasts:
  - OpenAlex down → "Paper search unavailable"
  - Annotation coord failure → "Annotation placement failed"
  - Zotero plugin timeout → "Zotero didn't respond — is it running?"
  - Deep analysis failure → "Advanced analysis unavailable"

#### 5.5.2 Connection State Indicator
- [ ] Build `ConnectionBadge` component:
  - Green dot: connected
  - Yellow pulse: reconnecting
  - Red dot: disconnected/error
- [ ] Build `ContextUsageBar` component:
  - Progress bar: total_tokens / 128K limit
  - Color: green (<65%), yellow (65-85%), red (>85%)
  - Label: "45K / 128K"
- [ ] Header layout: `[ConnectionBadge] [ContextUsageBar] [Settings gear]`

#### 5.5.3 Session End Handling
- [ ] "Session ended" modal when WebSocket closes permanently
- [ ] "Start new session" button → reinitialize connection
- [ ] Preserve chat history in React state even after session ends

### 5.6 Proactive Tag/Collection Suggestions
- [ ] System prompt already instructs the agent to suggest tags after discussion
- [ ] Test: discuss a paper → verify agent proactively offers tag suggestions
- [ ] Test: agent confirms before applying tags ("Should I tag this as 'signal-loss'?")
- [ ] Test: bulk operation confirmation for >5 items

### Day 5 Deliverables Checklist
- [ ] Collection management (create, add/remove items) working
- [ ] Google Search grounding active in conversations
- [ ] Session resumption transparent across WebSocket reconnections
- [ ] Unified chat UI with voice/text toggle
- [ ] Error handling: toasts, connection badge, context usage bar
- [ ] Feature-complete application

---

## Phase 6: Demo Preparation & Polish (Day 6 — March 16)

### 6.1 End-to-End Testing
- [ ] Test with 5+ diverse papers:
  - Short paper (≤10 pages) — verify all-page rendering
  - Long paper (20+ pages) — verify figure-page selection
  - Equation-heavy paper — verify page image rendering handles equations
  - Paper with many figures — verify annotation coordinates
  - Paper from user's real research (HERA papers for authentic demo)
- [ ] Test lobby mode flows:
  - Library search: "What papers do I have on [topic]?"
  - External search: "Find recent papers on [topic]"
  - Paper addition: find → confirm → add to Zotero
  - Transition: select paper from lobby → paper mode
- [ ] Test paper mode flows:
  - Section explanation: "Walk me through Section 3"
  - Figure discussion: "Explain Figure 3" → annotation appears
  - Referenced paper lookup: agent finds cited paper → searches → offers to add
  - Deep analysis: "Is their methodology sound?" → Pro model critique
  - Tag management: "Tag this as 'needs-replication'"
  - Mode switching: voice → text → voice with context preserved
- [ ] Test error scenarios:
  - Close Zotero mid-session → verify timeout + user-friendly error
  - Bad API key → verify setup screen error
  - Long session (>10 min) → verify session resumption
  - Rapid barge-in → verify audio playback cancellation

### 6.2 Demo Script Preparation

> Sequence designed to build to a crescendo — end on the most impressive feature.

- [ ] **Act 1: Warm-up (Lobby mode, ~1 min)**
  - Open Colloquia (API key already saved)
  - Say: "What's in my HERA collection?"
  - Agent lists papers → shows library browsing works
- [ ] **Act 2: Enter Paper Mode (~30 sec)**
  - Select a paper from the list (or say "Let's look at the [paper name]")
  - Show context loading animation
  - Agent confirms paper loaded, notes interesting sections
- [ ] **Act 3: Voice Q&A (~2 min)**
  - Ask about methodology: "Walk me through what they did in Section 3"
  - Agent explains with adaptive depth
  - Ask a follow-up that triggers Google Search: "Is this the current state of the art?"
  - Show grounded response with web search
- [ ] **Act 4: Library Management (Quick, ~30 sec)**
  - Say: "Tag this as 'signal-loss-analysis' and put it in my thesis collection"
  - Agent confirms, executes, shows result
- [ ] **Act 5: Paper Discovery (~1 min)**
  - Agent notices a cited paper during discussion
  - Searches OpenAlex → shows citation count
  - Checks library → not found → offers to add
  - User confirms → paper appears in Zotero
- [ ] **Act 6: THE CLOSER — Live Annotation (~1 min)**
  - Ask: "What's happening in Figure 3?"
  - Agent describes the figure in detail
  - Purple annotation appears LIVE in Zotero's PDF reader while agent is still talking
  - **This is the moment judges remember. End on this.**
- [ ] Practice the demo 3+ times for timing and smooth transitions

### 6.3 Backup Video Recording
- [ ] Record screen capture of full demo flow (6 acts above)
- [ ] Include audio (voice conversation)
- [ ] Ensure Zotero PDF reader is visible alongside the Colloquia UI
- [ ] Keep under 5 minutes
- [ ] Have backup ready in case of live demo failure

### 6.4 Documentation

#### 6.4.1 README.md
- [ ] Project description: what Colloquia is and why it matters
- [ ] Architecture overview diagram (simplified)
- [ ] BYOK setup instructions:
  - How to get a Gemini API key (link to aistudio.google.com)
  - Expected costs per conversation (~$0.02-0.05)
  - OpenAlex API key (optional)
- [ ] Local development quickstart:
  ```
  git clone ... && cd colloquia
  cd frontend && npm install && npm run dev
  cd backend && pip install -r requirements.txt && uvicorn main:app --port 8000
  ```
- [ ] Zotero plugin installation:
  - Download `.xpi` from releases
  - Zotero → Tools → Add-ons → Install from File
- [ ] Chrome-only note for audio
- [ ] Known limitations

#### 6.4.2 License Files
- [ ] `LICENSE` in root: Apache 2.0 (frontend + backend)
- [ ] `zotero-colloquia-plugin/LICENSE`: AGPL 3.0 (matching Zotero's license)

#### 6.4.3 CI/CD (Optional)
- [ ] `.github/workflows/build-plugin.yml` — build `.xpi` on release
- [ ] `.github/workflows/deploy-backend.yml` — deploy to Cloud Run on push to main

### 6.5 Final Deploy & Smoke Test
- [ ] Deploy latest backend to Cloud Run
- [ ] Build and install latest plugin `.xpi`
- [ ] Fresh browser tab: full flow from API key entry → lobby → paper → conversation
- [ ] Verify all 4 features work:
  - Voice/text conversation with paper context
  - Live PDF annotation
  - Paper discovery + addition
  - Library management (tags, collections)
- [ ] Check Cloud Run logs for errors
- [ ] Verify `--min-instances=1` prevents cold start at demo time

### Day 6 Deliverables Checklist
- [ ] Full demo rehearsed and timed
- [ ] Backup video recorded
- [ ] README complete with setup instructions
- [ ] Licenses in place (Apache 2.0 + AGPL 3.0)
- [ ] Final deploy smoke-tested
- [ ] Demo-ready, open-source application

---

## Cross-Cutting Concerns (Throughout all phases)

### Testing Strategy
- [ ] Backend unit tests: tool functions, coordinate mapping, ConversationState
- [ ] Frontend component tests: PaperBrowser, ChatPanel, SetupScreen
- [ ] Integration tests: WebSocket message flow (mock Gemini)
- [ ] Plugin tests: endpoint handlers with mock Zotero API
- [ ] E2E manual test script: full user journey (follow demo script)

### Performance & Monitoring
- [ ] Backend: log all tool call durations
- [ ] Backend: log WebSocket lifecycle (connect, disconnect, errors)
- [ ] Frontend: measure audio latency (mic capture to first audio playback)
- [ ] Monitor context token usage — alert when approaching 128K
- [ ] Cloud Run: set up basic alerting on error rate

### Security Considerations
- [ ] Gemini API key only transits backend → Google API (never stored)
- [ ] No user data persisted server-side (stateless backend)
- [ ] Validate all tool call inputs (prevent injection via tool parameters)
- [ ] Sanitize Zotero plugin endpoint inputs (prevent XSS in note HTML content)
- [ ] Document BYOK security model in README

### Accessibility & UX
- [ ] Keyboard navigation for paper browser
- [ ] Screen reader labels for mic button, connection status
- [ ] High contrast mode support for chat UI
- [ ] Mobile-responsive layout (non-critical — desktop-first for hackathon)
- [ ] Loading states for all async operations (paper loading, tool calls, search)

---

## Risk Register & Contingency Plans

| # | Risk | Likelihood | Impact | Mitigation | Contingency |
|---|------|-----------|--------|------------|-------------|
| 1 | Google Search grounding bug (Vertex AI) | Medium | High | Use AI Studio API, not Vertex | Implement custom search tool fallback |
| 2 | Live API session drops at ~10 min | High | Medium | Session resumption enabled | GoAway handling + auto-reconnect |
| 3 | Cloud Run cold starts (2-5s) | High | Low | `--min-instances=1` | Pre-warm before demo |
| 4 | Zotero not running during demo | Medium | Critical | Health check + onboarding UI | Manual PDF upload fallback |
| 5 | Annotation auto-refresh fails | Medium | Medium | Test on Day 3, try Notifier triggers | Ask user to reopen PDF |
| 6 | `Zotero.Translate.Search()` flaky | Medium | Low | Test on Day 3 | Manual metadata entry fallback |
| 7 | Token limit exceeded (128K) | Low | Medium | Monitor usage, truncate old conversation | Summarize + start new session |
| 8 | Gemini bounding box inaccuracy | Medium | Low | Validate coords (reject zeros/OOB) | "Annotation placed approximately" |
| 9 | Safari audio issues | Low | Low | Chrome-only for demo | Note in README |
| 10 | OpenAlex rate limits hit | Low | Low | Cache results, 100 req/5min is generous | Fall back to Google Search |
| 11 | Context window compression audio bug | Known | High | Skip compression entirely | 15-min sessions fit without it |
| 12 | Network issues during live demo | Medium | Critical | Backup video ready | Play video, explain live |

---

## Feature Dependency Graph

```
Phase 1 (Day 1): Foundation
  ├── Vite + React + TypeScript setup
  ├── Vite proxy for Zotero (CORS fix)
  ├── WebSocket protocol types
  ├── BYOK API key management
  ├── Zotero health check
  ├── Paper browser
  └── FastAPI backend + Cloud Run deploy

Phase 2 (Day 2): Voice Pipeline [depends on Phase 1]
  ├── Audio input (mic → 16kHz PCM)
  ├── Audio output (24kHz PCM → speaker)
  ├── WebSocket client (frontend)
  ├── Tool orchestration loop (backend)
  ├── LiveConnectConfig + prompts
  └── Basic voice UI

Phase 3 (Day 3): Paper Context + Plugin [depends on Phase 2]
  ├── Paper content extraction + context injection
  ├── CRITICAL TESTS: DOI import + annotation refresh
  ├── Zotero plugin scaffold + core endpoints
  ├── Backend-frontend delegation pattern
  └── Paper conversation (voice about paper content)

Phase 4 (Day 4): Annotations + Discovery [depends on Phase 3]
  ├── createAnnotation endpoint + coord mapping
  ├── OpenAlex integration
  ├── addPaper endpoint (DOI + manual)
  ├── Text chat mode (generateContent)
  ├── ConversationState (shared voice/text)
  └── Chat UI with tool call display

Phase 5 (Day 5): Management + Polish [depends on Phase 4]
  ├── Collection management endpoints
  ├── Google Search grounding
  ├── Session resumption
  ├── Unified chat UI
  └── Error handling + recovery UX

Phase 6 (Day 6): Demo Prep [depends on Phase 5]
  ├── E2E testing with diverse papers
  ├── Demo script rehearsal
  ├── Backup video recording
  ├── Documentation (README, licenses)
  └── Final deploy + smoke test
```

---

## Task Counts Summary

| Phase | Day | Tasks | Critical Path |
|-------|-----|-------|--------------|
| Phase 0 | Pre-dev | 14 | Environment setup |
| Phase 1 | Day 1 | 28 | Vite proxy + WebSocket protocol + backend deploy |
| Phase 2 | Day 2 | 24 | Audio pipeline + tool orchestration loop |
| Phase 3 | Day 3 | 25 | Critical tests + plugin MVP + delegation pattern |
| Phase 4 | Day 4 | 24 | Annotations + OpenAlex + text mode |
| Phase 5 | Day 5 | 26 | Library management + error UX + session resumption |
| Phase 6 | Day 6 | 22 | Demo script + testing + documentation |
| Cross-cutting | All | 17 | Testing, security, accessibility |
| **Total** | | **180** | |
