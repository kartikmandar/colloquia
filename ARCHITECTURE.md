# Colloquia: hackathon architecture and implementation guide

**Colloquia is an open-source, voice-enabled paper discussion app that lets researchers have live conversations about academic papers stored in their Zotero library.** It's a bring-your-own-key (BYOK) application — users provide their own Gemini API key, and no user data or API keys are stored server-side. Licensed under **Apache 2.0**. The fastest path to a working prototype combines a FastAPI backend using the `google-genai` SDK directly (via `aio.live.connect()`), a Vite-proxied local Zotero connection, a companion Zotero 7 plugin for write operations, and the Gemini Live API via WebSocket — deliverable in 6 days for the Gemini Live Agent Challenge (deadline March 17, 2026). We use the raw SDK instead of Google's ADK framework because ADK's Python client cannot inject per-session API keys (confirmed open issue #2560), which breaks our BYOK architecture. The tradeoff — writing ~300 lines of tool orchestration manually — buys us full control over per-user keys, transparent debugging, and no opaque abstraction layers to fight during a 6-day sprint.

---

## The core experience: real-time paper understanding

Everything else in this guide — the plugin, the annotations, the library management — is scaffolding around one central experience: **you open a paper and talk to someone who has read it deeply, understands the methodology, can explain any concept in it, and can look things up on the web in real time to fill in gaps.** That's Colloquia.

### Two modes: lobby and paper discussion

Colloquia has two conversation states, each with its own system prompt:

**Lobby mode (no paper selected):** The user opens Colloquia and starts talking before picking a paper. The agent acts as a general research assistant with access to the user's Zotero library, OpenAlex, and web search. This is the natural starting state — the user might say "find me papers about 21cm foreground subtraction" or "what's in my HERA collection?" or "catch me up on recent CMB lensing results." The agent can search, browse, and recommend papers, and when the user picks one, the session transitions to paper mode.

**Paper mode (paper selected):** The full paper context is loaded and the agent becomes a deep discussion partner for that specific paper. All annotation, tagging, and figure-analysis tools become available.

The transition is seamless — when the user selects a paper (either by clicking in the UI or by voice: "let's look at the DeBoer et al. paper"), the backend injects the paper context into the existing session via `send_client_content()` and swaps to the paper system prompt. The conversation history is preserved.

```typescript
// Frontend state machine
type SessionMode = "lobby" | "paper";

// Transition: user selects a paper in the UI or agent identifies one from voice
async function loadPaper(paperKey: string) {
  // Fetch paper content from Zotero via proxy — parallel, not sequential
  const [fulltextResp, metadataResp, childrenResp] = await Promise.all([
    fetch(`/zotero-api/users/0/items/${paperKey}/fulltext`).then(r => r.json()),
    fetch(`/zotero-api/users/0/items/${paperKey}`).then(r => r.json()),
    fetch(`/zotero-api/users/0/items/${paperKey}/children`).then(r => r.json()),
  ]);

  // Send to backend — this triggers lobby→paper transition + context injection
  ws.send(JSON.stringify({
    type: "paper_context",
    paperKey,
    fulltext: fulltextResp.content,
    metadata: metadataResp,
    annotations: childrenResp.filter((c: any) => c.data?.itemType === "annotation"),
    pageImages: renderedPages  // optional: key figure pages as base64
  }));

  setSessionMode("paper");
}
```

### What a lobby session feels like

You open Colloquia, paste your Gemini API key, and start talking — no paper selected yet:

> **You:** "What's in my library about foreground subtraction?"
>
> **Colloquia:** "You have 7 papers matching 'foreground subtraction.' The most recent is Chapman et al. 2024 on GPR-based foreground removal, and there's the classic Morales & Hewitt 2004 review. Want me to pull up any of these, or should I search OpenAlex for recent work you might be missing?"
>
> **You:** "Search for anything new from 2025 on that topic."
>
> **Colloquia:** "Let me check... I found 3 recent papers. One from Kern et al. 2025 on machine-learned foreground filters with HERA Phase II data — 23 citations already. It's not in your library. Want me to add it, or should we dive into one of your existing papers first?"
>
> **You:** "Add the Kern paper and then let's discuss it."
>
> *(Agent adds paper via plugin → paper loads → session transitions to paper mode)*
>
> **Colloquia:** "Done — added to your library. I've loaded the full text. This paper proposes a neural network approach to foreground filtering that claims 10x improvement over polynomial fitting. They validate against the signal loss framework from your Chandra et al. work, actually. Where would you like to start?"

### What a paper session feels like

You select a paper from your Zotero library. Colloquia loads the full text, metadata, figures, and your existing annotations as context. You press the mic button and start talking:

> **You:** "Walk me through what they did in Section 3. I don't understand why they used a Blackman-Harris window function instead of just a rectangular one."
>
> **Colloquia (voice):** "The Blackman-Harris window reduces spectral leakage at the cost of wider main lobe. In their case, because the 21cm signal sits near bright foregrounds, even small sidelobes from a rectangular window would leak foreground power into the EoR band. The tradeoff is they lose some frequency resolution, but for a power spectrum measurement that's acceptable since they're averaging over frequency bins anyway. Want me to look up the specific sidelobe levels for Blackman-Harris versus Hanning?"
>
> **You:** "Yeah, and also — they cite a DeBoer et al. paper for the instrument description. Is that in my library?"

At that point, three things happen simultaneously: Gemini searches the web for Blackman-Harris window sidelobe characteristics, searches Zotero for the DeBoer paper, and continues the conversation — all while you're still talking. Barge-in means you can interrupt or redirect at any point, just like talking to a colleague.

### How real-time understanding works technically

The key is how paper context is injected into the Gemini Live API session:

