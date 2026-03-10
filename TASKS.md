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
- [ ] Obtain Semantic Scholar API key (optional, for higher rate limits) — skipped for now
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
- [ ] Initialize Vite + React + TypeScript project in `frontend/`
- [ ] Install core dependencies: `react`, `react-dom`, `typescript`, Tailwind CSS (or styling lib of choice)
- [ ] Configure `tsconfig.json` with strict mode
- [ ] Set up ESLint + Prettier
- [ ] Create base `App.tsx` with routing skeleton (setup screen vs main app)

### 1.2 Vite Proxy Configuration (CORS solution)
- [ ] Configure `/zotero-api` proxy in `vite.config.ts`:
  - Target: `http://localhost:23119`
  - Rewrite: `/zotero-api` → `/api`
  - Add headers: `Zotero-Allowed-Request: 1`, `User-Agent: Colloquia/1.0`
- [ ] Configure `/zotero-plugin` proxy in `vite.config.ts`:
  - Target: `http://localhost:23119`
  - Rewrite: `/zotero-plugin` → (strip prefix)
  - Add header: `Zotero-Allowed-Request: 1`
- [ ] Verify both proxies work with manual browser requests

### 1.3 WebSocket Protocol Definition (Critical — prevents integration debt)
- [ ] Define `ClientMessage` union type in `src/lib/protocol.ts`:
  - `config` — API key handshake (first message)
  - `audio` — base64 PCM16 audio chunk
  - `text` — text chat input
  - `paper_context` — paper loading payload (fulltext, metadata, pageImages)
  - `zotero_action_result` — response from Zotero plugin operations
  - `control` — start/stop/switch_mode
- [ ] Define `ServerMessage` union type:
  - `audio` — base64 PCM16 audio response
  - `transcript` — user/model text transcription
  - `text_response` — text mode markdown response
  - `zotero_action` — backend→frontend Zotero write command
  - `tool_call` — tool invocation lifecycle (calling/done/error)
  - `thinking` — Pro model reasoning trace
  - `context_usage` — token usage for progress bar
  - `error` — error message
  - `session_status` — connected/reconnecting/ended
- [ ] Export shared types for both frontend and backend consumption

### 1.4 BYOK API Key Management
- [ ] Create `src/lib/apiKeys.ts`:
  - `getGeminiKey()` / `setGeminiKey()` — `localStorage` read/write
  - `getS2Key()` / `setS2Key()` — Semantic Scholar key (optional)
  - `clearAll()` — remove all keys
- [ ] Build `SetupScreen` component:
  - Gemini API key input (required) with paste support
  - Semantic Scholar API key input (optional, with "skip" option)
  - "Your key is stored locally" privacy notice
  - Validation: ping Gemini API on save to confirm key works
  - Save button → persist to `localStorage` → navigate to main app
- [ ] App startup logic: if key exists in `localStorage`, skip setup, go to main app
- [ ] Settings panel (gear icon): "Change API key" option

### 1.5 Zotero Health Check
- [ ] Create `src/hooks/useZoteroHealth.ts`:
  - Ping `/zotero-api/users/0/items/top?limit=1` on startup
  - Return `ZoteroState`: `{ available, pluginInstalled, libraryEmpty }`
  - Check plugin via `/zotero-plugin/colloquia/ping` (once plugin exists)
- [ ] Build onboarding UI based on state:
  - `!available` → "Install Zotero 7 and enable API access" with setup steps
  - `!pluginInstalled` → "Install the Colloquia plugin" with download link
  - `libraryEmpty` → "Your library is empty" with search prompt + lobby suggestion
  - All good → main app (lobby mode)

### 1.6 Paper Browser Component
- [ ] Build `PaperBrowser` component:
  - Fetch top-level items: `GET /zotero-api/users/0/items/top`
  - Display list: title, authors, year, journal
  - Search bar: `GET /zotero-api/users/0/items?q={query}&qmode=everything`
  - Collection sidebar: `GET /zotero-api/users/0/collections`
  - Filter by collection: `GET /zotero-api/users/0/collections/{key}/items`
- [ ] Paper selection handler:
  - On click → fetch metadata, children (annotations), fulltext
  - Store selected paper in React state
  - Signal session mode transition (will wire to WebSocket later)
- [ ] Display paper metadata panel: title, authors, abstract, DOI, tags, collections

