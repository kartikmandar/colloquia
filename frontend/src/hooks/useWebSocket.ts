/**
 * useWebSocket — manages the WebSocket connection to the Colloquia backend.
 *
 * Handles all ServerMessage types, provides methods for sending client messages,
 * and implements reconnection with exponential backoff + URL failover.
 */

import { useState, useRef, useCallback, useEffect } from "react";
import toast from "react-hot-toast";
import { getGeminiKey } from "../lib/apiKeys";
import { getFallbackUrl } from "../lib/backendUrl";
import type {
  ServerMessage,
  TranscriptMessage,
  TextResponseChunkMessage,
  TextResponseDoneMessage,
  ToolCallMessage,
  ThinkingMessage,
  ContextUsageMessage,
  SessionStatusMessage,
  ZoteroActionMessage,
  ModelListMessage,
  ModelSwitchAckMessage,
  ImageResponseMessage,
  VideoResponseMessage,
  MediaGeneratingMessage,
  ChatCreatedMessage,
  ChatLoadedMessage,
  ChatListMessage,
  ChatTitleUpdatedMessage,
  ChatSummary,
  SavedChatMessage,
} from "../lib/protocol";
import type { MediaPart } from "../components/MediaRenderer";

export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting";

export interface ChatMessage {
  id: string;
  role: "user" | "model";
  text: string;
  mode: "voice" | "text";
  timestamp: number;
  toolCalls?: ToolCallMessage[];
  thinking?: { content: string; durationMs?: number };
  model?: string;
  isStreaming?: boolean;
  media?: MediaPart[];
}

interface UseWebSocketOptions {
  url: string;
  onAudioData?: (base64Pcm: string) => void;
  onInterrupted?: () => void;
  autoConnect?: boolean;
  onChatCreated?: (chatId: string, chatType: "voice" | "text") => void;
  onChatLoaded?: (
    chatId: string,
    chat: ChatSummary,
    messages: SavedChatMessage[],
  ) => void;
  onChatList?: (chats: ChatSummary[]) => void;
  onChatTitleUpdated?: (chatId: string, title: string) => void;
}

interface UseWebSocketReturn {
  status: ConnectionStatus;
  messages: ChatMessage[];
  contextUsage: ContextUsageMessage | null;
  activeUrl: string;
  modelList: ModelListMessage | null;
  isModelSwitching: boolean;
  isTextGenerating: boolean;
  connect: () => void;
  disconnect: () => void;
  sendAudio: (base64Pcm: string) => void;
  sendText: (content: string) => void;
  stopTextGeneration: () => void;
  sendPaperContext: (payload: Record<string, unknown>) => void;
  sendControl: (action: string, mode?: string) => void;
  sendModelSwitch: (modelId: string, mode: "voice" | "text") => void;
  sendChatModeSwitch: (mode: "voice" | "text") => void;
  sendNewChat: (chatType: "voice" | "text") => void;
  sendLoadChat: (chatId: string) => void;
  sendListChats: () => void;
  sendRenameChat: (chatId: string, title: string) => void;
  sendDeleteChat: (chatId: string) => void;
  loadChatMessages: (savedMessages: SavedChatMessage[]) => void;
  clearMessages: () => void;
}

let messageIdCounter: number = 0;
function nextMessageId(): string {
  return `msg-${++messageIdCounter}-${Date.now()}`;
}

