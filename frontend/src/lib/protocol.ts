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

/** Request to create a new persistent chat */
export interface NewChatMessage {
  type: "new_chat";
  chatType: "voice" | "text";
}

/** Request to load a persistent chat */
export interface LoadChatMessage {
  type: "load_chat";
  chatId: string;
}

/** Request to list all chats */
export interface ListChatsMessage {
  type: "list_chats";
}

/** Request to rename a chat */
export interface RenameChatMessage {
  type: "rename_chat";
  chatId: string;
  title: string;
}

/** Request to delete a chat */
export interface DeleteChatMessage {
  type: "delete_chat";
  chatId: string;
}

export type ClientMessage =
  | ConfigMessage
  | AudioMessage
  | TextMessage
  | PaperContextMessage
  | ZoteroActionResultMessage
  | ControlMessage
  | ModelSwitchMessage
  | ChatModeSwitchMessage
  | NewChatMessage
  | LoadChatMessage
  | ListChatsMessage
  | RenameChatMessage
  | DeleteChatMessage;

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

// ------------------------------------------------------------
// Chat persistence messages (server -> frontend)
// ------------------------------------------------------------

export interface ChatSummary {
  id: string;
  title: string;
  chat_type: "voice" | "text";
  created_at: string;
  updated_at: string;
  message_count: number;
}

export interface SavedChatMessage {
  id: number;
  role: "user" | "model" | "system";
  content: string;
  session_mode: string;
  timestamp: string;
  model_used?: string;
  tool_calls?: Record<string, unknown>[];
  thinking?: string;
}

export interface ChatCreatedMessage {
  type: "chat_created";
  chatId: string;
  chatType: "voice" | "text";
}

export interface ChatLoadedMessage {
  type: "chat_loaded";
  chatId: string;
  chat: ChatSummary;
  messages: SavedChatMessage[];
}

export interface ChatListMessage {
  type: "chat_list";
  chats: ChatSummary[];
}

export interface ChatTitleUpdatedMessage {
  type: "chat_title_updated";
  chatId: string;
  title: string;
}

export interface ChatRenamedMessage {
  type: "chat_renamed";
  chatId: string;
  title: string;
  success: boolean;
}

export interface ChatDeletedMessage {
  type: "chat_deleted";
  chatId: string;
  success: boolean;
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
  | MediaGeneratingMessage
  | ChatCreatedMessage
  | ChatLoadedMessage
  | ChatListMessage
  | ChatTitleUpdatedMessage
  | ChatRenamedMessage
  | ChatDeletedMessage;