### 1.7 Backend Skeleton (FastAPI)
- [ ] Initialize FastAPI project in `backend/`:
  - `main.py` — app creation, CORS middleware, health endpoint
  - `requirements.txt`: `fastapi`, `uvicorn[standard]`, `websockets`, `google-genai`, `httpx`
- [ ] Create WebSocket endpoint `ws://localhost:8000/ws`:
  - Accept connection
  - Await `config` message with Gemini API key
  - Create per-session `genai.Client(api_key=...)`
  - Log connection + key receipt (key masked)
- [ ] Add `GET /health` endpoint (returns 200 — needed for Cloud Run)
- [ ] Test locally: `uvicorn main:app --reload --port 8000`
- [ ] Verify basic `genai.Client.aio.live.connect()` call works with user-provided key

### 1.8 Cloud Run Initial Deployment
- [ ] Create `backend/Dockerfile`:
  - Python 3.11 slim base
  - Install dependencies from `requirements.txt`
  - Run: `uvicorn main:app --host 0.0.0.0 --port $PORT`
- [ ] Deploy to Cloud Run:
  - `gcloud run deploy colloquia-backend --source=backend/ --region=us-central1 --timeout=3600 --min-instances=1 --allow-unauthenticated`
- [ ] Verify WebSocket connection works via Cloud Run URL
- [ ] Update frontend to use Cloud Run backend URL (env variable or config)

### Day 1 Deliverables Checklist
- [ ] Browse and search Zotero library in the UI
- [ ] Backend deployed to Cloud Run with WebSocket endpoint
- [ ] WebSocket protocol fully typed in TypeScript
- [ ] API key entry + persistence working
- [ ] Zotero health check + onboarding UI functional

---

## Phase 2: Voice Pipeline & Tool Orchestration (Day 2 — March 12)

### 2.1 Audio Input Pipeline (Mic → Gemini)
- [ ] Create `src/lib/audio-worklet-processor.ts`:
  - `AudioWorkletProcessor` subclass for PCM capture
  - Float32 → Int16 conversion (`sample * 0x7FFF`)
  - Post Int16 PCM buffer via `port.postMessage()`
- [ ] Register worklet in audio context: `audioContext.audioWorklet.addModule()`
- [ ] Create `src/hooks/useAudioCapture.ts`:
  - `getUserMedia({ audio: { channelCount: 1 } })`
  - Create `AudioContext({ sampleRate: 16000 })` (Chrome-only; Safari ignores this)
  - Connect MediaStreamSource → AudioWorkletNode
  - Worklet `onmessage` → base64-encode PCM → send via WebSocket
- [ ] Microphone permission handling: request, grant, deny states in UI
- [ ] Mic toggle button: start/stop capture with visual indicator

### 2.2 Audio Output Pipeline (Gemini → Speaker)
- [ ] Fork/adapt `audio-streamer.ts` from `live-api-web-console`:
  - Receive base64 PCM16 chunks from WebSocket
  - Decode to Int16Array → Float32 (`sample / 32768.0`)
  - Create `AudioBuffer` at 24kHz sample rate
  - Schedule playback using `AudioBufferSourceNode.start(scheduledTime)`
  - Maintain playback queue for smooth continuous audio
- [ ] Handle interruptions:
  - On `server_content.interrupted` → stop all queued sources, clear queue
  - On user barge-in (mic active + model speaking) → clear playback
- [ ] Visual audio indicator: waveform or volume level during playback

### 2.3 WebSocket Client (Frontend)
- [ ] Create `src/hooks/useWebSocket.ts`:
  - Connect to backend WebSocket URL
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
  - Reconnection logic with exponential backoff

### 2.4 Backend: Tool Orchestration Loop (Core)
- [ ] Create `backend/session_handler.py`:
  - `run_session(ws, session, config_msg)` — main event loop
  - Two concurrent tasks via `asyncio.create_task()`:
    - `forward_user_to_gemini()` — read from frontend WS, send to Gemini
    - `forward_gemini_to_user()` — read from Gemini, handle tool calls, forward to frontend
  - `asyncio.wait(return_when=FIRST_COMPLETED)` — cancel counterpart on exit
- [ ] Implement `forward_user_to_gemini()`:
  - `audio` → `session.send_realtime_input(audio=Blob(...))`
  - `text` → `session.send_client_content(turns=Content(role="user", ...))`
  - `paper_context` → `handle_paper_load()` (Day 3)
  - `zotero_action_result` → `resolve_zotero_result()` (Day 3)