export function useWebSocket({
  url,
  onAudioData,
  onInterrupted,
  autoConnect = false,
  onChatCreated,
  onChatLoaded,
  onChatList,
  onChatTitleUpdated,
}: UseWebSocketOptions): UseWebSocketReturn {
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [contextUsage, setContextUsage] = useState<ContextUsageMessage | null>(
    null,
  );
  const [activeUrl, setActiveUrl] = useState<string>(url);
  const [modelList, setModelList] = useState<ModelListMessage | null>(null);
  const [isModelSwitching, setIsModelSwitching] = useState<boolean>(false);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef<number>(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intentionalCloseRef = useRef<boolean>(false);
  const currentUrlRef = useRef<string>(url);
  const triedFallbackRef = useRef<boolean>(false);
  const scheduleReconnectRef = useRef<() => void>(() => {});

  // Keep ref in sync with prop
  useEffect(() => {
    currentUrlRef.current = url;
    setActiveUrl(url);
  }, [url]);

  const addMessage = useCallback(
    (role: "user" | "model", text: string, mode: "voice" | "text"): void => {
      const msg: ChatMessage = {
        id: nextMessageId(),
        role,
        text,
        mode,
        timestamp: Date.now(),
      };
      setMessages((prev: ChatMessage[]) => [...prev, msg]);
    },
    [],
  );

  const sendZoteroActionResult = useCallback(
    (
      requestId: string,
      success: boolean,
      resultData?: unknown,
      error?: string,
    ): void => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        const msg: Record<string, unknown> = {
          type: "zotero_action_result",
          requestId,
          success,
        };
        if (success) {
          msg.data = resultData ?? {};
        } else {
          msg.error = error ?? "Unknown error";
        }
        wsRef.current.send(JSON.stringify(msg));
      }
    },
    [],
  );

  const handleZoteroAction = useCallback(
    async (action: ZoteroActionMessage): Promise<void> => {
      const { requestId, action: actionName, params } = action;
      const pluginUrl = `/zotero-plugin/colloquia/${actionName}`;

      try {
        const response: Response = await fetch(pluginUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params),
        });

        if (!response.ok) {
          const errorText: string = await response.text();
          sendZoteroActionResult(
            requestId,
            false,
            undefined,
            `Plugin error (${response.status}): ${errorText}`,
          );
          return;
        }

        const resultData: unknown = await response.json();
        sendZoteroActionResult(requestId, true, resultData);
      } catch (e: unknown) {
        const errorMsg: string =
          e instanceof TypeError && (e as TypeError).message.includes("fetch")
            ? "Zotero is not running or the Colloquia plugin is not installed"
            : e instanceof Error
              ? e.message
              : "Unknown error calling Zotero plugin";
        toast.error(errorMsg);
        sendZoteroActionResult(requestId, false, undefined, errorMsg);
      }
    },
    [sendZoteroActionResult],
  );

  /** Convert base64 string to Blob */
  const base64ToBlob = useCallback(
    (b64: string, mime: string): Blob => {
      const binaryStr: string = atob(b64);
      const bytes: Uint8Array = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      return new Blob([bytes.buffer as ArrayBuffer], { type: mime });
    },
    [],
  );

  /** Append a MediaPart to the last model message */
  const appendMediaToLastModel = useCallback(
    (media: MediaPart): void => {
      setMessages((prev: ChatMessage[]) => {
        // Find last model message, or create one
        let lastModelIdx: number = -1;
        for (let i: number = prev.length - 1; i >= 0; i--) {
          if (prev[i].role === "model") {
            lastModelIdx = i;
            break;
          }
        }
        if (lastModelIdx === -1) {
          // Create a new model message to hold the media
          return [
            ...prev,
            {
              id: nextMessageId(),
              role: "model",
              text: "",
              mode: "text",
              timestamp: Date.now(),
              media: [media],
            },
          ];
        }
        return prev.map((m: ChatMessage, i: number) => {
          if (i !== lastModelIdx) return m;
          const existing: MediaPart[] = m.media ?? [];
          // Replace generating placeholder if this is a real media part
          if (!media.isGenerating && existing.length > 0) {
            const genIdx: number = existing.findIndex(
              (mp) => mp.isGenerating && mp.type === media.type,
            );
            if (genIdx !== -1) {
              const updated: MediaPart[] = [...existing];
              updated[genIdx] = media;
              return { ...m, media: updated };
            }
          }
          return { ...m, media: [...existing, media] };
        });
      });
    },
    [],
  );

  const handleMessage = useCallback(
    (event: MessageEvent): void => {
      let data: ServerMessage;
      try {
        data = JSON.parse(event.data as string) as ServerMessage;
      } catch {
        return;
      }

      switch (data.type) {
        case "audio":
          onAudioData?.(data.data);
          break;

        case "interrupted":
          onInterrupted?.();
          break;

        case "transcript": {
          const t: TranscriptMessage = data;
          // Append to the last message of the same role instead of creating a new one
          setMessages((prev: ChatMessage[]) => {
            const last: ChatMessage | undefined = prev[prev.length - 1];
            if (last && last.role === t.role && last.mode === "voice") {
              const updated: ChatMessage[] = [...prev];
              updated[updated.length - 1] = {
                ...last,
                text: last.text + t.text,
              };
              return updated;
            }
            return [
              ...prev,
              {
                id: nextMessageId(),
                role: t.role,
                text: t.text,
                mode: "voice",
                timestamp: Date.now(),
              },
            ];
          });
          break;
        }

        case "text_response_start": {
          // Add an empty model message as a typing placeholder
          const placeholderMsg: ChatMessage = {
            id: nextMessageId(),
            role: "model",
            text: "",
            mode: "text",
            timestamp: Date.now(),
            isStreaming: true,
          };
          setMessages((prev: ChatMessage[]) => [...prev, placeholderMsg]);
          break;
        }

        case "text_response_chunk": {
          const chunk: TextResponseChunkMessage = data;
          setMessages((prev: ChatMessage[]) => {
            const updated: ChatMessage[] = [...prev];
            const last: ChatMessage | undefined = updated[updated.length - 1];
            if (last && last.role === "model" && last.isStreaming) {
              updated[updated.length - 1] = {
                ...last,
                text: last.text + chunk.content,
                model: chunk.model ?? last.model,
              };
            }
            return updated;
          });
          break;
        }

        case "text_response_done": {
          const done: TextResponseDoneMessage = data;
          setMessages((prev: ChatMessage[]) => {
            const updated: ChatMessage[] = [...prev];
            const last: ChatMessage | undefined = updated[updated.length - 1];
            if (last && last.role === "model" && last.isStreaming) {
              updated[updated.length - 1] = {
                ...last,
                isStreaming: false,
                model: done.model ?? last.model,
              };
            }
            return updated;
          });
          break;
        }

        case "text_response": {
          // Legacy non-streaming fallback
          addMessage("model", data.content, "text");
          break;
        }

        case "tool_call": {
          const tc: ToolCallMessage = data;
          // Show toast for tool errors
          if (tc.status === "error") {
            const errorMessages: Record<string, string> = {
              search_academic_papers: "Paper search unavailable",
              get_paper_recommendations: "Paper recommendations unavailable",
              annotate_zotero_pdf: "Annotation placement failed",
              search_zotero_library: "Zotero search failed",
            };
            const friendlyMsg: string =
              errorMessages[tc.toolName] || `Tool failed: ${tc.toolName}`;
            toast.error(tc.error ? `${friendlyMsg}: ${tc.error}` : friendlyMsg);
          }
          setMessages((prev: ChatMessage[]) => {
            let lastModelIdx: number = -1;
            for (let i: number = prev.length - 1; i >= 0; i--) {
              if (prev[i].role === "model") { lastModelIdx = i; break; }
            }
            if (lastModelIdx === -1) return prev;
            return prev.map((m: ChatMessage, i: number) => {
              if (i !== lastModelIdx) return m;
              const existing: ToolCallMessage[] = m.toolCalls ?? [];
              // If this is a status update (done/error) for an existing
              // "calling" badge, merge into that entry instead of appending.
              if (tc.status !== "calling") {
                const callingIdx: number = existing.findIndex(
                  (t: ToolCallMessage) =>
                    t.toolName === tc.toolName && t.status === "calling",
                );
                if (callingIdx !== -1) {
                  const merged: ToolCallMessage[] = [...existing];
                  merged[callingIdx] = { ...existing[callingIdx], ...tc };
                  return { ...m, toolCalls: merged };
                }
              }
              return { ...m, toolCalls: [...existing, tc] };
            });
          });
          break;
        }

        case "thinking": {
          const th: ThinkingMessage = data;
          setMessages((prev: ChatMessage[]) => {
            let lastModelIdx: number = -1;
            for (let i: number = prev.length - 1; i >= 0; i--) {
              if (prev[i].role === "model") { lastModelIdx = i; break; }
            }
            if (lastModelIdx === -1) return prev;
            return prev.map((m: ChatMessage, i: number) =>
              i === lastModelIdx
                ? {
                    ...m,
                    thinking: {
                      content: th.content,
                      durationMs: m.thinking?.durationMs,
                    },
                  }
                : m,
            );
          });
          break;
        }

        case "zotero_action": {
          const za: ZoteroActionMessage = data;
          handleZoteroAction(za);
          break;
        }

        case "context_usage":
          setContextUsage(data);
          break;

        case "error":
          toast.error(data.message || "An error occurred");
          // Clear any in-progress streaming state
          setMessages((prev: ChatMessage[]) => {
            const updated: ChatMessage[] = [...prev];
            const last: ChatMessage | undefined = updated[updated.length - 1];
            if (last && last.role === "model" && last.isStreaming) {
              updated[updated.length - 1] = { ...last, isStreaming: false };
            }
            return updated;
          });
          addMessage("model", `Error: ${data.message}`, "text");
          break;

        case "session_status": {
          const ss: SessionStatusMessage = data;
          if (ss.status === "connected") {
            setStatus("connected");
          } else if (ss.status === "reconnecting") {
            setStatus("reconnecting");
          } else if (ss.status === "ended") {
            setStatus("disconnected");
          }
          break;
        }

        case "model_list": {
          const ml = data as ModelListMessage;
          setModelList(ml);
          break;
        }

        case "model_switch_ack": {
          const ack = data as ModelSwitchAckMessage;
          setIsModelSwitching(false);
          if (ack.success) {
            // Update the modelList's current model
            setModelList((prev) => {
              if (!prev) return prev;
              if (ack.mode === "voice") {
                return { ...prev, currentVoiceModel: ack.modelId };
              }
              return { ...prev, currentTextModel: ack.modelId };
            });
            if (ack.warning) {
              toast(ack.warning, { duration: 5000 });
            }
          } else {
            toast.error(ack.error || "Model switch failed");
          }
          break;
        }

        case "image_response": {
          const img = data as ImageResponseMessage;
          const blob: Blob = base64ToBlob(img.data, img.mimeType);
          const objectUrl: string = URL.createObjectURL(blob);
          const mediaPart: MediaPart = {
            id: `media-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            type: "image",
            mimeType: img.mimeType,
            objectUrl,
          };
          appendMediaToLastModel(mediaPart);
          break;
        }

        case "video_response": {
          const vid = data as VideoResponseMessage;
          const vidBlob: Blob = base64ToBlob(vid.data, vid.mimeType);
          const vidUrl: string = URL.createObjectURL(vidBlob);
          const vidPart: MediaPart = {
            id: `media-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            type: "video",
            mimeType: vid.mimeType,
            objectUrl: vidUrl,
          };
          appendMediaToLastModel(vidPart);
          break;
        }

        case "media_generating": {
          const mg = data as MediaGeneratingMessage;
          const placeholder: MediaPart = {
            id: `media-gen-${Date.now()}`,
            type: mg.mediaType,
            mimeType: "",
            objectUrl: "",
            isGenerating: true,
          };
          appendMediaToLastModel(placeholder);
          break;
        }

        case "chat_created": {
          const cc = data as ChatCreatedMessage;
          onChatCreated?.(cc.chatId, cc.chatType);
          break;
        }

        case "chat_loaded": {
          const cl = data as ChatLoadedMessage;
          onChatLoaded?.(cl.chatId, cl.chat, cl.messages);
          break;
        }

        case "chat_list": {
          const clist = data as ChatListMessage;
          onChatList?.(clist.chats);
          break;
        }

        case "chat_title_updated": {
          const ctu = data as ChatTitleUpdatedMessage;
          onChatTitleUpdated?.(ctu.chatId, ctu.title);
          // Trigger ChatHistory refresh if mounted
          const refreshFn = (
            window as unknown as Record<string, (() => Promise<void>) | undefined>
          ).__chatHistoryRefresh;
          if (refreshFn) refreshFn();
          break;
        }

        case "chat_renamed":
        case "chat_deleted":
          // These are ack messages; ChatHistory handles via REST
          break;
      }
    },
    [
      onAudioData,
      onInterrupted,
      addMessage,
      handleZoteroAction,
      onChatCreated,
      onChatLoaded,
      onChatList,
      onChatTitleUpdated,
    ],
  );

  const connectToUrl = useCallback(
    (targetUrl: string): void => {
      if (wsRef.current?.readyState === WebSocket.OPEN) return;

      intentionalCloseRef.current = false;
      setStatus("connecting");
      setActiveUrl(targetUrl);
      currentUrlRef.current = targetUrl;

      const ws: WebSocket = new WebSocket(targetUrl);
      wsRef.current = ws;

      ws.onopen = (): void => {
        // Guard: ignore if this socket was replaced (e.g. StrictMode double-mount)
        if (wsRef.current !== ws) return;

        reconnectAttemptRef.current = 0;
        triedFallbackRef.current = false;

        const geminiKey: string | null = getGeminiKey();
        if (!geminiKey) {
          ws.close();
          setStatus("disconnected");
          return;
        }

        const configMsg: Record<string, unknown> = {
          type: "config",
          gemini_api_key: geminiKey,
        };
        ws.send(JSON.stringify(configMsg));
      };

      ws.onmessage = (event: MessageEvent): void => {
        // Guard: ignore messages from stale sockets
        if (wsRef.current !== ws) return;
        handleMessage(event);
      };

      ws.onclose = (): void => {
        // Guard: ignore close from stale sockets (prevents StrictMode cascade)
        if (wsRef.current !== ws) return;
        wsRef.current = null;
        if (!intentionalCloseRef.current) {
          setStatus("reconnecting");
          scheduleReconnectRef.current();
        } else {
          setStatus("disconnected");
        }
      };

      ws.onerror = (): void => {
        // onclose will fire after onerror
      };
    },
    [handleMessage],
  );

  const scheduleReconnect = useCallback((): void => {
    const attempt: number = reconnectAttemptRef.current;

    // After 2 failed attempts on current URL, try the fallback
    if (attempt === 2 && !triedFallbackRef.current) {
      triedFallbackRef.current = true;
      reconnectAttemptRef.current = 0;
      const fallback: string = getFallbackUrl(currentUrlRef.current);
      reconnectTimerRef.current = setTimeout(() => {
        connectToUrl(fallback);
      }, 500);
      return;
    }

    if (attempt >= 5) {
      setStatus("disconnected");
      return;
    }

    const delay: number = Math.min(1000 * Math.pow(2, attempt), 16000);
    reconnectAttemptRef.current = attempt + 1;

    reconnectTimerRef.current = setTimeout(() => {
      connectToUrl(currentUrlRef.current);
    }, delay);
  }, [connectToUrl]);

  // Keep ref in sync so connectToUrl can call scheduleReconnect without a circular dep
  scheduleReconnectRef.current = scheduleReconnect;

  const connect = useCallback((): void => {
    triedFallbackRef.current = false;
    reconnectAttemptRef.current = 0;
    connectToUrl(currentUrlRef.current);
  }, [connectToUrl]);

  const disconnect = useCallback((): void => {
    intentionalCloseRef.current = true;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    wsRef.current?.close();
    wsRef.current = null;
    setStatus("disconnected");
  }, []);

  const sendRaw = useCallback((data: Record<string, unknown>): void => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  const sendAudio = useCallback(
    (base64Pcm: string): void => {
      sendRaw({ type: "audio", data: base64Pcm });
    },
    [sendRaw],
  );

  const sendText = useCallback(
    (content: string): void => {
      addMessage("user", content, "text");
      sendRaw({ type: "text", content });
    },
    [sendRaw, addMessage],
  );

  const stopTextGeneration = useCallback((): void => {
    sendRaw({ type: "stop_text_generation" });
    // Immediately mark the streaming message as done on frontend
    setMessages((prev: ChatMessage[]) => {
      const updated: ChatMessage[] = [...prev];
      const last: ChatMessage | undefined = updated[updated.length - 1];
      if (last && last.role === "model" && last.isStreaming) {
        updated[updated.length - 1] = { ...last, isStreaming: false };
      }
      return updated;
    });
  }, [sendRaw]);

  const isTextGenerating: boolean = messages.some(
    (m: ChatMessage) => m.role === "model" && m.isStreaming === true,
  );

  const sendPaperContext = useCallback(
    (payload: Record<string, unknown>): void => {
      sendRaw({ type: "paper_context", ...payload });
    },
    [sendRaw],
  );

  const sendControl = useCallback(
    (action: string, mode?: string): void => {
      const msg: Record<string, unknown> = { type: "control", action };
      if (mode) msg.mode = mode;
      sendRaw(msg);
    },
    [sendRaw],
  );

  const sendChatModeSwitch = useCallback(
    (mode: "voice" | "text"): void => {
      sendRaw({ type: "chat_mode_switch", mode });
    },
    [sendRaw],
  );

  const sendNewChat = useCallback(
    (chatType: "voice" | "text"): void => {
      sendRaw({ type: "new_chat", chatType });
    },
    [sendRaw],
  );

  const sendLoadChat = useCallback(
    (chatId: string): void => {
      sendRaw({ type: "load_chat", chatId });
    },
    [sendRaw],
  );

  const sendListChats = useCallback((): void => {
    sendRaw({ type: "list_chats" });
  }, [sendRaw]);

  const sendRenameChat = useCallback(
    (chatId: string, title: string): void => {
      sendRaw({ type: "rename_chat", chatId, title });
    },
    [sendRaw],
  );

  const sendDeleteChat = useCallback(
    (chatId: string): void => {
      sendRaw({ type: "delete_chat", chatId });
    },
    [sendRaw],
  );

  const loadChatMessages = useCallback(
    (savedMessages: SavedChatMessage[]): void => {
      const converted: ChatMessage[] = savedMessages
        .filter((m: SavedChatMessage) => m.content)
        .map((m: SavedChatMessage) => ({
          id: `saved-${m.id}`,
          role: m.role === "system" ? ("model" as const) : (m.role as "user" | "model"),
          text: m.content,
          mode: "text" as const,
          timestamp: new Date(m.timestamp).getTime(),
          model: m.model_used ?? undefined,
        }));
      setMessages(converted);
    },
    [],
  );

  const clearMessages = useCallback((): void => {
    setMessages([]);
  }, []);

  const sendModelSwitch = useCallback(
    (modelId: string, mode: "voice" | "text"): void => {
      setIsModelSwitching(true);
      const msg: Record<string, unknown> = {
        type: "model_switch",
        modelId,
        mode,
      };
      // For voice switches, include recent transcript context
      if (mode === "voice") {
        const recentTranscripts: string[] = messages
          .filter((m) => m.mode === "voice")
          .slice(-10)
          .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.text}`);
        if (recentTranscripts.length > 0) {
          msg.transcriptContext = recentTranscripts;
        }
      }
      sendRaw(msg);
    },
    [sendRaw, messages],
  );

  useEffect(() => {
    if (autoConnect) {
      connect();
    }
    return (): void => {
      intentionalCloseRef.current = true;
      wsRef.current?.close();
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cleanup media blob URLs when messages change (revoke old ones)
  const prevMediaUrlsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const currentUrls: Set<string> = new Set<string>();
    for (const msg of messages) {
      if (msg.media) {
        for (const m of msg.media) {
          if (m.objectUrl) currentUrls.add(m.objectUrl);
        }
      }
    }
    // Revoke URLs that are no longer in messages
    for (const url of prevMediaUrlsRef.current) {
      if (!currentUrls.has(url)) {
        URL.revokeObjectURL(url);
      }
    }
    prevMediaUrlsRef.current = currentUrls;
  }, [messages]);

  return {
    status,
    messages,
    contextUsage,
    activeUrl,
    modelList,
    isModelSwitching,
    isTextGenerating,
    connect,
    disconnect,
    sendAudio,
    sendText,
    stopTextGeneration,
    sendPaperContext,
    sendControl,
    sendModelSwitch,
    sendChatModeSwitch,
    sendNewChat,
    sendLoadChat,
    sendListChats,
    sendRenameChat,
    sendDeleteChat,
    loadChatMessages,
    clearMessages,
  };
}
