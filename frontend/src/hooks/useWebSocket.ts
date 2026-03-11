/**
 * useWebSocket — manages the WebSocket connection to the Colloquia backend.
 *
 * Handles all ServerMessage types, provides methods for sending client messages,
 * and implements reconnection with exponential backoff + URL failover.
 */

import { useState, useRef, useCallback, useEffect } from "react";
import toast from "react-hot-toast";
import { getGeminiKey, getS2Key } from "../lib/apiKeys";
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
} from "../lib/protocol";

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
}

interface UseWebSocketOptions {
  url: string;
  onAudioData?: (base64Pcm: string) => void;
  onInterrupted?: () => void;
  autoConnect?: boolean;
}

interface UseWebSocketReturn {
  status: ConnectionStatus;
  messages: ChatMessage[];
  contextUsage: ContextUsageMessage | null;
  activeUrl: string;
  connect: () => void;
  disconnect: () => void;
  sendAudio: (base64Pcm: string) => void;
  sendText: (content: string) => void;
  sendPaperContext: (payload: Record<string, unknown>) => void;
  sendControl: (action: string, mode?: string) => void;
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
}: UseWebSocketOptions): UseWebSocketReturn {
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [contextUsage, setContextUsage] = useState<ContextUsageMessage | null>(
    null,
  );
  const [activeUrl, setActiveUrl] = useState<string>(url);

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
              deep_analysis: "Advanced analysis unavailable",
              search_zotero_library: "Zotero search failed",
            };
            const friendlyMsg: string =
              errorMessages[tc.toolName] || `Tool failed: ${tc.toolName}`;
            toast.error(tc.error ? `${friendlyMsg}: ${tc.error}` : friendlyMsg);
          }
          setMessages((prev: ChatMessage[]) => {
            const updated: ChatMessage[] = [...prev];
            const lastModel: ChatMessage | undefined = [...updated]
              .reverse()
              .find((m: ChatMessage) => m.role === "model");
            if (lastModel) {
              lastModel.toolCalls = [...(lastModel.toolCalls ?? []), tc];
            }
            return updated;
          });
          break;
        }

        case "thinking": {
          const th: ThinkingMessage = data;
          setMessages((prev: ChatMessage[]) => {
            const updated: ChatMessage[] = [...prev];
            const lastModel: ChatMessage | undefined = [...updated]
              .reverse()
              .find((m: ChatMessage) => m.role === "model");
            if (lastModel) {
              lastModel.thinking = {
                content: th.content,
                durationMs: lastModel.thinking?.durationMs,
              };
            }
            return updated;
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
      }
    },
    [onAudioData, onInterrupted, addMessage, handleZoteroAction],
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
        const s2Key: string | null = getS2Key();
        if (s2Key) {
          configMsg.s2_api_key = s2Key;
        }
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

  return {
    status,
    messages,
    contextUsage,
    activeUrl,
    connect,
    disconnect,
    sendAudio,
    sendText,
    sendPaperContext,
    sendControl,
  };
}