- [ ] Implement `forward_gemini_to_user()`:
  - `message.data` → forward audio to frontend as base64
  - `message.tool_call` → `handle_tool_calls()` (execute + respond)
  - `message.server_content` → extract transcripts (input/output), handle interruptions
  - `message.usage_metadata` → forward `context_usage` to frontend
  - `message.session_resumption_update` → cache resumption handle
  - `message.go_away` → trigger reconnection
- [ ] Implement `handle_tool_calls()`:
  - Notify frontend of tool call start (`tool_call` status: "calling")
  - Execute tool from `TOOL_REGISTRY` dict
  - Handle Google Search grounding fallback (if bug is active)
  - Delegate Zotero write tools to frontend (Day 3)
  - Notify frontend of result (`tool_call` status: "done" or "error")
  - Send `FunctionResponse` back to Gemini via `session.send_tool_response()`
- [ ] Create `TOOL_REGISTRY` dict with at least one test tool (e.g., `echo` tool)

### 2.5 Backend: LiveConnectConfig Setup
- [ ] Configure `LiveConnectConfig`:
  - `response_modalities=["AUDIO"]`
  - `system_instruction=LOBBY_SYSTEM_PROMPT`
  - `tools=TOOL_DECLARATIONS` (start with empty, add incrementally)
  - `session_resumption=SessionResumptionConfig()`
  - `output_audio_transcription=AudioTranscriptionConfig()`
  - `input_audio_transcription=AudioTranscriptionConfig()`
  - **No compression** (skip for hackathon — known audio cutoff bug)
- [ ] Create `backend/prompts/lobby.py` with lobby system prompt
- [ ] Create `backend/prompts/paper.py` with paper system prompt template

### 2.6 Backend: Verify Mid-Session System Prompt Swap
- [ ] Test `send_client_content(role="system")` for lobby→paper transition:
  - Send new system instruction mid-session
  - Verify conversation history is preserved
  - Verify new instruction takes effect for subsequent responses
- [ ] If `role="system"` doesn't work as expected, implement fallback:
  - Send updated instruction as a user turn with explicit "system instruction update" framing

### 2.7 Basic Voice UI
- [ ] Build minimal conversation UI:
  - Large mic button (hold-to-talk or toggle)
  - Connection status badge (green dot / yellow pulse / red dot)
  - Basic chat transcript area showing user + model text
- [ ] Wire mic button → audio capture → WebSocket → backend → Gemini → audio playback
- [ ] Test end-to-end: speak → hear Gemini response

### Day 2 Deliverables Checklist
- [ ] Speak to Gemini and hear audio responses through the app
- [ ] Tool call loop working with at least one test tool
- [ ] Transcripts appearing in chat panel
- [ ] Connection status indicator functional
- [ ] Mid-session system prompt swap verified

---

## Phase 3: Paper Context & Zotero Plugin MVP (Day 3 — March 13)

### 3.1 Paper Content Extraction & Context Injection
- [ ] Create `backend/tools/pdf_processing.py`:
  - `should_reextract(fulltext, page_count)` — quality heuristic
  - `select_pages_for_rendering(pdf_path)` — tier 1/2/3 page selection
  - `render_pages(pdf_path, page_indices, dpi=150)` — JPEG rendering via PyMuPDF
  - `gemini_to_pdf_coords(gemini_box, page_width, page_height)` — coordinate mapping
- [ ] Implement `handle_paper_load()` in `session_handler.py`:
  - Receive `paper_context` message from frontend
  - Swap system prompt to paper mode via `send_client_content(role="system")`
  - Inject paper text + page images as structured context turns
  - Verify Gemini can reference paper content in responses
- [ ] Frontend: `loadPaper(paperKey)` function:
  - Parallel fetch: fulltext, metadata, children (annotations)
  - Optional: render page images client-side (or delegate to backend)
  - Send `paper_context` message via WebSocket
  - Update UI to paper mode

### 3.2 Critical Verification Tests (DO THESE FIRST)

> These tests de-risk Day 4's "wow features." If either fails, you have time to find workarounds.

#### Test A: `Zotero.Translate.Search()` with DOI
- [ ] Scaffold minimal Zotero plugin from `windingwind/zotero-plugin-template`
- [ ] Add a test endpoint: `POST /colloquia/test-doi-import`
  - Accept `{doi: "10.1088/1475-7516/2025/01/001"}` (or any known DOI)
  - Call `Zotero.Translate.Search()` with the DOI
  - Return success/failure + item metadata
