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

/** Request to switch the active model */
export interface ModelSwitchMessage {
  type: "model_switch";
  modelId: string;
  mode: "voice" | "text";
  transcriptContext?: string[];
}

/** Request to switch between voice and text chat modes (clears history) */
export interface ChatModeSwitchMessage {
  type: "chat_mode_switch";
  mode: "voice" | "text";
}

export type ClientMessage =
  | ConfigMessage
  | AudioMessage
  | TextMessage
  | PaperContextMessage
  | ZoteroActionResultMessage
  | ControlMessage
  | ModelSwitchMessage
  | ChatModeSwitchMessage;

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

/** Barge-in: model output was interrupted by user speech */
export interface InterruptedMessage {
  type: "interrupted";
}

// ------------------------------------------------------------
// Model switching & multimodal output
// ------------------------------------------------------------

export interface ModelCapabilitiesInfo {
  supportsLiveApi: boolean;
  supportsText: boolean;
  supportsImageOutput: boolean;
  supportsVideoOutput: boolean;
  supportsAudioOutput: boolean;
  supportsThinking: boolean;
  supportsTools: boolean;
  description: string;
  category: string;
  apiPattern: string;
}

export interface ModelInfo {
  modelId: string;
  displayName: string;
  unstable?: boolean;
  deprecated?: boolean;
  capabilities: ModelCapabilitiesInfo;
}

/** Sent on connection — lists all available models */
export interface ModelListMessage {
  type: "model_list";
  voiceModels: ModelInfo[];
  textModels: ModelInfo[];
  imageGenModels: ModelInfo[];
  imagenModels: ModelInfo[];
  ttsModels: ModelInfo[];
  videoGenModels: ModelInfo[];
  openModels: ModelInfo[];
  researchModels: ModelInfo[];
  currentVoiceModel: string;
  currentTextModel: string;
}

/** Acknowledgement after a model switch request */
export interface ModelSwitchAckMessage {
  type: "model_switch_ack";
  modelId: string;
  mode: "voice" | "text";
  success: boolean;
  error?: string;
  warning?: string;
}

/** Inline image generated by the model */
export interface ImageResponseMessage {
  type: "image_response";
  data: string;
  mimeType: string;
  model?: string;
}

/** Inline video generated by the model */
export interface VideoResponseMessage {
  type: "video_response";
  data: string;
  mimeType: string;
  url?: string;
  model?: string;
}

/** Signals that media generation is in progress */
export interface MediaGeneratingMessage {
  type: "media_generating";
  mediaType: "image" | "video";
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
  | SessionStatusMessage
  | InterruptedMessage
  | ModelListMessage
  | ModelSwitchAckMessage
  | ImageResponseMessage
  | VideoResponseMessage
  | MediaGeneratingMessage;
