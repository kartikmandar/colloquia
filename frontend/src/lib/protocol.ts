// ============================================================
// WebSocket Protocol Type Definitions
// Colloquia — Voice-powered AI Research Assistant
// ============================================================

// ------------------------------------------------------------
// Supporting types
// ------------------------------------------------------------

export interface PaperMetadata {
  key: string;
  title: string;
  authors: string[];
  year: number;
  doi?: string;
  abstract?: string;
  journal?: string;
  tags: string[];
  collections: string[];
}

export interface PaperAnnotation {
  key: string;
  type: "highlight" | "note" | "image";
  comment?: string;
  text?: string;
  pageLabel?: string;
  color?: string;
}

export interface PageImage {
  pageIndex: number;
  data: string; // base64 JPEG
  width: number;
  height: number;
}

// ------------------------------------------------------------
// Client messages (frontend -> backend)
// Discriminated union on `type`
// ------------------------------------------------------------

/** First message sent after WebSocket opens */
export interface ConfigMessage {
  type: "config";
  gemini_api_key: string;
  s2_api_key?: string; // Semantic Scholar (optional)
}

/** Audio chunk from microphone */
export interface AudioMessage {
  type: "audio";
  data: string; // base64-encoded PCM16 audio
}

/** Text chat input */
export interface TextMessage {
  type: "text";
  content: string;
}

/** Paper context loading payload */
export interface PaperContextMessage {
  type: "paper_context";
  paperKey: string;
  fulltext: string;
  metadata: PaperMetadata;
  annotations: PaperAnnotation[];
  pageImages?: PageImage[]; // base64 JPEG page renders
}

/** Response from Zotero plugin operation (frontend -> backend) */
export interface ZoteroActionResultMessage {
  type: "zotero_action_result";
  requestId: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

/** Control messages */
export interface ControlMessage {
  type: "control";
  action: "start" | "stop" | "switch_mode";
  mode?: "lobby" | "paper";
}

export type ClientMessage =
  | ConfigMessage
  | AudioMessage
  | TextMessage
  | PaperContextMessage
  | ZoteroActionResultMessage
  | ControlMessage;

// ------------------------------------------------------------
// Server messages (backend -> frontend)
// Discriminated union on `type`
// ------------------------------------------------------------

/** Audio response chunk */
export interface ServerAudioMessage {
  type: "audio";
  data: string; // base64-encoded PCM16 audio
}

/** Transcript (voice mode) */
export interface TranscriptMessage {
  type: "transcript";
  role: "user" | "model";
  text: string;
  isFinal: boolean;
}

/** Signal that text generation has started (show typing indicator) */
export interface TextResponseStartMessage {
  type: "text_response_start";
}

/** Streaming text chunk */
export interface TextResponseChunkMessage {
  type: "text_response_chunk";
  content: string;
  model?: string;
}

/** Signal that text generation is complete */
export interface TextResponseDoneMessage {
  type: "text_response_done";
  model?: string;
}

/** @deprecated Full text response (kept for backwards compat) */
export interface TextResponseMessage {
  type: "text_response";
  content: string;
  model?: string;
}

/** Zotero write command (backend -> frontend to execute locally) */
export interface ZoteroActionMessage {
  type: "zotero_action";
  requestId: string;
  action: string; // endpoint name, e.g., "createNote"
  params: Record<string, unknown>;
}

/** Tool call lifecycle */
export interface ToolCallMessage {
  type: "tool_call";
  toolName: string;
  status: "calling" | "done" | "error";
  input?: Record<string, unknown>;
  output?: unknown;
  error?: string;
  durationMs?: number;
}

/** Pro model reasoning trace */
export interface ThinkingMessage {
  type: "thinking";
  content: string;
}

/** Context window usage */
export interface ContextUsageMessage {
  type: "context_usage";
  totalTokens: number;
  maxTokens: number; // 128000
}

/** Error message */
export interface ErrorMessage {
  type: "error";
  message: string;
  code?: string;
}

/** Session status */
export interface SessionStatusMessage {
  type: "session_status";
  status: "connected" | "reconnecting" | "ended";
}

export type ServerMessage =
  | ServerAudioMessage
  | TranscriptMessage
  | TextResponseStartMessage
  | TextResponseChunkMessage
  | TextResponseDoneMessage
  | TextResponseMessage
  | ZoteroActionMessage
  | ToolCallMessage
  | ThinkingMessage
  | ContextUsageMessage
  | ErrorMessage
  | SessionStatusMessage;