**When a paper is selected** (either before starting or mid-conversation), the full paper content is sent as structured context turns. This includes extracted text (via Zotero's fulltext endpoint), key page images (for figures and equations), paper metadata, and the user's existing annotations. The model "reads" the paper before discussion begins — there's no retrieval step during conversation. If no paper is selected, the session starts in lobby mode with just the general research assistant prompt.

```python
# Context injection at session start
system_turns = [
    {"role": "user", "parts": [
        {"text": f"""Paper loaded: "{title}" by {authors} ({year})
DOI: {doi}

=== FULL TEXT ===
{fulltext}

=== USER'S ANNOTATIONS ===
{annotations_summary}
"""},
        # Page images for figures/equations (Gemini vision)
        {"inline_data": {"mime_type": "image/jpeg", "data": page_3_b64}},
        {"inline_data": {"mime_type": "image/jpeg", "data": page_7_b64}},
    ]},
    {"role": "model", "parts": [
        {"text": f"I've read \"{title}\" and can see the figures. I notice you've "
                 f"highlighted some sections on signal processing. What would you like to discuss?"}
    ]}
]
await session.send_client_content(turns=system_turns, turn_complete=True)
# Now audio streaming begins — the model already has the full paper in context
```

**During conversation**, the model can reference any part of the paper from memory (it's all in the 128K context window). For a 20-page paper, text uses ~10K tokens and 5 figure pages add ~5K tokens — well within the budget with room for 30+ minutes of audio conversation (~45K tokens).

### Web search mid-conversation: how grounding works

This is where Colloquia goes beyond a static paper reader. When you ask about a concept, technique, or referenced work, the agent can **search the web in real time** without breaking the conversation flow. There are two mechanisms:

**Google Search grounding (built-in):** Configured at session setup, this lets the model automatically decide when to search. When you ask "What's the current status of HERA Phase II?", the model searches, synthesizes results, and responds — all within the voice turn. You hear a brief natural pause while it searches, then a grounded answer.

```python
# Enable grounding in the session config
tools = [
    {"google_search": {}},           # Automatic web grounding
    {"function_declarations": [...]}  # Custom tools (Zotero, OpenAlex)
]
```

**Custom search tools (OpenAlex, OpenAlex):** For academic-specific queries — "What has this author published since this paper?" or "Are there papers that cite this one and disagree with the results?" — the agent calls `search_academic_papers` with structured queries. These return citation counts, abstracts, and DOIs, which the agent weaves into the conversation naturally.

### Conversation modes and what they're for

| Mode | Model | Best for | How it works |
|------|-------|----------|--------------|
| **Lobby** (no paper) | Voice: `live-2.5-flash-native-audio`, Text: `3.1-flash-lite` | Library browsing, paper discovery, general research questions | Agent has Zotero + OpenAlex + web search. No paper-specific tools. Transitions to paper mode when a paper is selected. |
| **Paper + voice** | `live-2.5-flash-native-audio` | Exploration, Q&A, "explain this to me", first-pass reading | Real-time audio via Live API. Full paper in context. Barge-in supported. |
| **Paper + text** | `3.1-flash-lite` | Derivations, equations, code, structured output | Standard `generateContent`. Markdown formatting. |

Voice and text modes share a **unified chat transcript** — every voice exchange is transcribed and displayed as text in the chat panel, so the user can switch between modes at any point without losing context. All thinking, tool calls, and reasoning steps are visible in the chat (collapsed by default, expandable on click). See the Chat UI section below for details.

### What the agent can do during a conversation

Beyond just answering questions about the paper's content, the agent actively uses tools to enhance understanding:

**In lobby mode (no paper loaded):**

| User says... | Agent does... |
|-------------|--------------|
| "Find me papers about 21cm foreground subtraction" | Searches OpenAlex → summarizes top results with citation counts → offers to add any to library |
| "What's in my HERA collection?" | Queries Zotero local API → lists papers with brief descriptions |
| "What's the latest on EoR detection?" | Google Search for recent news + OpenAlex for recent papers → synthesizes a brief landscape overview |
| "Let's look at the Kern et al. 2025 paper" | Loads paper from Zotero (or offers to add it first) → transitions to paper mode |

**In paper mode (paper loaded):**

| User says... | Agent does... |
|-------------|--------------|
| "What's a power spectrum?" | Explains from knowledge + searches web for visual aids if needed |
| "Explain Figure 3" | Describes the figure from vision context + creates a purple annotation in Zotero's PDF reader highlighting it |
| "They reference a Smith et al. 2023 paper — what's that about?" | Searches OpenAlex → summarizes the referenced paper → checks if it's in your library → offers to add it |
| "Compare their approach to the LOFAR method" | Searches web for LOFAR methodology → explains the differences → suggests relevant papers |
| "Is this result consistent with other experiments?" | Searches for corroborating/contradicting papers via Google Search + OpenAlex |
| "I don't buy their error analysis" | Critiques the methodology step-by-step, searches for papers with similar concerns |
| "Tag this as 'needs-replication' and put it in my HERA collection" | Calls Zotero plugin to add tags and move to collection |
| "What's new in 21cm cosmology since this was published?" | Google Search grounding for recent developments, OpenAlex for recent papers |

The system prompts (see below) are specifically designed to make the agent behave like a **knowledgeable colleague, not a generic chatbot** — whether browsing your library or deep-diving into a specific paper.

### Adjustable depth

The system prompt (see full prompt below) is calibrated to make the agent match the user's expertise level automatically — technical jargon gets a technical answer, foundational questions get clear intuitive explanations. The agent always offers to go deeper: "Want me to walk through the math?" or "I can search for a good review paper on this." It also knows how to explain equations by voice — describing what terms mean physically rather than reading symbols.

---

## Architecture: how all the pieces fit together

The recommended architecture is a **hybrid local+cloud pattern** that solves the critical Zotero CORS problem while keeping audio latency manageable.

```
┌──────────────────────────────────────────────────────────────────┐
│  User's Machine                                                   │
│  ┌──────────────────┐   Vite Proxy     ┌──────────────────────┐  │
│  │ React Frontend   │ ───────────────► │ Zotero 7 + Plugin    │  │
│  │ localhost:5173   │ (adds header)    │ localhost:23119       │  │
│  │                  │ ◄─────────────── │ Read: /api/users/0/  │  │
│  │ • Paper browser  │                  │ Write: /colloquia/* │  │
│  │ • Audio capture  │                  └──────────────────────┘  │
│  │ • Chat UI        │                                            │
│  │ • PDF viewer     │                                            │
│  └────────┬─────────┘                                            │
└───────────┼──────────────────────────────────────────────────────┘
            │ WebSocket (audio + text + paper context)
            ▼
┌───────────────────────────────────┐     WebSocket
│ FastAPI Backend                   │ ──────────────►  Gemini Live API
│ Google Cloud Run                  │ ◄──────────────  (gemini-live-2.5-
│ • genai aio.live.connect()        │                   flash-native-audio)
│ • Tool orchestration loop         │
│ • Zotero tools (via frontend)     │
│ • OpenAlex search         │     REST
│ • Google Search grounding         │ ──────────────►  OpenAlex /
│ • Session state management        │                   OpenAlex APIs
└───────────────────────────────────┘
```

The frontend runs locally via `npm run dev`, giving it access to Zotero through Vite's built-in proxy. It captures microphone audio at **16kHz PCM** and streams it over WebSocket to the Cloud Run backend. The backend manages the Gemini Live API session via `genai.Client.aio.live.connect()`, executes tool calls (Zotero search, metadata lookup, Google Search, OpenAlex), and streams audio responses back. The frontend plays responses at **24kHz PCM** through the Web Audio API.

**Write operations flow through the Zotero plugin:** When the agent needs to create notes, add tags, create annotations, or add papers, the tool call is handled by the backend, which instructs the frontend (via the WebSocket) to call the plugin's endpoints on `localhost:23119/colloquia/*`. This keeps all Zotero write operations local — Cloud Run never needs to reach the user's machine directly.

**Why backend proxy over direct client-to-Gemini:** The backend manages tool execution server-side — when Gemini emits a `function_call` mid-stream, the backend executes it (OpenAlex search, Zotero operations, etc.) and sends the `function_response` back, all without the frontend needing to know about tool internals. With direct client-to-Gemini from the browser, you'd need to relay tool calls back to the backend anyway. The backend proxy pattern also keeps the user's API key off the client-side network (it only transits to Google's API, not to arbitrary tool endpoints). The user's Gemini API key is sent once per session via the WebSocket handshake and used server-side — never stored persistently.

### Bring-your-own-key (BYOK) architecture

Colloquia is fully open source and stores no API keys server-side. The user provides their own keys:

| Key | Required | Where to get it | How it's used |
|-----|----------|-----------------|---------------|
| **Gemini API key** | Yes | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | Sent to backend per-session via WebSocket; backend uses it to connect to Gemini Live API |
| **OpenAlex** | No (free) | [openalex.org](https://openalex.org) | Academic paper search — no API key needed, uses polite pool with mailto header |

**Key flow:** The frontend persists API keys in `localStorage` so the user only enters them once. On app startup, if a key exists, the app skips the setup screen and goes straight to the lobby. On session start, the frontend sends a `config` message via WebSocket containing the key. The backend uses it for that session's Gemini connection, then discards it when the WebSocket closes.

The settings panel shows a brief notice: *"Your API key is stored locally in your browser and never sent to our servers except to connect to Gemini on your behalf."* This is accurate — the key lives in the user's browser on their own machine and transits through the backend only to authenticate with Google's API. A "Change API key" option in settings lets users update or rotate keys.

```typescript
// src/lib/apiKeys.ts
const GEMINI_KEY = "colloquia:geminiApiKey";

export const apiKeys = {
  getGeminiKey: () => localStorage.getItem(GEMINI_KEY),
  setGeminiKey: (key: string) => localStorage.setItem(GEMINI_KEY, key),
  clearAll: () => { localStorage.removeItem(GEMINI_KEY); }
};

// App startup: skip setup if key exists
function App() {
  const [hasKey] = useState(() => !!apiKeys.getGeminiKey());
  if (!hasKey) return <SetupScreen onSave={(key) => { apiKeys.setGeminiKey(key); }} />;
  return <MainApp />;
}
```

```typescript
// WebSocket connection: load key from localStorage
ws.onopen = () => {
  ws.send(JSON.stringify({
    type: "config",
    geminiApiKey: apiKeys.getGeminiKey(),
    // OpenAlex needs no API key
  }));
};
```

The UX goal: **install → paste key once → use forever.** The API key screen should only appear on first launch or when the user explicitly opens settings to change it.

```python
# Backend: per-session client — each user gets their own genai.Client
async def handle_websocket(ws: WebSocket):
    config_msg = await ws.receive_json()
    assert config_msg["type"] == "config"

    # Per-session Gemini client — no global state, fully concurrent
    client = genai.Client(api_key=config_msg["geminiApiKey"])

    live_config = types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        system_instruction=LOBBY_SYSTEM_PROMPT,
        tools=TOOL_DECLARATIONS,
        session_resumption=types.SessionResumptionConfig(),
        output_audio_transcription=types.AudioTranscriptionConfig(),
        input_audio_transcription=types.AudioTranscriptionConfig(),
    )

    async with client.aio.live.connect(
        model="gemini-live-2.5-flash-native-audio", config=live_config
    ) as session:
        # session is fully isolated — safe for concurrent users
        await run_session(ws, session, config_msg)
```

**Why BYOK matters for open source:** No billing surprises, no quota management, no user accounts needed. The backend is stateless — it can be self-hosted, run locally, or deployed to Cloud Run with zero configuration beyond the code itself. Users who don't trust a hosted backend can run everything locally: `npm run dev` for the frontend and `uvicorn main:app` for the backend on the same machine.

> **⚠️ Security note:** Even though the backend is stateless, the Gemini API key transits through it. For the hackathon, this is fine (you control the backend). For production, consider a direct client-to-Gemini architecture with WebRTC, or let users run the backend locally. Document this tradeoff in the README.

### Frontend ↔ Backend WebSocket protocol

> **⚠️ Define this on Day 1.** Without a clear message protocol, you'll waste hours debugging why audio chunks are being interpreted as text or why Zotero actions aren't firing.

All WebSocket messages are JSON (except raw audio binary frames). Define these message types upfront:

```typescript
// Frontend → Backend
type ClientMessage =
  | { type: "config"; geminiApiKey: string;        // MUST be first message after connect
      }
  | { type: "audio"; data: string }              // base64 PCM16 audio chunk
  | { type: "text"; text: string }                // text chat input
  | { type: "paper_context"; paperKey: string;    // optional — can arrive at session start
      fulltext: string; metadata: object;          // or mid-session (triggers lobby→paper transition)
      pageImages?: { pageIndex: number; data: string }[] }
  | { type: "zotero_action_result";               // result of a Zotero write operation
      requestId: string; success: boolean;
      data?: object; error?: string }
  | { type: "control"; action: "start" | "stop" | "switch_mode" }

// Backend → Frontend
type ServerMessage =
  | { type: "audio"; data: string }              // base64 PCM16 audio response
  | { type: "transcript"; role: "user" | "model"; text: string }
  | { type: "text_response"; text: string }      // text mode response (markdown)
  | { type: "zotero_action";                     // backend asks frontend to call plugin
      requestId: string;
      action: "createAnnotation" | "createNote" | "addTags" | "addPaper" | ...;
      params: object }
  | { type: "tool_call";                         // tool invocation (shown in chat UI)
      id: string; tool: string;
      status: "calling" | "done" | "error";
      input?: Record<string, any>;               // parameters (shown when expanded)
      output?: Record<string, any>;              // result (shown when expanded)
      duration_ms?: number;
      model?: string }
  | { type: "thinking"; content: string }        // reasoning trace (collapsed in chat)
  | { type: "context_usage";                     // token usage for UI progress bar
      total_tokens: number; limit: number }
  | { type: "error"; message: string }
  | { type: "session_status"; status: "connected" | "reconnecting" | "ended" }
```

The `zotero_action` / `zotero_action_result` pair is the critical pattern: the backend can't reach `localhost:23119`, so it sends a structured command to the frontend, which executes it locally and returns the result. Use a `requestId` (UUID) to correlate requests and responses.

### Zotero health check on startup

> **⚠️ Don't silently fail.** The app is useless without Zotero running.

On frontend load, immediately ping `localhost:23119` via the Vite proxy. If it fails, show a clear onboarding screen. Also check if the library is empty — a judge installing fresh will have no papers.

```typescript
// src/hooks/useZoteroHealth.ts
type ZoteroState = {
  available: boolean;
  pluginInstalled: boolean;
  libraryEmpty: boolean;
};

async function checkZotero(): Promise<ZoteroState> {
  try {
    const resp = await fetch('/zotero-api/users/0/items/top?limit=1');
    if (!resp.ok) return { available: false, pluginInstalled: false, libraryEmpty: true };

    const items = await resp.json();
    const libraryEmpty = items.length === 0;

    try {
      const pluginResp = await fetch('/zotero-plugin/colloquia/ping');
      return { available: true, pluginInstalled: pluginResp.ok, libraryEmpty };
    } catch {
      return { available: true, pluginInstalled: false, libraryEmpty };
    }
  } catch {
    return { available: false, pluginInstalled: false, libraryEmpty: true };
  }
}

// App startup routes to the right screen:
// !available        → "Install Zotero 7 and enable API access" setup screen
// !pluginInstalled  → "Install the Colloquia plugin" setup screen
// libraryEmpty      → "Your library is empty — search for papers to get started" onboarding
// all good          → Main app (lobby mode)
```

---

## Gemini Live API: what works and what doesn't

The Live API establishes a stateful WebSocket connection supporting bidirectional audio, text, and image streaming. Here are the critical technical parameters:

| Parameter | Value |
|-----------|-------|
| WebSocket endpoint | `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent` |
| Audio input | **16-bit PCM, 16kHz, mono, little-endian** |
| Audio output | **16-bit PCM, 24kHz, mono, little-endian** |
| Context window | **128K tokens** (native audio models) |
| Session duration | ~15 min audio-only (without compression); **unlimited with compression** |
| WebSocket lifetime | ~10 min (use session resumption to reconnect) |
| Response modalities | **ONE per session**: either `TEXT` or `AUDIO`, not both simultaneously |

**Sending paper context works exactly as needed.** At session start, use `send_client_content()` to inject paper text, metadata, and images as structured turns before starting audio. The model retains this context throughout the conversation. For a 20-page paper, extracted text costs roughly **8,000–15,000 tokens** and page images cost ~**5,160 tokens** — both fit comfortably in the 128K window with ample room for conversation.

**Function calling works mid-conversation.** Declare tools at session setup; the model emits `toolCall` messages when it decides to use them. Unlike `generateContent`, the Live API requires **manual tool response handling** — you intercept tool calls in the receive loop, execute the functions, and send results back via `session.send_tool_response()`. You can combine custom function declarations with Google Search grounding in the same session.

**Barge-in handling is automatic.** Built-in VAD detects when the user speaks during model output, cancels generation, and sends an `interrupted: true` signal. Sensitivity is configurable via `start_of_speech_sensitivity` and `end_of_speech_sensitivity` parameters. Pending function calls are also cancelled on interruption.

### The March 5 Google Search grounding bug

A regression reported on the Google AI Developers Forum shows that **Google Search grounding in the Live API is being treated as a `function_call`** instead of executing server-side. The affected configuration is Vertex AI, europe-west8 region, `gemini-live-2.5-flash-native-audio` model. As of March 10, **no confirmed fix exists** — zero replies on the forum post, no mention in Vertex AI release notes.

**Workaround for the hackathon:** Use the **Google AI Studio API** (not Vertex AI) with a standard API key. The bug is reported specifically for Vertex AI. If it still occurs, implement a fallback that intercepts `function_call` events for `google_search` in the tool orchestration loop, executes the search via a custom tool function, and returns results as a `FunctionResponse`.

### Smart tiered model hierarchy

Colloquia uses two model tiers to balance cost and speed.

| Tier | Model | Role | When it's used |
|------|-------|------|----------------|
| **Voice** | `gemini-live-2.5-flash-native-audio` | Real-time audio conversation | Always (only option for Live API audio) |
| **Text** | `gemini-3.1-flash-lite` | Fast text responses, routine questions | Default for text chat — cheap, handles 90% of questions |

**Do NOT use:** `gemini-live-2.5-flash-preview-native-audio-09-2025` — **deprecated March 19, 2026**. Gemini 2.0 Flash retires June 1.

### Free tier limits and pricing (user's own key)

Since Colloquia is BYOK, users pay their own Gemini API costs. The free tier is generous for individual use: Google Search grounding allows **500 requests/day**, and Live API audio is free during preview. On the paid tier, Live API audio output costs **$12 per million tokens** and grounding costs **$35 per 1,000 grounded prompts** after 1,500 free/day. A typical 15-minute paper discussion costs roughly $0.02–0.05 in API usage. Document these costs in the README so users aren't surprised.

---

## Why raw genai SDK instead of ADK

Google's Agent Development Kit (ADK) would save ~2 days of boilerplate — automatic tool orchestration, session management, built-in Google Search. But ADK has a **confirmed blocking issue for BYOK**: the Python ADK's `Gemini` class internally creates its own `genai.Client` based on environment variables or Application Default Credentials, and **there is no way to inject a preconfigured `genai.Client` instance** ([issue #2560](https://github.com/google/adk-python/issues/2560)). The Java ADK supports this, but Python does not.

This means `os.environ["GOOGLE_API_KEY"] = key` before each session is a race condition with concurrent users. The workaround (`--concurrency=1` on Cloud Run) cripples scalability. Writing a custom `BaseLlm` wrapper is possible but adds complexity for an abstraction layer we'd be fighting rather than using.

**Decision: Use `google-genai` SDK directly via `client.aio.live.connect()`.** We write ~300 lines of tool orchestration manually but gain: clean per-session API keys, transparent WebSocket debugging, no opaque abstraction layers, and direct access to `send_client_content(role="system")` for lobby→paper prompt swaps.

### The tool orchestration loop

This is what ADK would have done automatically. With the raw SDK, we write it ourselves — it's the core of the backend:

```python
# session_handler.py — the main event loop per WebSocket session
from google import genai
from google.genai import types

TOOL_REGISTRY = {
    "search_zotero_library": search_zotero_library,
    "search_academic_papers": search_academic_papers,
    "add_paper_to_zotero": add_paper_to_zotero,
    "get_paper_recommendations": get_paper_recommendations,
    "annotate_zotero_pdf": annotate_zotero_pdf,
    "manage_tags": manage_tags,
    "manage_collection": manage_collection,
    "link_related_items": link_related_items,
    "trash_items": trash_items,
}

async def run_session(ws: WebSocket, session, config_msg: dict):
    """Main event loop: handle audio, tool calls, and transcripts."""
    session_request_ids: set[str] = set()  # tracks Zotero futures for cleanup
    state = ConversationState()             # shared state between voice and text modes

    # Two concurrent tasks: forward user audio → Gemini, and Gemini responses → user
    async def forward_user_to_gemini():
        """Read from frontend WebSocket, send to Gemini Live session."""
        async for raw in ws.iter_json():
            match raw["type"]:
                case "audio":
                    await session.send_realtime_input(
                        audio=types.Blob(data=base64.b64decode(raw["data"]),
                                         mime_type="audio/pcm;rate=16000")
                    )
                case "text":
                    await session.send_client_content(
                        turns=types.Content(role="user",
                                            parts=[types.Part(text=raw["text"])]),
                        turn_complete=True
                    )
                case "paper_context":
                    await handle_paper_load(ws, session, raw)

    async def forward_gemini_to_user():
        """Read from Gemini Live session, handle tool calls, forward to frontend."""
        async for message in session.receive():
            # Audio data → forward to frontend
            if message.data:
                await ws.send_json({
                    "type": "audio",
                    "data": base64.b64encode(message.data).decode()
                })

            # Tool calls → execute and respond
            if message.tool_call:
                await handle_tool_calls(ws, session, message.tool_call, session_request_ids)

            # Server content (transcripts, turn signals, interruptions)
            if message.server_content:
                sc = message.server_content
                if sc.output_transcription:
                    await ws.send_json({
                        "type": "transcript",
                        "role": "model",
                        "text": sc.output_transcription.text
                    })
                if sc.input_transcription:
                    await ws.send_json({
                        "type": "transcript",
                        "role": "user",
                        "text": sc.input_transcription.text
                    })
                if sc.interrupted:
                    await ws.send_json({"type": "session_status", "status": "interrupted"})

            # Token usage → forward to frontend for context usage bar
            if message.usage_metadata:
                await ws.send_json({
                    "type": "context_usage",
                    "total_tokens": message.usage_metadata.total_token_count,
                    "limit": 128000
                })

    # Run both tasks — if either exits (error, disconnect), cancel the other
    task_user = asyncio.create_task(forward_user_to_gemini())
    task_gemini = asyncio.create_task(forward_gemini_to_user())
    try:
        done, pending = await asyncio.wait(
            [task_user, task_gemini], return_when=asyncio.FIRST_COMPLETED
        )
        for task in pending:
            task.cancel()
        # Re-raise any exception from the completed task
        for task in done:
            task.result()
    finally:
        # Session cleanup: cancel only THIS session's orphaned Zotero futures
        # (session_request_ids is passed to delegate_to_frontend and tracks IDs)
        for rid in session_request_ids:
            future = _pending_zotero.pop(rid, None)
            if future and not future.done():
                future.cancel()


async def handle_tool_calls(ws: WebSocket, session, tool_call, session_request_ids: set[str]):
    """Execute tool calls and send responses back to Gemini."""
    responses = []
    for fc in tool_call.function_calls:
        tool_id = str(uuid.uuid4())

        # Notify frontend: tool call starting (shown in chat UI)
        await ws.send_json({
            "type": "tool_call", "id": tool_id, "tool": fc.name,
            "status": "calling", "input": fc.args
        })

        start = time.time()
        try:
            # Google Search grounding fallback:
            # If the March 5 regression is active, Gemini sends google_search
            # as a function_call instead of handling it server-side.
            # Execute it ourselves using the genai SDK's built-in search.
            if fc.name == "google_search":
                search_client = genai.Client(api_key=session_api_key)
                search_resp = await search_client.models.generate_content_async(
                    model="gemini-3.1-flash-lite",
                    contents=[{"role": "user", "parts": [{"text": fc.args.get("query", "")}]}],
                    config=types.GenerateContentConfig(
                        tools=[{"google_search": {}}]
                    )
                )
                result = {"answer": search_resp.text}

            # Zotero write operations → delegate to frontend
            elif fc.name in ZOTERO_WRITE_TOOLS:
                result = await delegate_to_frontend(ws, fc.name, fc.args, session_request_ids)

            # Known local tools
            elif fc.name in TOOL_REGISTRY:
                tool_fn = TOOL_REGISTRY[fc.name]
                result = await tool_fn(**fc.args)

            # Unknown tool — don't crash, return an error to the model
            else:
                result = {"error": f"Unknown tool: {fc.name}. Available tools: {list(TOOL_REGISTRY.keys())}"}

            duration = int((time.time() - start) * 1000)
            await ws.send_json({
                "type": "tool_call", "id": tool_id, "tool": fc.name,
                "status": "done", "output": result, "duration_ms": duration,
                "model": None
            })
            responses.append(types.FunctionResponse(
                name=fc.name, id=fc.id, response=result
            ))
        except Exception as e:
            await ws.send_json({
                "type": "tool_call", "id": tool_id, "tool": fc.name,
                "status": "error", "output": {"error": str(e)}
            })
            responses.append(types.FunctionResponse(
                name=fc.name, id=fc.id, response={"error": str(e)}
            ))

    # Send all tool responses back to Gemini
    await session.send_tool_response(function_responses=responses)


ZOTERO_WRITE_TOOLS = {
    "annotate_zotero_pdf", "manage_tags", "manage_collection",
    "add_paper_to_zotero", "link_related_items", "trash_items"
}

# Per-session registry of pending Zotero write operations
# Key: request_id, Value: asyncio.Future that resolves with the result
# Module-level dict — UUIDs prevent cross-session collisions.
# Each session tracks its own request_ids for cleanup on disconnect.
_pending_zotero: dict[str, asyncio.Future] = {}

async def delegate_to_frontend(
    ws: WebSocket, action: str, params: dict,
    session_request_ids: set[str]  # session-scoped tracker for cleanup
) -> dict:
    """Send a Zotero write action to the frontend, wait for result.

    Flow: backend → ws → frontend → Zotero plugin → frontend → ws → backend
    That's 6 hops. If the frontend tab is backgrounded, the browser may throttle
    the WebSocket. The timeout + Future pattern handles this gracefully.
    """
    request_id = str(uuid.uuid4())
    future: asyncio.Future = asyncio.get_event_loop().create_future()
    _pending_zotero[request_id] = future
    session_request_ids.add(request_id)  # track for cleanup on session disconnect

    await ws.send_json({
        "type": "zotero_action", "requestId": request_id,
        "action": action, "params": params
    })

    try:
        result = await asyncio.wait_for(future, timeout=10.0)
        return result
    except asyncio.TimeoutError:
        raise ToolError(f"Zotero plugin didn't respond within 10s — "
                        f"is Zotero running? Is the tab in the foreground?")
    finally:
        _pending_zotero.pop(request_id, None)


def resolve_zotero_result(msg: dict):
    """Called when the frontend sends a zotero_action_result message."""
    request_id = msg["requestId"]
    future = _pending_zotero.get(request_id)
    if future and not future.done():
        if msg.get("success"):
            future.set_result(msg.get("data", {}))
        else:
            future.set_exception(ToolError(msg.get("error", "Unknown Zotero error")))
```

> **⚠️ The 6-hop round-trip is the most fragile part of the architecture.** Backend → WebSocket → frontend → Zotero plugin → frontend → WebSocket → backend → Gemini. If the frontend tab loses focus (mobile, screen lock), browsers may throttle WebSocket messages. If Zotero crashes or the plugin endpoint is unreachable, `delegate_to_frontend` hangs until the 10s timeout. Test this path on Day 3 with the tab minimized and with Zotero closed mid-operation. The timeout + error message ensures the agent can tell the user "I couldn't write to Zotero — is it still running?" rather than silently hanging.
>
> **Note on cleanup interleaving:** `delegate_to_frontend`'s `finally` block pops from `_pending_zotero`, and `run_session`'s `finally` block iterates `session_request_ids` to cancel orphaned futures. If a disconnect occurs while `delegate_to_frontend` is in its own `finally` (between `_pending_zotero.pop` and returning), the session cleanup won't find the future (already popped) but the ID is still in `session_request_ids`. This is harmless — `_pending_zotero.pop(rid, None)` handles the miss — but be aware of it if you add logging (you'll see "future not found" warnings that are benign).

Wire the `resolve_zotero_result` into the frontend→backend message handler:

```python
# In forward_user_to_gemini():
case "zotero_action_result":
    resolve_zotero_result(raw)
```

### Session management (manual but straightforward)

Without ADK, we handle session resumption and lobby→paper transitions ourselves:

```python
async def handle_paper_load(ws: WebSocket, session, paper_msg: dict):
    """Transition from lobby to paper mode mid-session."""
    # Swap system instruction — supported natively via send_client_content(role="system")
    paper_prompt = build_paper_prompt(paper_msg["metadata"])
    await session.send_client_content(
        content=types.Content(
            role="system",
            parts=[types.Part(text=paper_prompt)]
        ),
        turn_complete=False
    )

    # Inject paper content as context turns
    parts = [types.Part(text=paper_msg["fulltext"])]
    for img in paper_msg.get("pageImages", []):
        parts.append(types.Part(inline_data=types.Blob(
            data=base64.b64decode(img["data"]), mime_type="image/jpeg"
        )))

    await session.send_client_content(
        turns=types.Content(role="user", parts=parts),
        turn_complete=True
    )
```

> **Mid-session system prompt swap is natively supported.** The Gemini Live API lets you update system instructions during an active session by sending content with `role="system"` via `send_client_content()`. This does NOT reset the session — conversation history is preserved. The updated instruction remains in effect for the rest of the session. No need for a unified prompt fallback.

### Session resumption config

```python
# Hackathon config — resumption enabled, compression disabled (stability)
live_config = types.LiveConnectConfig(
    response_modalities=["AUDIO"],
    system_instruction=LOBBY_SYSTEM_PROMPT,
    tools=TOOL_DECLARATIONS,
    session_resumption=types.SessionResumptionConfig(),
    output_audio_transcription=types.AudioTranscriptionConfig(),
    input_audio_transcription=types.AudioTranscriptionConfig(),
)

# Production config — add context window compression
live_config_production = types.LiveConnectConfig(
    response_modalities=["AUDIO"],
    system_instruction=LOBBY_SYSTEM_PROMPT,
    tools=TOOL_DECLARATIONS,
    session_resumption=types.SessionResumptionConfig(),
    context_window_compression=types.ContextWindowCompressionConfig(
        sliding_window=types.SlidingWindow(target_tokens=64000),
        trigger_tokens=100000,
    ),
    output_audio_transcription=types.AudioTranscriptionConfig(),
    input_audio_transcription=types.AudioTranscriptionConfig(),
)
```

> **⚠️ Skip compression for the hackathon demo.** There's an [open bug](https://github.com/google-gemini/live-api-web-console/issues/) where context window compression causes the model to stop outputting audio mid-sentence. Your 15-minute session budget fits comfortably without compression. System instructions and prefix turns are never discarded by the sliding window — they always stay at the beginning of context — so paper content injected early is safe.

For session resumption, the server sends `SessionResumptionUpdate` messages with handles that can reconnect within 2 hours. You also receive `GoAway` messages before disconnection. Handle both:

```python
if message.session_resumption_update:
    resumption_handle = message.session_resumption_update.new_handle
    # Cache handle — use it to reconnect if the WebSocket drops

if message.go_away:
    # Server is about to disconnect — reconnect proactively
    await reconnect_with_handle(client, resumption_handle, live_config)
```

### Fulltext quality heuristic

Zotero uses Xpdf-based extraction for full-text search. This works for most text-heavy PDFs but struggles with two-column layouts (text flow gets garbled) and equations (LaTeX renders as gibberish). Add a quality check and fall back to `pymupdf4llm` when needed:

```python
import fitz  # PyMuPDF
import pymupdf4llm

def should_reextract(fulltext: str, page_count: int) -> bool:
    """Heuristic: if Zotero's extraction is suspiciously short, re-extract."""
    if not fulltext or len(fulltext.strip()) < 100:
        return True
    # ~300 words/page for a typical paper, ~5 chars/word
    expected_chars = page_count * 300 * 5
    actual_chars = len(fulltext.strip())
    return actual_chars < expected_chars * 0.2

async def get_paper_text(pdf_path: str, zotero_fulltext: str) -> str:
    """Use Zotero's fulltext if good enough, otherwise re-extract with pymupdf4llm."""
    doc = fitz.open(pdf_path)
    if not should_reextract(zotero_fulltext, len(doc)):
        return zotero_fulltext
    return pymupdf4llm.to_markdown(pdf_path)
```

For equation-heavy papers (common in HERA/21cm work), neither extraction method will produce usable math. This is fine — the plan of rendering key pages as JPEG images for Gemini's vision handles equations, figures, and tables regardless of text extraction quality.

**Note on Zotero write operations from Cloud Run:** The backend can't reach `localhost:23119` on the user's machine. For write operations (annotations, notes, tags, paper additions), the backend sends a structured command via the WebSocket to the frontend, which then calls the plugin endpoint locally. This is a common pattern in local-first architectures and adds minimal latency (~50ms round trip).

---

## Solving the Zotero CORS problem

Zotero's local API at `localhost:23119` intentionally blocks cross-origin browser requests — **no CORS headers are set**, and the Zotero team confirmed this is deliberate. The `Zotero-Allowed-Request: 1` header is required for any request but cannot bypass the CORS preflight mechanism.

**The Vite proxy is the clear winner for a hackathon.** It requires zero additional installation, works immediately, and completely eliminates CORS by routing requests through the same origin:

```typescript
// vite.config.ts
export default defineConfig({
  server: {
    proxy: {
      '/zotero-api': {
        target: 'http://localhost:23119',
        rewrite: (path) => path.replace(/^\/zotero-api/, '/api'),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('Zotero-Allowed-Request', '1');
            proxyReq.setHeader('User-Agent', 'Colloquia/1.0');
          });
        }
      },
      '/zotero-plugin': {
        target: 'http://localhost:23119',
        rewrite: (path) => path.replace(/^\/zotero-plugin/, ''),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('Zotero-Allowed-Request', '1');
          });
        }
      }
    }
  }
});
```

The frontend calls `/zotero-api/users/0/items` for reads and `/zotero-plugin/colloquia/createNote` for writes — Vite transparently proxies both. This only works in dev mode, but for a hackathon demo you're always running from your own machine.

### Zotero Local API quick reference

All endpoints follow the pattern `http://localhost:23119/api/users/0/...` and return JSON matching the Web API format. Key endpoints:

| Endpoint | Purpose |
|----------|---------|
| `/users/0/items?q=search&qmode=everything` | Search items (including full-text) |
| `/users/0/items/top` | Top-level items |
| `/users/0/items/ITEMKEY` | Single item metadata |
| `/users/0/items/ITEMKEY/children` | Child items (attachments, notes, annotations) |
| `/users/0/items/ITEMKEY/fulltext` | Extracted full text (Zotero 7.1+) |
| `/users/0/items/ITEMKEY/file` | PDF file download |
| `/users/0/collections` | All collections |
| `/users/0/collections/COLLKEY/items` | Items in a collection |

**No pagination required** (unlike the Web API's 100-item limit). No API key needed — just the header. Annotations are stored as child items of attachments with `itemType: "annotation"`, containing `annotationText` (highlighted text) and `annotationComment` (user's note).

### Zotero Web API (for future extensibility)

The Zotero Web API v3 at `api.zotero.org` provides the same endpoint structure but requires authentication via API keys (generated at zotero.org/settings/keys). Key differences from the local API: the Web API has a 100-item pagination limit, requires an API key with per-library permissions, supports write operations natively, and can download PDF attachments (requires paid Zotero storage for files >300MB total). CORS is supported on the Web API — the frontend can call it directly. For a future version where users access the app without Zotero desktop running (e.g., mobile), the Web API is the path forward.

---

## PDF processing and context injection strategy

For academic papers with equations, figures, and complex layouts, a **hybrid text + image approach** gives Gemini the best understanding:

1. **Extract structured text** using `pymupdf4llm` (~0.12s per paper) — produces clean markdown preserving headings and sections
2. **Render key pages as JPEG** using PyMuPDF for pages containing figures, charts, or equations
3. **Retrieve Zotero's pre-extracted fulltext** via the `/fulltext` endpoint as a fast alternative to PDF processing

### Which pages to render as images

The plan says "render key pages" but doesn't specify how to select them. Three tiers:

```python
import fitz  # PyMuPDF

def select_pages_for_rendering(pdf_path: str) -> list[int]:
    """Decide which pages to render as images for Gemini's vision context."""
    doc = fitz.open(pdf_path)
    page_count = len(doc)

    # Tier 1: Short papers (≤12 pages) — render ALL pages.
    # Cost is trivial: ~1,300 tokens per page × 12 = ~15K tokens.
    if page_count <= 12:
        return list(range(page_count))

    # Tier 2: Medium papers (13-30 pages) — render pages with figures/images.
    # PyMuPDF can detect image objects per page via page.get_images().
    figure_pages = []
    for i, page in enumerate(doc):
        images = page.get_images(full=True)
        # Filter out tiny images (logos, icons) — keep only substantial figures
        substantial = [img for img in images if img[2] > 100 and img[3] > 100]  # w, h
        if substantial:
            figure_pages.append(i)

    # Always include first page (title/abstract) and last few (conclusions)
    must_include = {0, page_count - 1, page_count - 2}
    selected = sorted(set(figure_pages) | must_include)

    # Cap at 15 pages to stay within token budget
    return selected[:15]

    # Tier 3: Long papers (30+ pages) — figure pages only, capped at 10.
    # For very long papers, text extraction carries most of the content.

def render_pages(pdf_path: str, page_indices: list[int], dpi: int = 150) -> list[dict]:
    """Render selected pages as JPEG for Gemini vision context."""
    doc = fitz.open(pdf_path)
    results = []
    for i in page_indices:
        page = doc[i]
        pix = page.get_pixmap(dpi=dpi)
        img_bytes = pix.tobytes("jpeg", jpg_quality=85)
        results.append({
            "pageIndex": i,
            "data": base64.b64encode(img_bytes).decode(),
            "width": page.rect.width,   # PDF points — needed for annotation coord mapping
            "height": page.rect.height
        })
    return results
```

The `dpi=150` balances image quality with token cost — 150 DPI produces clear figures without exceeding Gemini's image token budget. For a 10-page paper at 150 DPI, all pages cost ~13K tokens total. The page dimensions are returned alongside the images because the annotation coordinate mapping (Gemini 0–1000 → PDF points) needs them later.

**Context injection at session start:**

```python
# Render selected pages and build context
page_indices = select_pages_for_rendering(pdf_path)
rendered = render_pages(pdf_path, page_indices)

# Build multimodal context: text + page images
parts = [{"text": f"Paper: {title}\nAuthors: {authors}\nAbstract: {abstract}\n\nFull text:\n{fulltext}"}]
for page in rendered:
    parts.append({"inline_data": {"mime_type": "image/jpeg", "data": page["data"]}})

turns = [
    {"role": "user", "parts": parts},
    {"role": "model", "parts": [
        {"text": "I've loaded this paper and can see all figures. Ready to discuss."}
    ]}
]
await session.send_client_content(turns=turns, turn_complete=True)
```

**Token budget:** A 20-page paper as text uses ~10K tokens. All 20 pages as images at 150 DPI add ~26K tokens (~1,300 per page). Audio at 25 tokens/second over 15 minutes adds ~22,500 tokens. Total: ~58K tokens out of 128K — comfortable headroom. For short papers (≤12 pages), just render everything. For longer papers, the figure-detection heuristic keeps image tokens under ~20K. For very long papers (50+ pages), use the Zotero fulltext endpoint and truncate to key sections.

---

## Handling voice and text in a single session

The Live API only supports **one response modality per session** — `TEXT` or `AUDIO`, not both. This creates an architectural constraint for dual-mode support.

**Recommended approach: Use a single Live API session in AUDIO mode with transcription enabled.** The Live API supports `output_audio_transcription` and `input_audio_transcription` configuration, which provides text transcripts of all voice exchanges. For text input, `send_client_content()` accepts text messages in an audio-mode session — the model reads the text and responds with audio.

When the user explicitly wants text-only responses (e.g., for detailed explanations with formatting), open a **separate text-mode call** using the standard `generateContent` API with `gemini-3.1-flash-lite`. This gives you markdown formatting, code blocks, and structured output that voice can't provide — and Flash-Lite keeps costs minimal for routine text exchanges.

### Shared conversation state (critical for mode switching)

Text mode uses `generateContent`, which is a stateless API — it doesn't share the Live API session's context. If the voice agent called 3 tools and discovered information (e.g., found that a referenced paper has 47 citations, or that the user's library has a related paper), the text agent won't know about those results unless they're explicitly passed.

**Solution: maintain a `ConversationState` object on the backend that both modes read from.** This is more than just transcripts — it includes tool results interleaved chronologically, so the text agent sees what information was available at what point in the conversation:

```python
@dataclass
class ConversationEvent:
    """A single event in the conversation timeline.
    Insertion order = chronological order (no timestamp needed)."""
    kind: str                # "message" | "tool_result"
    role: str | None = None  # "user" | "model" (for messages)
    text: str = ""
    tool: str | None = None  # tool name (for tool_results)
    output: dict | None = None

@dataclass
class ConversationState:
    """Shared state between voice and text modes for a single session."""
    paper_context: dict | None = None
    timeline: list[ConversationEvent] = field(default_factory=list)
    session_mode: str = "lobby"

    def add_message(self, role: str, text: str):
        self.timeline.append(ConversationEvent(kind="message", role=role, text=text))

    def add_tool_result(self, tool: str, output: dict):
        self.timeline.append(ConversationEvent(kind="tool_result", tool=tool, output=output))

    def to_text_context(self, token_budget: int = 200_000) -> list[dict]:
        """Build the content array for a generateContent call.

        Interleaves messages and tool results in chronological order.
        Truncates older events to stay within token_budget (~4 chars/token estimate).
        Enforces strict role alternation (Gemini requires user/model/user/model).
        """
        parts = []
        paper_tokens = 0
        if self.paper_context:
            paper_text = self.paper_context["fulltext"]
            parts.append({"role": "user", "parts": [{"text": paper_text}]})
            parts.append({"role": "model", "parts": [{"text": "Paper loaded. Ready to discuss."}]})
            paper_tokens = len(paper_text) // 4  # ~4 chars per token

        # Walk timeline backwards to find how many recent events fit in budget
        remaining_budget = token_budget - paper_tokens
        included_events = []
        for event in reversed(self.timeline):
            event_text = event.text if event.kind == "message" else json.dumps(event.output, default=str)[:500]
            event_tokens = len(event_text) // 4
            if remaining_budget - event_tokens < 0:
                break
            remaining_budget -= event_tokens
            included_events.append(event)
        included_events.reverse()  # back to chronological order

        cut_count = len(self.timeline) - len(included_events)
        if cut_count > 0:
            parts.append({"role": "user", "parts": [{"text":
                f"[{cut_count} earlier exchanges omitted for brevity]"}]})
            parts.append({"role": "model", "parts": [{"text": "Understood."}]})

        for event in included_events:
            if event.kind == "message":
                new_turn = {"role": event.role, "parts": [{"text": event.text}]}
            elif event.kind == "tool_result":
                # Tool results rendered as user-role context to avoid
                # model→model role violations (Gemini requires strict alternation)
                summary = json.dumps(event.output, default=str)[:500]
                new_turn = {"role": "user", "parts": [{"text":
                    f"[Context — tool result from {event.tool}]: {summary}"}]}
            else:
                continue

            # Merge consecutive same-role turns instead of creating violations
            if parts and parts[-1]["role"] == new_turn["role"]:
                parts[-1]["parts"][0]["text"] += "\n" + new_turn["parts"][0]["text"]
            else:
                parts.append(new_turn)

        return parts

# Text mode call uses shared state
async def handle_text_message(client, state: ConversationState, user_text: str):
    # Build context from timeline BEFORE adding this message (avoid duplication)
    context = state.to_text_context()
    context.append({"role": "user", "parts": [{"text": user_text}]})

    response = await client.models.generate_content_async(
        model="gemini-3.1-flash-lite",
        contents=context,
        config=types.GenerateContentConfig(
            system_instruction=PAPER_PROMPT if state.session_mode == "paper" else LOBBY_PROMPT,
            tools=[{"google_search": {}}, {"function_declarations": TOOL_DECLARATIONS}]
        )
    )

    # Record both sides AFTER the API call succeeds
    state.add_message("user", user_text)
    state.add_message("model", response.text)
    return response.text
```

The voice session's `forward_gemini_to_user()` loop calls `state.add_message()` for transcripts and `state.add_tool_result()` for every tool response — both at the moment they occur, preserving chronological order. When the user switches to text, `to_text_context()` interleaves them naturally. The token-budget truncation (`token_budget=200_000`, estimated at ~4 chars/token) walks the timeline backwards to include as many recent events as fit, keeping text-mode latency bounded — Flash-Lite doesn't need to reprocess the first 20 minutes of a 30-minute conversation to answer a simple question. Paper context is always retained; only older conversation turns are trimmed.

### Unified chat transcript

**Every voice interaction is simultaneously stored as a text chat message.** The Live API's transcription config provides text for both user speech and model responses. The frontend renders these as chat bubbles in real time — the user sees their words appear as text while they speak, and the agent's voice response appears as a text message alongside the audio playback.

This means the user can **switch between voice and text at any point without losing context**. The chat history is always complete, regardless of which mode produced each message. Practically:

- Start with voice → entire conversation visible as text in the chat panel
- Switch to text → type a follow-up question → see the text response with markdown formatting
- Switch back to voice → the agent has full context from both voice and text turns

```typescript
// Frontend: every transcript event becomes a chat message
type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  mode: "voice" | "text";                    // which mode produced this
  text: string;                               // transcript or text response
  audioData?: string;                         // base64 audio (voice mode only)
  timestamp: number;
  thinking?: ThinkingStep[];                  // reasoning trace (collapsed by default)
  toolCalls?: ToolCallEvent[];                // tool usage (collapsed by default)
};

type ThinkingStep = {
  content: string;                            // the model's reasoning text
};

type ToolCallEvent = {
  tool: string;                               // "search_academic_papers", "annotate_zotero_pdf", etc.
  input: Record<string, any>;                 // parameters sent to the tool
  output: Record<string, any>;                // result from the tool
  duration_ms: number;                        // how long the tool call took
  status: "calling" | "done" | "error";
};
```

### Chat UI: transparent reasoning

The chat panel shows everything that happens during a conversation — not just the final response, but the thinking and tool usage behind it. All internal activity is **visible but collapsed by default** so the chat stays clean. Users expand any step to see the full details.

**What the chat UI shows for a single agent turn:**

```
┌─────────────────────────────────────────────────────┐
│ 🎙️ You (voice)                                      │
│ "Is their error analysis statistically valid?"       │
├─────────────────────────────────────────────────────┤
│ 🤖 Colloquia                                        │
│                                                      │
│  ▶ Thinking...                          [collapsed]  │
│  ▶ 🔍 search_academic_papers called     [collapsed]  │
│  ▶ 🔍 Google Search: "bootstrap error   [collapsed]  │
│      estimation radio interferometry"                │
│                                                      │
│ "Their bootstrap approach has a subtle issue — they  │
│  resample the visibilities but don't account for the │
│  frequency covariance structure. Let me look up      │
│  whether this has been flagged before..."            │
│                                                      │
│  ▶ 🔍 search_academic_papers:           [collapsed]  │
│      "bootstrap resampling covariance                │
│       radio power spectrum"                          │
│                                                      │
│ "...yes, Tan et al. 2024 showed this can             │
│  underestimate errors by 15-30% for correlated       │
│  data. That paper isn't in your library — want me    │
│  to add it?"                                         │
└─────────────────────────────────────────────────────┘
```

**When the user expands a collapsed step:**

```
┌─────────────────────────────────────────────────────┐
│  ▼ 🔍 search_academic_papers (1.8s)    [expanded]   │
│  ┌─────────────────────────────────────────────────┐ │
│  │ Query: "bootstrap error estimation radio        │ │
│  │ interferometry visibility covariance"            │ │
│  │                                                  │ │
│  │ Results: 3 papers found                          │ │
│  │ 1. "On the validity of bootstrap resampling..." │ │
│  │ 2. "Frequency covariance in visibility-based..." │ │
│  │ 3. "Statistical methods for 21cm power..."      │ │
│  └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

**Implementation:** The backend sends `tool_status` messages via WebSocket for every tool call lifecycle event. The frontend appends these to the current `ChatMessage`'s `toolCalls` array. The React component renders each tool call as a collapsible `<details>` element.

```typescript
// React component for a tool call
function ToolCallBadge({ event }: { event: ToolCallEvent }) {
  const icon = {
    search_academic_papers: "🔍",
    annotate_zotero_pdf: "✏️",
    google_search: "🌐",
    manage_tags: "🏷️",
    add_paper_to_zotero: "📄",
  }[event.tool] || "⚙️";

  return (
    <details className="tool-call-details">
      <summary>
        {icon} {event.tool}
        {event.duration_ms && <span className="text-gray-400 ml-2">({(event.duration_ms / 1000).toFixed(1)}s)</span>}
      </summary>
      <div className="tool-call-content p-3 mt-1 bg-gray-50 rounded text-sm font-mono">
        <div><strong>Input:</strong> <pre>{JSON.stringify(event.input, null, 2)}</pre></div>
        <div><strong>Output:</strong> <pre>{JSON.stringify(event.output, null, 2)}</pre></div>
      </div>
    </details>
  );
}
```

---

## Audio pipeline: browser to Gemini and back

The audio pipeline requires careful sample rate management. Browsers typically capture at 44.1kHz or 48kHz, but Gemini expects **16kHz input** and produces **24kHz output**.

**Input pipeline (mic → Gemini):**
1. `getUserMedia({ audio: { channelCount: 1 } })` captures mic audio
2. Create `AudioContext({ sampleRate: 16000 })` — browser handles resampling automatically
3. `AudioWorklet` processor extracts Float32 samples on the audio thread
4. Convert Float32 → Int16 PCM (`sample * 0x7FFF`)
5. Send as binary WebSocket frames or base64-encoded JSON

**Output pipeline (Gemini → speaker):**
1. Receive base64 PCM16 chunks at 24kHz from WebSocket
2. Decode to Int16Array, convert to Float32 (`sample / 32768.0`)
3. Create `AudioBuffer` at 24kHz sample rate
4. Schedule playback using `AudioBufferSourceNode.start(scheduledTime)`
5. On interruption (`server_content.interrupted`), clear the playback queue

**The live-api-web-console starter app** (github.com/google-gemini/live-api-web-console) provides production-ready implementations of both pipelines in `src/lib/audio-streamer.ts` and the AudioWorklet processor. Fork these files directly — they handle edge cases like playback scheduling gaps and interruption cleanup.

> **⚠️ Safari compatibility note.** `AudioContext({ sampleRate: 16000 })` works in Chrome/Edge but **Safari does not support custom sample rates on AudioContext**. Safari will ignore the sampleRate parameter and capture at the device's native rate (usually 48kHz), requiring manual downsampling. For the hackathon demo, just use Chrome — but note this limitation in the README so judges on MacBooks know to open Chrome.

---

## Feature 1: Thin Zotero Plugin (Write-Back Layer)

The Zotero 7 Local API is **read-only**. To write data back — creating notes, adding tags, linking related items, saving annotations — you need a lightweight Zotero 7 plugin that registers custom HTTP endpoints on the existing `localhost:23119` server.

### Plugin architecture and endpoint registration

Zotero's built-in HTTP server allows plugins to register additional endpoints via `Zotero.Server.Endpoints`. When the server receives a request for a given endpoint, it calls the `init()` method of the specified object, passing `data` (the POST body or query string) and `sendResponseCallback` (a function to send the HTTP response). The pattern is straightforward — register an endpoint path, define supported methods, and implement the handler:

```javascript
// Register a custom endpoint in the Zotero plugin startup
Zotero.Server.Endpoints["/colloquia/createNote"] = function() {};
Zotero.Server.Endpoints["/colloquia/createNote"].prototype = {
  supportedMethods: ["POST"],
  supportedDataTypes: ["application/json"],
  permitBookmarklet: false,

  init: async function(requestData, sendResponseCallback) {
    try {
      const data = JSON.parse(requestData);
      const { parentItemKey, noteContent, tags } = data;

      const parentItem = await Zotero.Items.getByLibraryAndKeyAsync(
        Zotero.Libraries.userLibraryID, parentItemKey
      );
      if (!parentItem) {
        sendResponseCallback(404, "application/json",
          JSON.stringify({ error: "Parent item not found" }));
        return;
      }

      let note = new Zotero.Item('note');
      note.libraryID = parentItem.libraryID;
      note.parentID = parentItem.id;
      note.setNote(noteContent);  // HTML content
      if (tags && tags.length) {
        for (const tag of tags) note.addTag(tag, 0);
      }
      await note.saveTx();

      sendResponseCallback(200, "application/json",
        JSON.stringify({ success: true, noteKey: note.key }));
    } catch (e) {
      sendResponseCallback(500, "application/json",
        JSON.stringify({ error: e.message }));
    }
  }
};
```

### Zotero internal JavaScript API reference

The Zotero JS API is extensive but poorly documented — you mostly learn it from source code and forum posts. Here are the confirmed patterns for each operation needed:

**Creating notes:** Create a note with `new Zotero.Item('note')`, set `parentID` to the parent item's ID, call `.setNote(htmlContent)`, and save with `await note.saveTx()`. Notes store HTML content.

**Adding tags:** Use `item.addTag(tagName, type)` where type 0 is user tags and type 1 is automatic. Call `await item.saveTx()` after modifying.

**Related items:** Linking related items is bidirectional and requires two save operations: `itemA.addRelatedItem(itemB); await itemA.saveTx(); itemB.addRelatedItem(itemA); await itemB.saveTx();`

**Collections:** Create collections with `new Zotero.Collection()`, set the `name` and optional `parentID`, and save with `await collection.saveTx()`. Add items to collections via `item.addToCollection(collectionIDOrKey)` followed by `await item.saveTx()`.

**save() vs saveTx():** `save()` is meant to be used within a transaction, while `saveTx()` starts its own transaction and will hang if used within `executeTransaction()`. For plugin endpoint handlers, always use `saveTx()`.

### CORS solution for plugin endpoints

Cross-origin restrictions prevent webpages from reading responses from the Zotero HTTP server. Since the plugin's endpoints live on the same `localhost:23119` origin as the read-only API, the **Vite proxy approach already handles this**. Add a proxy route for `/zotero-plugin` that maps to `/colloquia/*` endpoints, and both read and write operations go through the same CORS-free proxy.

For the plugin itself, if you want to also support direct access (e.g., from a production deployment or browser extension), you can add CORS headers in the `sendResponseCallback`. However, Zotero's server implementation may not natively support custom response headers — testing is needed. The Vite proxy is the reliable path for the hackathon.

### Plugin project structure

Based on the `windingwind/zotero-plugin-template`, which uses esbuild + TypeScript, with the main entry point in `src/index.ts` calling `hooks.ts > onStartup` for initialization:

```
zotero-colloquia-plugin/
├── src/
│   ├── index.ts              # Bootstrap entry, registers on Zotero startup
│   ├── hooks.ts              # Lifecycle hooks (onStartup, onShutdown)
│   └── modules/
│       ├── endpoints.ts      # All HTTP endpoint registrations
│       ├── notes.ts          # Note creation/management
│       ├── tags.ts           # Tag operations
│       ├── collections.ts    # Collection management
│       ├── relations.ts      # Related item links
│       ├── annotations.ts    # PDF annotation creation
│       └── papers.ts         # Paper import via DOI
├── addon/
│   └── manifest.json         # Plugin manifest for Zotero 7
├── package.json
└── tsconfig.json
```

Build with `npm run build` → produces `.xpi` file in `.scaffold/build/`. Install via Zotero → Tools → Add-ons → gear icon → Install Add-on from File.

### Complete endpoint specification

| Endpoint | Method | Accepts | Returns |
|----------|--------|---------|---------|
| `/colloquia/createNote` | POST | `{parentItemKey, noteContent, tags[]}` | `{noteKey}` |
| `/colloquia/addTags` | POST | `{itemKeys[], tags[]}` | `{modified: count}` |
| `/colloquia/removeTags` | POST | `{itemKeys[], tags[]}` | `{modified: count}` |
| `/colloquia/addRelated` | POST | `{itemKey1, itemKey2}` | `{success: true}` |
| `/colloquia/createAnnotation` | POST | `{parentItemKey, annotationType, pageIndex, rects, comment, color}` | `{annotationKey}` |
| `/colloquia/getAnnotations` | POST | `{itemKey}` | `{annotations[]}` |
| `/colloquia/listCollections` | GET | — | `{collections[]}` |
| `/colloquia/createCollection` | POST | `{name, parentCollectionKey?}` | `{collectionKey}` |
| `/colloquia/addToCollection` | POST | `{itemKeys[], collectionKey}` | `{modified: count}` |
| `/colloquia/removeFromCollection` | POST | `{itemKeys[], collectionKey}` | `{modified: count}` |
| `/colloquia/addPaper` | POST | `{doi?, title?, authors?, url?, collectionKey?}` | `{itemKey}` |
| `/colloquia/trashItems` | POST | `{itemKeys[]}` | `{trashed: count}` |
| `/colloquia/searchLibrary` | POST | `{query?, tag?, collection?, author?, dateRange?}` | `{items[]}` |

---

## Feature 2: Live Annotation in Zotero's PDF Reader

This is the highest-impact demo feature. During a voice conversation, when the agent discusses a figure or equation, it simultaneously creates real annotations visible in Zotero's PDF reader — highlights, area selections, and notes with the AI's analysis as comments. These annotations persist, sync across devices, and are fully searchable.

### Annotation data model

Zotero stores annotations as regular items with `itemType: "annotation"`. The key fields, confirmed by the annotation metadata format visible in the Zotero JS API:

```json
{
  "itemType": "annotation",
  "parentItem": "PDF_ATTACHMENT_KEY",
  "annotationType": "image",
  "annotationText": "",
  "annotationComment": "AI: Power spectrum showing 21cm signal excess at 150 MHz.",
  "annotationColor": "#a28ae5",
  "annotationPageLabel": "4",
  "annotationSortIndex": "00003|000200|00120",
  "annotationPosition": "{\"pageIndex\":3,\"rects\":[[120.0,200.0,450.0,500.0]]}"
}
```

### Creating annotations via the plugin

```javascript
// Plugin endpoint: POST /colloquia/createAnnotation
Zotero.Server.Endpoints["/colloquia/createAnnotation"].prototype = {
  supportedMethods: ["POST"],
  supportedDataTypes: ["application/json"],

  init: async function(requestData, sendResponseCallback) {
    try {
      const data = JSON.parse(requestData);
      const { parentItemKey, annotationType, pageIndex, rects, comment, color } = data;

      // Find the PDF attachment
      const parentItem = await Zotero.Items.getByLibraryAndKeyAsync(
        Zotero.Libraries.userLibraryID, parentItemKey
      );
      if (!parentItem) {
        sendResponseCallback(404, "application/json",
          JSON.stringify({ error: "PDF attachment not found" }));
        return;
      }

      let annotation = new Zotero.Item('annotation');
      annotation.libraryID = parentItem.libraryID;
      annotation.parentID = parentItem.id;
      annotation.annotationType = annotationType || 'image';
      annotation.annotationComment = comment || '';
      annotation.annotationColor = color || '#a28ae5';
      annotation.annotationPageLabel = String(pageIndex + 1);  // 1-indexed label
      annotation.annotationPosition = JSON.stringify({
        pageIndex: pageIndex,
        rects: rects
      });

      // Calculate sort index: pageIndex|yPosition|xPosition (zero-padded)
      const yPos = rects[0] ? Math.round(rects[0][1]) : 0;
      const xPos = rects[0] ? Math.round(rects[0][0]) : 0;
      annotation.annotationSortIndex =
        `${String(pageIndex).padStart(5, '0')}|${String(yPos).padStart(6, '0')}|${String(xPos).padStart(5, '0')}`;

      await annotation.saveTx();

      sendResponseCallback(200, "application/json",
        JSON.stringify({ success: true, annotationKey: annotation.key }));
    } catch (e) {
      sendResponseCallback(500, "application/json",
        JSON.stringify({ error: e.message }));
    }
  }
};
```

**Annotation types for different use cases:**

| Type | Use Case | Position Format |
|------|----------|-----------------|
| `highlight` | Specific text passages the agent references | `{pageIndex, rects: [[x1,y1,x2,y2], ...]}` — one rect per text line |
| `image` | Area selections around figures, tables, equations | `{pageIndex, rects: [[x1,y1,x2,y2]]}` — single bounding box |
| `note` | Pinned comments at a specific location | `{pageIndex, rects: [[x,y,0,0]]}` — point coordinate |

For figure annotation, **`image` type is the best choice** — it creates a colored rectangular overlay around the region.

### Gemini vision → PDF coordinate mapping

Gemini returns bounding boxes in `[y_min, x_min, y_max, x_max]` format with coordinates normalized to 0–1000. The top-left corner is the origin, with x going horizontally and y going vertically. PDF coordinate space uses the **bottom-left** as origin with units in PDF points (1/72 inch). The mapping:

```python
import fitz  # PyMuPDF

def gemini_to_pdf_coords(
    gemini_box: list[int],  # [y_min, x_min, y_max, x_max] in 0-1000
    page_width_pts: float,  # from fitz page.rect.width
    page_height_pts: float  # from fitz page.rect.height
) -> list[list[float]]:
    """Convert Gemini's normalized coords to PDF coordinate space."""
    y_min, x_min, y_max, x_max = gemini_box

    # Gemini: 0-1000, origin top-left
    # PDF: points, origin bottom-left
    pdf_x1 = (x_min / 1000.0) * page_width_pts
    pdf_x2 = (x_max / 1000.0) * page_width_pts
    # Flip Y axis
    pdf_y1 = page_height_pts - (y_max / 1000.0) * page_height_pts
    pdf_y2 = page_height_pts - (y_min / 1000.0) * page_height_pts

    return [[pdf_x1, pdf_y1, pdf_x2, pdf_y2]]

def get_page_dimensions(pdf_path: str, page_index: int) -> tuple[float, float]:
    """Get PDF page dimensions in points."""
    doc = fitz.open(pdf_path)
    page = doc[page_index]
    return page.rect.width, page.rect.height
```

### Gemini vision spatial understanding

Gemini's bounding box detection is well-suited for this use case. Gemini returns coordinates in `[y_min, x_min, y_max, x_max]` format normalized to 0–1000. This works via both text prompting and structured function calling. For academic paper figures, the approach is:

1. Send page images to Gemini at session start with the system instruction to identify figures, tables, and equations
2. During conversation, when the agent discusses a specific figure, it calls `annotate_zotero_pdf` with the bounding box coordinates
3. The backend converts the coordinates from Gemini's 0–1000 space to PDF points
4. The frontend relays to the Zotero plugin endpoint

**Accuracy note:** Gemini can occasionally return bounding boxes like `[0, 0, 0, 0]` or coordinates outside the 0–1000 range. Add validation: reject boxes where all coordinates are zero or any coordinate exceeds 1000.

### Function declaration for Gemini Live API

```python
annotate_pdf_tool = {
    "name": "annotate_zotero_pdf",
    "description": "Create a visual annotation on the PDF in Zotero's reader. Use when discussing a specific figure, table, equation, or passage to highlight it for the user. The annotation appears live in Zotero.",
    "parameters": {
        "type": "object",
        "properties": {
            "parentItemKey": {"type": "string", "description": "Zotero item key of the PDF attachment"},
            "annotationType": {"type": "string", "enum": ["highlight", "image", "note"],
                               "description": "Use 'image' for figures/tables, 'highlight' for text, 'note' for point comments"},
            "pageIndex": {"type": "integer", "description": "Zero-indexed page number"},
            "boundingBox": {
                "type": "array", "items": {"type": "integer"},
                "description": "Bounding box [y_min, x_min, y_max, x_max] in 0-1000 normalized coords"
            },
            "comment": {"type": "string", "description": "AI analysis to attach as annotation comment"}
        },
        "required": ["parentItemKey", "annotationType", "pageIndex", "boundingBox", "comment"]
    }
}
```

### Live refresh behavior

When annotations are created via the JS API while a PDF is open in Zotero's reader, **the reader auto-refreshes** — annotations appear immediately without the user needing to close and reopen the PDF. Zotero's internal notification system (`Zotero.Notifier`) fires on item changes, and the PDF reader listens for annotation changes on its current document. This is what makes the live demo compelling.

> **⚠️ Verify this on Day 3, not Day 4.** The auto-refresh claim is based on how `Zotero.Notifier` propagates item changes, but hasn't been independently confirmed for plugin-created annotations specifically. If the reader doesn't auto-refresh, you'll need to trigger it manually — try `Zotero.Notifier.trigger('refresh', 'item', [annotationID])` or `Zotero.Notifier.trigger('redraw', 'item', [parentAttachmentID])`. Test this alongside the plugin scaffolding on Day 3 so you have time to fix it before the annotation feature work on Day 4.

### Color coding strategy

Use `#a28ae5` (purple) for all AI annotations. Zotero's default annotation colors are yellow (`#ffd400`), red (`#ff6666`), green (`#5fb236`), blue (`#2ea8e5`), and orange. Purple is immediately distinguishable as AI-generated and doesn't conflict with common manual annotation workflows.

---

## Feature 3: Related Paper Discovery & Addition

The agent proactively identifies referenced papers during discussion and offers to add them to the user's Zotero library.

### Academic paper search integration

**OpenAlex API** is the primary integration — free, open, and covers 250M+ scholarly works. No API key required; uses a polite pool with a `mailto` header for higher rate limits (10 req/sec vs 100k req/day). Direct HTTP calls via `httpx`:

```python
import httpx

OA_BASE = "https://api.openalex.org"

async def search_academic_papers(query: str, year: str = None, limit: int = 5) -> dict:
    """Search OpenAlex for papers."""
    params = {
        "search": query,
        "per_page": limit,
        "sort": "cited_by_count:desc",
        "mailto": "colloquia-app@users.noreply.github.com",
    }
    if year:
        params["filter"] = f"publication_year:{year}"
    async with httpx.AsyncClient() as client:
        resp = await client.get(f"{OA_BASE}/works", params=params)
        data = resp.json()
        return {
            "papers": [_format_work(p) for p in data.get("results", [])]
        }

async def get_paper_by_doi(doi: str) -> dict:
    """Get paper details by DOI."""
    async with httpx.AsyncClient() as client:
        resp = await client.get(f"{OA_BASE}/works/https://doi.org/{doi}")
        return resp.json()

async def get_recommendations(paper_id: str, limit: int = 5) -> list:
    """Get recommended papers via related_works field."""
    async with httpx.AsyncClient() as client:
        resp = await client.get(f"{OA_BASE}/works/{paper_id}")
        seed = resp.json()
        related_ids = seed.get("related_works", [])[:limit]
        if related_ids:
            filter_str = "|".join(related_ids)
            resp = await client.get(f"{OA_BASE}/works", params={"filter": f"openalex:{filter_str}"})
            return resp.json().get("results", [])
        return []
```

**OpenAlex rate limits:** 100k requests/day without auth, 10 req/sec with polite pool (`mailto` header). More than sufficient for the hackathon.

### Zotero plugin endpoint for adding papers

> **⚠️ Test `Zotero.Translate.Search()` on Day 3, not Day 4.** The DOI-based import via Zotero's translator infrastructure is the right approach — it pulls full metadata, abstracts, and even PDF links automatically. However, this API can be flaky: it depends on Zotero's translator infrastructure being loaded, network access to DOI resolvers, and the specific translator for each publisher. If it fails silently or throws, fall back to the manual `new Zotero.Item('journalArticle')` path using metadata already fetched from OpenAlex. Wrap the translate path in a try/catch with the manual path as the explicit fallback.

```javascript
// Plugin endpoint: POST /colloquia/addPaper
Zotero.Server.Endpoints["/colloquia/addPaper"].prototype = {
  supportedMethods: ["POST"],
  supportedDataTypes: ["application/json"],

  init: async function(requestData, sendResponseCallback) {
    const data = JSON.parse(requestData);
    try {
      let item;
      if (data.doi) {
        // Use Zotero's built-in DOI lookup (mirrors "Add by Identifier")
        let identifier = data.doi.replace(/^https?:\/\/doi\.org\//, '');
        let translate = new Zotero.Translate.Search();
        translate.setIdentifier({ DOI: identifier });
        let translators = await translate.getTranslators();
        translate.setTranslator(translators);
        let items = await translate.translate({
          libraryID: Zotero.Libraries.userLibraryID
        });
        item = items[0];
      } else {
        // Manual metadata entry
        item = new Zotero.Item('journalArticle');
        item.libraryID = Zotero.Libraries.userLibraryID;
        if (data.title) item.setField('title', data.title);
        if (data.date) item.setField('date', data.date);
        if (data.url) item.setField('url', data.url);
        if (data.abstract) item.setField('abstractNote', data.abstract);
        if (data.authors) {
          item.setCreators(data.authors.map(a => ({
            firstName: a.firstName || '',
            lastName: a.lastName || a.name || '',
            creatorType: 'author'
          })));
        }
        await item.saveTx();
      }

      // Add to collection if specified
      if (data.collectionKey && item) {
        let collection = await Zotero.Collections.getByLibraryAndKeyAsync(
          Zotero.Libraries.userLibraryID, data.collectionKey
        );
        if (collection) {
          item.addToCollection(collection.id);
          await item.saveTx();
        }
      }

      sendResponseCallback(200, "application/json",
        JSON.stringify({ success: true, itemKey: item.key, title: item.getField('title') }));
    } catch (e) {
      sendResponseCallback(500, "application/json",
        JSON.stringify({ error: e.message }));
    }
  }
};
```

### Function declarations for Gemini

```python
discovery_tools = [
    {
        "name": "search_academic_papers",
        "description": "Search for academic papers by title, author, or topic using OpenAlex. Use when a referenced paper is mentioned or the user wants related work.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search query"},
                "year": {"type": "string", "description": "Optional year or range (e.g., '2023' or '2020-2024')"},
                "limit": {"type": "integer", "description": "Max results (default 5)"}
            },
            "required": ["query"]
        }
    },
    {
        "name": "search_zotero_library",
        "description": "Search the user's local Zotero library to check if a paper already exists.",
        "parameters": {
            "type": "object",
            "properties": {"query": {"type": "string"}},
            "required": ["query"]
        }
    },
    {
        "name": "add_paper_to_zotero",
        "description": "Add a paper to the user's Zotero library. ALWAYS confirm with the user first. Prefer DOI.",
        "parameters": {
            "type": "object",
            "properties": {
                "doi": {"type": "string"},
                "title": {"type": "string"},
                "authors": {"type": "array", "items": {"type": "object", "properties": {"name": {"type": "string"}}}},
                "collectionKey": {"type": "string", "description": "Optional collection to add to"}
            }
        }
    },
    {
        "name": "get_paper_recommendations",
        "description": "Get similar papers from OpenAlex for literature gap analysis.",
        "parameters": {
            "type": "object",
            "properties": {
                "paperId": {"type": "string", "description": "OpenAlex paper ID or DOI"},
                "limit": {"type": "integer"}
            },
            "required": ["paperId"]
        }
    }
]
```

### Workflow: paper discovery during conversation

```
User discusses paper → Agent identifies referenced work
                            ↓
          search_academic_papers("Smith et al 2023 power spectrum")
                            ↓
          Found: "21cm Power Spectrum Analysis" by Smith (2023)
                  DOI: 10.1234/xxx, 47 citations
                            ↓
          search_zotero_library("Smith 2023 power spectrum")
                            ↓
        ┌── Found → "This paper is already in your library"
        └── Not found → "I found [title] by [authors], [year],
                         [N] citations. Want me to add it?"
                            ↓ (user confirms)
              add_paper_to_zotero(doi="10.1234/xxx")
                            ↓
              "Added! I've linked it as related to the current paper."
```

---

## Feature 4: Zotero Library Management & Organization

The agent acts as an intelligent library organizer through voice commands — managing tags, collections, and relationships.

### Zotero JS API for library management

All confirmed from the Zotero JavaScript API documentation and developer forums:

**Tags:**
```javascript
// Add tags
item.addTag("radio-cosmology", 0);  // type 0 = user tag
await item.saveTx();

// Remove tags
item.removeTag("old-tag");
await item.saveTx();

// Get all tags on an item
let tags = item.getTags();  // [{tag: "name", type: 0}, ...]
```

**Collections:**
```javascript
// Create collection
let collection = new Zotero.Collection();
collection.name = "Beam Systematics";
collection.libraryID = Zotero.Libraries.userLibraryID;
await collection.saveTx();

// Add item to collection
item.addToCollection(collection.id);
await item.saveTx();

// Remove from collection (not delete)
item.removeFromCollection(collection.id);
await item.saveTx();
```

**Trash (recoverable, not permanent):**
```javascript
item.deleted = true;
await item.saveTx();
```

**Bulk operations with transactions:**
```javascript
await Zotero.DB.executeTransaction(async function() {
  for (let item of items) {
    item.addTag("radio-cosmology", 0);
    await item.save();  // save() inside transaction, not saveTx()
  }
});
```

### Function declarations for library management

```python
management_tools = [
    {
        "name": "manage_tags",
        "description": "Add or remove tags on items. After discussing a paper, suggest relevant tags.",
        "parameters": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["add", "remove"]},
                "itemKeys": {"type": "array", "items": {"type": "string"}},
                "tags": {"type": "array", "items": {"type": "string"}}
            },
            "required": ["action", "itemKeys", "tags"]
        }
    },
    {
        "name": "manage_collection",
        "description": "Create collections or add/remove items from collections.",
        "parameters": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["create", "list", "addItems", "removeItems"]},
                "collectionKey": {"type": "string"},
                "name": {"type": "string"},
                "parentCollectionKey": {"type": "string"},
                "itemKeys": {"type": "array", "items": {"type": "string"}}
            },
            "required": ["action"]
        }
    },
    {
        "name": "link_related_items",
        "description": "Create a bidirectional 'Related' link between two papers.",
        "parameters": {
            "type": "object",
            "properties": {
                "itemKey1": {"type": "string"},
                "itemKey2": {"type": "string"}
            },
            "required": ["itemKey1", "itemKey2"]
        }
    },
    {
        "name": "trash_items",
        "description": "Move items to trash. ALWAYS confirm first. Items are recoverable.",
        "parameters": {
            "type": "object",
            "properties": {
                "itemKeys": {"type": "array", "items": {"type": "string"}}
            },
            "required": ["itemKeys"]
        }
    }
]
```

### Safety guardrails (enforced in system prompt)

```
## Library Management Safety Rules
- ALWAYS confirm before trashing: "I'll move [title] to trash. This is recoverable. Proceed?"
- NEVER permanently delete — only move to trash
- Before bulk tag operations on >5 items, confirm: "This will tag 12 papers. Proceed?"
- After bulk operations, summarize: "Done — tagged 12 papers with 'radio-cosmology'"
- Suggest tags proactively after discussion, but don't apply without asking
- Check if a relevant collection exists before suggesting creation
```

---

## Risk mitigation plan

| Risk | Impact | Likelihood | Mitigation |
|------|--------|-----------|------------|
| Google Search grounding bug (Vertex AI) | Can't ground responses in web search | Medium | Use Google AI Studio API, not Vertex AI. Implement fallback function tool |
| Live API session drops after ~10 min | Conversation interrupted | High | Session resumption enabled by default (handles cached, reconnects within 2h). Skip compression for demo (stability bug). See session config section. |
| Cloud Run cold starts (~2-5s) | First connection delayed | High | Set `--min-instances=1` on Cloud Run deployment |
| Zotero not running or API disabled | Can't access papers | Medium | Frontend health check on startup (see architecture section); show onboarding UI with setup steps; fall back to manual PDF upload |
| 128K token limit exceeded | Context truncated | Low | Summarize long papers, use fulltext endpoint, monitor token count |
| Audio quality/echo issues | Poor user experience | Medium | Recommend headphones in UI; use AudioWorklet (not deprecated ScriptProcessorNode) |
| Gemini bounding box inaccuracy | Annotations placed incorrectly | Medium | Validate coordinates (reject zeros, out-of-range); allow user to adjust annotations in Zotero afterwards |
| Zotero plugin CORS issues | Write operations fail | Low | Vite proxy handles this; test early on Day 3 |
| OpenAlex rate limits | Paper search throttled | Low | 100 req/5min is generous; cache results; fall back to Google Search grounding |
| Browser compatibility | Audio capture fails | Low | Target Chrome/Edge; require HTTPS or localhost; add "Click to Start" button |

---

## Error recovery UX

The backend has error handling (try/catch around tool calls, error messages via WebSocket), but what does the user actually see? For a demo, confusing failures are worse than visible failures. Build a minimal error UX layer:

### Toast notification system for tool failures

Every `tool_call` event with `status: "error"` triggers a toast notification in the UI. The agent also receives the error as a `FunctionResponse` and can explain it conversationally:

```typescript
// React: toast on tool errors
function useToolErrorToasts(messages: ChatMessage[]) {
  useEffect(() => {
    const latest = messages[messages.length - 1];
    for (const tc of latest?.toolCalls ?? []) {
      if (tc.status === "error") {
        toast.error(`${tc.tool} failed: ${tc.output?.error ?? "Unknown error"}`, {
          duration: 5000
        });
      }
    }
  }, [messages]);
}
```

What the user experiences for specific failures:

| Failure | User sees | Agent says |
|---------|-----------|------------|
| OpenAlex down | Toast: "Paper search unavailable" | "I can't search OpenAlex right now. Let me try Google Search instead." (falls back to grounding) |
| Annotation coordinate validation fails | Toast: "Annotation placement failed" | "I wasn't able to place that annotation precisely — the coordinates didn't map correctly. You can add it manually in Zotero." |
| Zotero plugin timeout (10s) | Toast: "Zotero didn't respond" | "I couldn't write to Zotero — is it still running? Check that the Colloquia plugin is installed." |
| Gemini session drops | **Reconnection spinner** overlay on chat | (Session resumes automatically via resumption handle — user sees "Reconnecting..." for 1-3s) |
| Resumption fails entirely | **Session ended** modal with "Start new session" button | (No agent — UI handles this) |

### Connection state indicator

A small status pill in the UI header — not a modal, just a persistent indicator:

```typescript
type ConnectionState = "connected" | "reconnecting" | "disconnected" | "error";

// Green dot = connected, yellow spinner = reconnecting, red dot = disconnected
function ConnectionBadge({ state }: { state: ConnectionState }) {
  const styles = {
    connected: "bg-green-500",
    reconnecting: "bg-yellow-500 animate-pulse",
    disconnected: "bg-red-500",
    error: "bg-red-500",
  };
  return <div className={`w-2 h-2 rounded-full ${styles[state]}`} />;
}
```

### Context usage indicator

The `genai` SDK returns `usage_metadata` with token counts in responses. The receive loop already extracts this and forwards `context_usage` events to the frontend (see the tool orchestration loop above). Show a progress bar in the UI header next to the connection badge:

```typescript
// Frontend: context usage bar in the header
function ContextUsageBar({ used, limit }: { used: number; limit: number }) {
  const pct = Math.min((used / limit) * 100, 100);
  const color = pct > 85 ? "bg-red-500" : pct > 65 ? "bg-yellow-500" : "bg-green-500";
  const label = `${Math.round(used / 1000)}K / ${Math.round(limit / 1000)}K`;

  return (
    <div className="flex items-center gap-2 text-xs text-gray-500">
      <div className="w-24 h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
      </div>
      <span>{label}</span>
    </div>
  );
}

// Header layout: [ConnectionBadge] [ContextUsageBar] [Settings gear]
```

When the bar crosses 85%, change to red and the agent should proactively mention: "We're getting close to the context limit — I might lose some earlier conversation details soon. Want me to save a summary as a Zotero note before that happens?" This is handled in the system prompt (no code needed — the agent sees the context window state via the compression behavior).

For text mode, context usage is less critical (Flash-Lite's 1M window is enormous), but the bar still updates based on `to_text_context()` length for consistency.

### Empty library onboarding

If the user has no papers in Zotero (or Zotero has an empty library), the paper browser is useless and a judge hitting this on first install will bounce. Detect this on startup alongside the Zotero health check:

```typescript
async function checkLibraryState(): Promise<"populated" | "empty" | "unavailable"> {
  try {
    const resp = await fetch('/zotero-api/users/0/items/top?limit=1');
    if (!resp.ok) return "unavailable";
    const items = await resp.json();
    return items.length > 0 ? "populated" : "empty";
  } catch {
    return "unavailable";
  }
}
```

If the library is empty, show a welcoming onboarding screen:

> **"Your Zotero library is empty — let's fix that!"**
> Search for papers in your area to get started:
> `[Search field: "21cm cosmology"]` → [Search OpenAlex]
>
> Or: try Colloquia in lobby mode — just start talking and ask me to find papers for you.

The lobby agent handles this naturally — "find me papers about radio interferometry" works even with an empty library, since it searches OpenAlex and offers to add results. The onboarding screen is just the nudge to start that conversation.

---

## System prompts

Colloquia uses two system prompts, swapped based on session mode. The backend selects the appropriate one when the session starts (lobby if no paper context received) and swaps to the paper prompt when `paper_context` arrives mid-session.

### Lobby mode prompt (no paper selected)

```
You are Colloquia — a research assistant with access to the user's Zotero
library, academic paper search (OpenAlex), and web search. No paper is
currently loaded for deep discussion.

## What You Can Do
- Search the user's Zotero library: "What papers do I have on [topic]?"
- Search for new papers on OpenAlex: "Find recent work on [topic]"
- Get paper recommendations based on a paper the user mentions
- Add papers to the user's library (always confirm first)
- Browse and organize collections and tags
- Answer general research questions using web search
- Help the user decide which paper to read or discuss next

## Behavior
Be conversational and helpful. When the user asks about a topic, search their
library first, then offer to search externally if nothing matches. When they
seem interested in a specific paper, offer to load it for deep discussion:
"Want me to pull up that paper so we can go through it together?"

When a paper is loaded (you'll receive the full text and metadata), your role
shifts to deep paper discussion — you'll get a new context with the paper
content at that point.

## Voice Guidelines
Same as paper mode — keep it conversational, 2-4 sentences per turn, never
read URLs. For search results, summarize the top 2-3 hits verbally and offer
to show the full list in the chat.

## Tools Available
- search_zotero_library — search the user's Zotero library
- search_academic_papers — search OpenAlex
- add_paper_to_zotero — add a paper (confirm first)
- get_paper_recommendations — find similar papers
- manage_tags, manage_collection — organize the library
- Google Search — web lookup for any research question

If a tool returns an error, explain briefly and try an alternative (e.g., use
Google Search if OpenAlex fails). Never silently swallow errors.
```

### Paper mode prompt (paper loaded for discussion)

```
You are Colloquia — a knowledgeable research colleague who has carefully read the
paper the user wants to discuss. You don't summarize robotically; you engage like
a postdoc who actually finds this stuff interesting.

## Current Context
You are currently discussing: {title} by {authors} ({year}).
DOI: {doi}. Published in: {venue}.
The paper has {annotation_count} existing annotations and {note_count} notes in Zotero.
PDF attachment key: {pdf_attachment_key} (use this for annotation tool calls).
{user_annotations_summary}

You have the full text and key figures in context. Reference specific sections,
equations, figures, and tables by number. When the user's existing annotations
suggest they're interested in or confused by a section, bring that up naturally.

## Core Behavior: Understand and Explain
Your primary job is helping the user deeply understand this paper. This means:
- When they ask about a method, explain the *intuition* first (1-2 sentences),
  then offer to go deeper: "Want me to walk through the math?" or "I can search
  for a good tutorial on this technique"
- When they ask about a result, contextualize it: what did the field expect?
  Is this surprising? How does it compare to other experiments?
- When you encounter a concept that might be unfamiliar, briefly define it in
  context without being condescending: "...the UV plane — that's the Fourier
  space where each baseline maps to a spatial frequency..."
- When something in the paper is genuinely unclear or poorly explained, say so:
  "This paragraph is confusing — I think what they mean is..."
- Use Google Search proactively when:
  * The user asks about a technique or concept not fully explained in the paper
  * You want to verify or update a claim ("Let me check if there's been follow-up work")
  * The user asks "is this still the state of the art?" or similar current-status questions
  * A referenced paper's results are relevant to the discussion

## Adaptive Expertise
Match your level to the user's. If they use technical jargon confidently
("What's the UV coverage for their baseline distribution?"), respond at that
level. If they ask foundational questions ("What is an interferometer?"), explain
clearly without condescension. When unsure of the right level, give the intuition
first and offer depth: "The short version is... Want me to unpack that?"

## Web Search and Knowledge Augmentation
You have access to Google Search and OpenAlex. USE THEM LIBERALLY:
- Don't just answer from the paper — bring in broader context
- If the user asks about a technique, search for recent developments or tutorials
- If a concept is from another field, search for an accessible explanation
- If the paper's claims seem strong, search for corroborating or conflicting results
- When you search, tell the user naturally: "Let me look that up..." — then give
  a grounded answer, not just "I found a paper that says..."
- For academic-specific searches (finding papers, checking citations, author lookup),
  prefer search_academic_papers over Google Search

## Your Tools
- search_zotero_library — find papers in the user's library
- search_academic_papers — search OpenAlex for papers, authors, citations
- add_paper_to_zotero — add discovered papers (always confirm first)
- get_paper_recommendations — literature gap analysis and related work
- annotate_zotero_pdf — create live annotations in Zotero's PDF reader when
  discussing figures, tables, or equations. Use purple (#a28ae5). Include a
  concise analysis as the annotation comment.
- manage_tags — suggest and apply tags after discussion
- manage_collection — organize papers into collections
- link_related_items — connect related papers
- Google Search — broader web context, technique lookups, recent developments

## Voice Conversation Guidelines
Keep responses conversational — 2 to 4 sentences per turn for simple answers,
longer for explanations the user asked for. Offer to elaborate when topics
deserve depth. Never read out URLs, complex notation, or long reference lists.
Use natural speech: "The authors found that..." not "According to Section 3.2,
the experimental results in Table 4 indicate..."

When explaining equations by voice, describe what each term means physically
rather than reading symbols: "The power spectrum scales as k to the negative
three, which means larger structures dominate" — not "P of k equals A times k
to the power of negative three."

## Paper Discovery
When you notice a referenced paper in the discussion:
1. Search for it using search_academic_papers
2. Check if it exists in the library using search_zotero_library
3. If not found, mention it naturally with citation count and offer to add
4. Always confirm before adding
5. After adding, suggest linking as related to the current paper

## Library Management Safety
- ALWAYS confirm before trashing items
- NEVER permanently delete — only trash
- Confirm bulk operations affecting >5 items
- Summarize changes after bulk operations
- Suggest tags proactively but don't apply without asking

## Error Handling and Graceful Degradation
If a tool returns an error, explain the issue briefly and try an alternative:
- OpenAlex fails → "Paper search is temporarily unavailable. Let me
  try Google Search instead." (use Google Search grounding)
- Zotero write fails → "I couldn't save that to Zotero — is it still running?
  You can do it manually: [describe the action]."
- Annotation coordinates invalid → "I wasn't able to place that annotation
  precisely. You can add it manually in Zotero's reader."
Never silently swallow errors. Always tell the user what happened and what
you're doing instead.

## Discussion Approach
Start by briefly confirming which paper is loaded and noting what looks
interesting (based on abstract + user's annotations). Ask what they want to
explore rather than launching into a summary. Provide critical analysis —
strengths, limitations, biases, methodological concerns. When uncertain, say
so and offer to search for verification. Your goal is to make the user
*understand* the paper better than they could by reading it alone.
```

> **Implementation note:** The backend starts every session with the **lobby prompt**. When a `paper_context` message arrives (either at session start because the user pre-selected a paper, or mid-session after the user picks one), the backend swaps to the **paper prompt** with template variables filled from the paper metadata. The `{title}`, `{authors}`, `{year}`, `{doi}`, `{venue}`, `{annotation_count}`, `{note_count}`, `{pdf_attachment_key}`, and `{user_annotations_summary}` are injected dynamically. The `pdf_attachment_key` is critical — the agent needs it for `annotate_zotero_pdf` calls.
>
> **✅ Mid-session system prompt swap is confirmed working.** The Gemini Live API supports updating system instructions mid-session via `send_client_content()` with `role="system"`. This does NOT reset the session or wipe conversation history — the new instruction replaces the old one and remains in effect for the rest of the session. This is not a `BidiGenerateContentSetup` re-send (which would reset the connection); it's an in-session content update. The lobby→paper transition uses this directly (see the `handle_paper_load()` function in the backend section). Verify on Day 2 that this works with the raw `genai` SDK as expected.

---

## Updated six-day development plan (March 11–16, demo March 17)

**Day 1 — Foundation and Zotero read integration.** Initialize Vite + React + TypeScript. Configure Vite proxy for Zotero (both `/zotero-api` and `/zotero-plugin` routes). **Define the frontend ↔ backend WebSocket message protocol** (see protocol spec above) — this prevents integration headaches on Days 2–4. Build the settings panel for BYOK API key entry (Gemini key required, OpenAlex optional — persist in `localStorage`, skip setup screen on subsequent launches, add "Change API key" in settings). Build paper browser: list collections, search items, display metadata. Implement the Zotero health check (ping `localhost:23119` on startup, show onboarding UI if Zotero is unavailable). Set up FastAPI backend skeleton on Cloud Run with `--min-instances=1 --timeout=3600`. Test basic `genai.Client(api_key=...).aio.live.connect()` call with user-provided key. **Deliverable:** Browse and search Zotero library in the UI; backend deployed; WebSocket protocol documented and typed; API key entry working.

**Day 2 — Voice pipeline + tool orchestration loop.** Implement audio capture (getUserMedia + AudioWorklet at 16kHz) and playback (AudioBufferSourceNode at 24kHz). Write the `run_session()` event loop with `client.aio.live.connect()` — handle audio forwarding, tool call interception, and transcript extraction. Wire frontend WebSocket to backend. Basic voice conversation with lobby prompt. Verify `send_client_content(role="system")` mid-session prompt swap works. **Deliverable:** Speak to Gemini and hear responses; tool call loop working with at least one test tool.

**Day 3 — Paper context + Zotero plugin MVP.** Paper content extraction via Zotero fulltext endpoint; send content to backend at session init. Scaffold the Zotero plugin from `windingwind/zotero-plugin-template`. Implement core endpoints: `createNote`, `addTags`, `addRelated`. **Critical verification tests (do these FIRST, before writing more code):** (1) Test `Zotero.Translate.Search()` with a known DOI — if it fails, confirm the manual metadata fallback works; (2) Create a test annotation via the plugin while a PDF is open in Zotero's reader — verify it appears live without reopening the PDF. If auto-refresh doesn't work, investigate `Zotero.Notifier.trigger('refresh', 'item', [id])`. These two tests de-risk Day 4's "wow features." Test voice conversation about a selected paper. **Deliverable:** Select paper from Zotero → voice conversation about its content; plugin installed with basic write endpoints working; both verification tests passing.

**Day 4 — Annotations + paper discovery (the "wow" features).** Implement `createAnnotation` endpoint with coordinate mapping (Gemini 0-1000 → PDF points). Integrate Gemini bounding box output via `annotate_zotero_pdf` tool. Send page images for vision context. Add OpenAlex search integration (`search_academic_papers`, `get_paper_recommendations`). Implement `addPaper` endpoint with DOI lookup. Build text chat mode. **Deliverable:** Live annotation appearing in Zotero during conversation; paper discovery and addition working.

**Day 5 — Library management + polish.** Add collection management endpoints (`createCollection`, `addToCollection`). Enable Google Search grounding. Build unified chat UI with voice/text toggle. Implement proactive tag/collection suggestions in system prompt. Error handling (Zotero offline, connection drops, invalid coordinates). **Deliverable:** Feature-complete app with library management.

**Day 6 — Demo preparation.** End-to-end testing with diverse papers (use your HERA papers for authentic demo). Prepare demo script in this order — **the sequence is designed to build to a crescendo:**

1. **Warm-up (lobby mode):** Open Colloquia, ask "What's in my HERA collection?" — shows library browsing
2. **Enter paper mode:** Select a paper from the list, show the context loading
3. **Voice Q&A:** Ask about the methodology — shows real-time paper understanding + web search grounding
4. **Library management (quick):** "Tag this as 'signal-loss-analysis' and put it in my thesis collection" — shows Zotero write-back
5. **Paper discovery:** Agent notices a cited paper, searches OpenAlex, offers to add it → user confirms → paper appears in Zotero
6. **THE CLOSER — live annotation:** "What's happening in Figure 3?" → agent describes the figure → purple annotation appears live around the figure in Zotero's PDF reader while the agent is still talking. **This is the moment judges remember. End on this.**

Record backup video. Write README with: BYOK setup instructions (how to get a Gemini API key, expected costs per conversation), architecture overview, local development quickstart (`git clone` → `npm install` → `npm run dev`), Chrome-only note for audio. Add LICENSE files (Apache 2.0 for frontend/backend, AGPL 3.0 for Zotero plugin). Final deploy and smoke test. **Deliverable:** Demo-ready, open-source application.

**Priority tiers:**
- **MVP (must have for demo):** voice conversation + paper browsing + text chat + paper context injection
- **High impact (target for demo):** live PDF annotations + paper discovery + basic tag management
- **Nice to have:** full library management, bulk operations, conversation summaries as notes, figure-click mode

---

## Conclusion: key architectural bets and novel insights

Five non-obvious decisions emerged from this research that significantly shape the project:

**Raw genai SDK over ADK is the right call for BYOK.** ADK's `run_live()` would save ~2 days of tool orchestration boilerplate, but its Python client can't inject per-session API keys (confirmed issue #2560). For a BYOK app where every user brings their own key, `genai.Client(api_key=...)` per WebSocket session is the only clean, concurrent-safe approach. The ~300 lines of manual tool orchestration pay for themselves in debuggability — when something breaks during the hackathon, you see the raw WebSocket messages instead of digging through ADK's `Runner → LLMFlow → GeminiLlmConnection` stack.

**The Zotero fulltext endpoint is an underappreciated shortcut.** Rather than downloading PDFs and running extraction libraries, Zotero 7.1's `/fulltext` endpoint returns pre-indexed text instantly. Since Zotero has already parsed the PDF when the user added it to their library, this eliminates an entire processing step and its associated dependencies. Only use PDF-to-image conversion for papers where figures are essential to the discussion.

**Live annotation is the killer demo feature.** The combination of Gemini's bounding box spatial understanding (0-1000 normalized coordinates) and Zotero's auto-refreshing PDF reader creates a uniquely compelling demo. When the agent discusses Figure 3 and a purple annotation simultaneously appears around that figure in Zotero's reader — that's the moment judges remember. Prioritize this feature.

**The Zotero plugin is a thin write proxy, not an application.** Keep the plugin minimal — it's just an HTTP-to-JS-API bridge. All intelligence stays in the Gemini agent. The plugin accepts structured JSON and executes Zotero API calls. This keeps the plugin simple (buildable in a few hours), maintainable, and focused.

**BYOK makes open source sustainable.** By having users bring their own Gemini API key, the project has zero ongoing hosting costs beyond a Cloud Run instance (which can be scaled to zero). No user accounts, no billing infrastructure, no API key management. Anyone can fork the repo, run it locally in 5 minutes, or deploy their own instance. This is the right model for a research tool.

---

## Repository structure

```
colloquia/
├── frontend/                     # Vite + React + TypeScript
│   ├── src/
│   │   ├── components/           # Paper browser, chat UI, audio controls, settings
│   │   ├── hooks/                # useZoteroHealth, useAudioStream, useWebSocket
│   │   ├── lib/                  # Audio worklet, WebSocket protocol types
│   │   └── App.tsx
│   ├── vite.config.ts            # Zotero proxy config
│   └── package.json
├── backend/                      # Python FastAPI + google-genai SDK
│   ├── main.py                   # FastAPI app, WebSocket handler, BYOK key flow
│   ├── session_handler.py        # Tool orchestration loop, audio forwarding
│   ├── tools/
│   │   ├── openalex.py   # Paper search integration
│   │   ├── zotero_proxy.py       # Zotero action relay (backend → frontend → plugin)
│   │   └── pdf_processing.py     # Page image rendering, coordinate mapping, fulltext quality check
│   ├── prompts/
│   │   ├── lobby.py              # Lobby mode system prompt
│   │   └── paper.py              # Paper mode system prompt (template)
│   ├── Dockerfile
│   └── requirements.txt
├── zotero-colloquia-plugin/      # Zotero 7 plugin (TypeScript)
│   ├── src/
│   │   ├── index.ts
│   │   ├── hooks.ts
│   │   └── modules/
│   │       ├── endpoints.ts      # HTTP endpoint registration
│   │       ├── annotations.ts    # PDF annotation creation
│   │       ├── notes.ts          # Note management
│   │       ├── tags.ts           # Tag operations
│   │       ├── collections.ts    # Collection management
│   │       └── papers.ts         # Paper import (DOI lookup)
│   ├── addon/manifest.json
│   └── package.json
├── LICENSE                       # Apache 2.0
├── README.md                     # Setup guide, BYOK instructions, architecture overview
└── .github/
    └── workflows/
        └── build-plugin.yml      # CI to build .xpi on release
```

### Licensing

- **Colloquia frontend + backend:** Apache 2.0
- **Zotero Colloquia plugin:** AGPL 3.0 (matching Zotero's own license — plugins that interact with Zotero's internal API should use a compatible copyleft license)
- **Dependencies:** `google-genai` SDK is Apache 2.0, zotero-plugin-template is AGPL 3.0, OpenAlex API is free for non-commercial and commercial use