- [ ] Test the endpoint via curl
- [ ] **If it fails**: Confirm manual metadata fallback works (`new Zotero.Item('journalArticle')` + setField)
- [ ] Document result: working / flaky / needs fallback

#### Test B: Plugin-Created Annotation Auto-Refresh
- [ ] Add a test endpoint: `POST /colloquia/test-annotation`
  - Accept `{parentItemKey, pageIndex, comment}`
  - Create an `image`-type annotation on the specified page
  - Use hardcoded bounding box for testing: `rects: [[100, 100, 400, 400]]`
- [ ] Open a PDF in Zotero's reader
- [ ] Call the endpoint via curl
- [ ] **Check**: Does the annotation appear in the PDF reader WITHOUT reopening the PDF?
- [ ] **If auto-refresh fails**: Try `Zotero.Notifier.trigger('refresh', 'item', [annotationID])`
- [ ] **If that fails too**: Try `Zotero.Notifier.trigger('redraw', 'item', [parentAttachmentID])`
- [ ] Document result: auto-refresh works / needs Notifier trigger / needs manual reopen

### 3.3 Zotero Plugin Scaffolding
- [ ] Clone `windingwind/zotero-plugin-template` into `zotero-colloquia-plugin/`
- [ ] Update `addon/manifest.json`:
  - Plugin ID: `colloquia@colloquia.dev`
  - Name: "Colloquia"
  - Version: "0.1.0"
  - Zotero compatibility: "7.0" - "*"
- [ ] Update `package.json` with project name
- [ ] Create `src/modules/endpoints.ts` — central endpoint registration module
- [ ] Wire endpoint registration into `hooks.ts` → `onStartup`
- [ ] Build plugin: `npm run build` → verify `.xpi` output
- [ ] Install in Zotero: Tools → Add-ons → Install from File
- [ ] Add `POST /colloquia/ping` endpoint (health check) — return `{status: "ok", version: "0.1.0"}`

### 3.4 Core Plugin Endpoints (Write Layer)
- [ ] `POST /colloquia/createNote`:
  - Accept: `{parentItemKey, noteContent, tags[]}`
  - Create child note item with HTML content
  - Return: `{noteKey}`
- [ ] `POST /colloquia/addTags`:
  - Accept: `{itemKeys[], tags[]}`
  - Add tags to each item (type 0 = user tag)
  - Return: `{modified: count}`
- [ ] `POST /colloquia/removeTags`:
  - Accept: `{itemKeys[], tags[]}`
  - Remove specified tags from items
  - Return: `{modified: count}`
- [ ] `POST /colloquia/addRelated`:
  - Accept: `{itemKey1, itemKey2}`
  - Link bidirectionally: A→B and B→A
  - Return: `{success: true}`
- [ ] `POST /colloquia/searchLibrary`:
  - Accept: `{query?, tag?, collection?, author?, dateRange?}`
  - Return: `{items[]}` with metadata

### 3.5 Backend: Zotero Action Delegation Pattern
- [ ] Implement `delegate_to_frontend()`:
  - Generate `requestId` (UUID)
  - Store `asyncio.Future` in `_pending_zotero` dict
  - Track `requestId` in per-session `session_request_ids` set
  - Send `zotero_action` message to frontend via WebSocket
  - `await asyncio.wait_for(future, timeout=10.0)`
  - Handle timeout: raise `ToolError` with user-friendly message
  - Cleanup: pop from `_pending_zotero` in `finally` block
- [ ] Implement `resolve_zotero_result()`:
  - Look up Future by `requestId`
  - Set result or exception based on `success` field
- [ ] Wire `resolve_zotero_result` into `forward_user_to_gemini()` → `zotero_action_result` case
- [ ] Session cleanup in `run_session()` `finally` block:
  - Iterate `session_request_ids`, cancel orphaned futures

### 3.6 Frontend: Zotero Action Handler
- [ ] In WebSocket handler, handle `zotero_action` messages:
  - Extract `requestId`, `action`, `params`
  - Map action to plugin endpoint URL (e.g., `createNote` → `/zotero-plugin/colloquia/createNote`)
  - Call plugin endpoint via `fetch()` with POST + JSON body
  - Send `zotero_action_result` back to backend with `requestId`, `success`, `data`/`error`
- [ ] Error handling: catch fetch errors, Zotero-not-running, plugin-not-installed

### 3.7 Backend: Wire Zotero Search Tool
- [ ] Create `backend/tools/zotero_proxy.py`:
  - `search_zotero_library(query)` — search user's library
  - This is a Zotero read operation, so it can be proxied through frontend's `/zotero-api`
  - OR: the backend sends the search query to frontend, frontend calls Zotero API, returns results
- [ ] Add `search_zotero_library` to `TOOL_REGISTRY`
- [ ] Add function declaration to `TOOL_DECLARATIONS` for Gemini

### 3.8 Test Paper Conversation
- [ ] Select a paper from the browser → load full text into session
- [ ] Have a voice conversation about the paper content
- [ ] Verify the model references specific sections/figures from the paper
- [ ] Verify transcripts appear correctly in the chat panel

### Day 3 Deliverables Checklist
- [ ] Select paper from Zotero → voice conversation about its content
- [ ] Zotero plugin installed with basic write endpoints working
- [ ] `Zotero.Translate.Search()` DOI test: pass/fail documented
- [ ] Annotation auto-refresh test: pass/fail documented
- [ ] Zotero delegation pattern (backend → frontend → plugin) working

---

## Phase 4: Annotations & Paper Discovery (Day 4 — March 14)

### 4.1 PDF Annotation System

#### 4.1.1 Plugin: `createAnnotation` Endpoint
- [ ] `POST /colloquia/createAnnotation`:
  - Accept: `{parentItemKey, annotationType, pageIndex, rects, comment, color}`
  - Create `Zotero.Item('annotation')` with:
    - `annotationType`: "highlight" | "image" | "note"
    - `annotationComment`: AI analysis text
    - `annotationColor`: "#a28ae5" (purple for AI annotations)
    - `annotationPageLabel`: `String(pageIndex + 1)` (1-indexed)
    - `annotationPosition`: JSON string with `{pageIndex, rects}`
    - `annotationSortIndex`: zero-padded `pageIndex|yPos|xPos`
  - Return: `{annotationKey}`
- [ ] Validate coordinates: reject all-zero bounding boxes, coordinates > page dimensions
- [ ] Test with hardcoded coordinates while PDF is open in Zotero reader
- [ ] Verify live refresh (apply fix from Day 3 Test B if needed)

#### 4.1.2 Backend: Coordinate Mapping
- [ ] Implement `gemini_to_pdf_coords()` in `pdf_processing.py`:
  - Input: `[y_min, x_min, y_max, x_max]` in Gemini's 0-1000 space
  - Output: `[[x1, y1, x2, y2]]` in PDF points
  - Y-axis flip: Gemini origin is top-left, PDF origin is bottom-left
- [ ] Store page dimensions (from PyMuPDF) alongside rendered page images
- [ ] Pass page dimensions to annotation tool for coordinate conversion

#### 4.1.3 Backend: Annotation Tool Integration
- [ ] Add `annotate_zotero_pdf` to `TOOL_DECLARATIONS`:
  - Parameters: parentItemKey, annotationType, pageIndex, boundingBox, comment
  - Description: "Create a visual annotation on the PDF in Zotero's reader..."
- [ ] Implement tool handler in `handle_tool_calls()`:
  - Convert Gemini bounding box → PDF coordinates
  - Validate coordinates (reject zeros, out-of-range)
  - Delegate to frontend → plugin endpoint
- [ ] Add to `ZOTERO_WRITE_TOOLS` set

#### 4.1.4 Vision Context for Figures
- [ ] Send rendered page images (JPEG, 150 DPI) as inline_data in paper context injection
- [ ] Include page dimensions metadata for each rendered page
- [ ] Instruct system prompt to use `annotate_zotero_pdf` when discussing figures
- [ ] Test: ask about a figure → verify annotation appears in Zotero reader

### 4.2 Paper Discovery via Semantic Scholar

#### 4.2.1 Backend: Semantic Scholar Integration
- [ ] Create `backend/tools/semantic_scholar.py`:
  - `search_academic_papers(query, year, limit)`:
    - Call `GET /graph/v1/paper/search` with fields
    - Return structured results: title, authors, year, citationCount, doi, abstract, venue
    - Handle rate limits gracefully (100 req/5min unauthenticated)
  - `get_paper_by_doi(doi)`:
    - Call `GET /graph/v1/paper/DOI:{doi}` with references, citations
  - `get_paper_recommendations(paper_id, limit)`:
    - Call `POST /recommendations/v1/papers/` with positive paper IDs
- [ ] Optional: Add Semantic Scholar API key support via config message (higher rate limits)
- [ ] Add error handling: network failures, rate limits, empty results

#### 4.2.2 Backend: Register Discovery Tools
- [ ] Add to `TOOL_REGISTRY`:
  - `search_academic_papers`
  - `get_paper_recommendations`
- [ ] Add function declarations to `TOOL_DECLARATIONS`
- [ ] Add `search_zotero_library` tool (check if paper exists locally before adding)

#### 4.2.3 Plugin: `addPaper` Endpoint
- [ ] `POST /colloquia/addPaper`:
  - Accept: `{doi?, title?, authors?, url?, abstract?, collectionKey?}`
  - Try DOI lookup first: `Zotero.Translate.Search()` (from Day 3 test)
  - Fallback: manual `Zotero.Item('journalArticle')` with metadata
  - Optional: add to specified collection
  - Return: `{itemKey, title}`
- [ ] Add `add_paper_to_zotero` to `TOOL_REGISTRY` + `ZOTERO_WRITE_TOOLS`
- [ ] Test: ask agent to find and add a paper → verify it appears in Zotero

### 4.3 Text Chat Mode

#### 4.3.1 Backend: Text Mode via generateContent
- [ ] Create `backend/tools/deep_analysis.py`:
  - `deep_analysis(query, context)`:
    - Call `gemini-3.1-pro-preview` via `generate_content_async()`
    - Return `{analysis: response.text}`
- [ ] Implement `handle_text_message()` in session handler:
  - Build context from `ConversationState.to_text_context()`
  - Call `gemini-3.1-flash-lite` via `generate_content_async()`
  - Send `text_response` message to frontend (markdown)
  - Handle tool calls in response (if Flash-Lite triggers any)

#### 4.3.2 Backend: Shared Conversation State
- [ ] Implement `ConversationState` dataclass:
  - `timeline: list[ConversationEvent]` — chronological events
  - `paper_context: dict | None`
  - `session_mode: str` — "lobby" | "paper"
  - `add_message(role, text)` — append message event
  - `add_tool_result(tool, output)` — append tool result event
  - `to_text_context(token_budget)` — build content array for generateContent
- [ ] Wire into voice session: add messages + tool results as they occur
- [ ] Wire into text handler: use state for context, update after response

#### 4.3.3 Frontend: Text Chat Input
- [ ] Add text input field below chat panel
- [ ] Send `text` type message via WebSocket on submit
- [ ] Handle `text_response` messages: render markdown in chat
- [ ] Voice/text mode toggle in UI (visual indicator of current mode)

### 4.4 Chat UI: Tool Call Display
- [ ] Build `ToolCallBadge` component:
  - Collapsed by default: icon + tool name + duration
  - Expandable: input params + output result (JSON, formatted)
  - Icons: deep_analysis=gear, search=magnifier, annotate=pencil, google=globe
- [ ] Attach tool calls to the current assistant message in `ChatMessage.toolCalls[]`
- [ ] Build `ThinkingStep` component (for Pro reasoning traces):
  - Collapsed by default
  - Expandable: full reasoning text

### Day 4 Deliverables Checklist
- [ ] Live annotation appearing in Zotero during voice conversation
- [ ] Paper discovery: search Semantic Scholar → add to Zotero
- [ ] Text chat mode working with markdown responses
- [ ] `deep_analysis` delegation to Pro model functional
- [ ] Tool calls visible in chat UI (collapsed/expandable)

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
  - Semantic Scholar down → "Paper search unavailable"
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
  - Searches Semantic Scholar → shows citation count
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
  - Semantic Scholar API key (optional)
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
| 10 | Semantic Scholar rate limits hit | Low | Low | Cache results, 100 req/5min is generous | Fall back to Google Search |
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
  ├── Semantic Scholar integration
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
| Phase 4 | Day 4 | 24 | Annotations + Semantic Scholar + text mode |
| Phase 5 | Day 5 | 26 | Library management + error UX + session resumption |
| Phase 6 | Day 6 | 22 | Demo script + testing + documentation |
| Cross-cutting | All | 17 | Testing, security, accessibility |
| **Total** | | **180** | |
