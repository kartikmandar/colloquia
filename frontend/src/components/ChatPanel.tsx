/**
 * ChatPanel — displays conversation messages and provides text input.
 */

import { useState, useRef, useEffect } from "react";
import type { ChatMessage } from "../hooks/useWebSocket";
import ToolCallBadge from "./ToolCallBadge";
import ThinkingStep from "./ThinkingStep";
import MarkdownRenderer from "./MarkdownRenderer";
import MediaRenderer, { ImageLightbox } from "./MediaRenderer";
import type { MediaPart } from "./MediaRenderer";

function formatRelativeTime(timestamp: number): string {
  const seconds: number = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes: number = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours: number = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(timestamp).toLocaleDateString();
}

function shouldGroup(
  current: ChatMessage,
  previous: ChatMessage | undefined,
): boolean {
  if (!previous) return false;
  return (
    current.role === previous.role &&
    current.timestamp - previous.timestamp < 60000
  );
}

interface ChatPanelProps {
  messages: ChatMessage[];
  onSendText: (text: string) => void;
  onStopGeneration: () => void;
  isConnected: boolean;
  isTextGenerating?: boolean;
  showTextInput?: boolean;
}

function ChatPanel({
  messages,
  onSendText,
  onStopGeneration,
  isConnected,
  isTextGenerating = false,
  showTextInput = true,
}: ChatPanelProps): React.ReactElement {
  const [inputText, setInputText] = useState<string>("");
  const [expandedMedia, setExpandedMedia] = useState<MediaPart | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    const trimmed: string = inputText.trim();
    if (!trimmed || !isConnected) return;
    onSendText(trimmed);
    setInputText("");
  };

  return (
    <div className="flex h-full flex-col">
      {/* Messages area */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-3 space-y-2"
      >
        {messages.length === 0 && (
          <div className="flex h-full items-center justify-center text-sm text-text-tertiary">
            Start a conversation using voice or text
          </div>
        )}
        {messages.map((msg: ChatMessage, index: number) => {
          const grouped: boolean = shouldGroup(msg, messages[index - 1]);
          return (
            <div
              key={msg.id}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"} ${grouped ? "mt-0.5" : ""}`}
            >
              <div
                className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                  msg.role === "user"
                    ? "bg-accent-primary text-white"
                    : "bg-surface-tertiary text-text-primary"
                }`}
              >
                {!grouped && (
                  <div className="flex items-center gap-1.5 mb-0.5">
                    {msg.mode === "voice" ? (
                      <svg
                        className={`h-3 w-3 ${msg.role === "user" ? "text-blue-200" : "text-text-tertiary"}`}
                        viewBox="0 0 20 20"
                        fill="currentColor"
                      >
                        <path
                          fillRule="evenodd"
                          d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z"
                          clipRule="evenodd"
                        />
                      </svg>
                    ) : (
                      <svg
                        className={`h-3 w-3 ${msg.role === "user" ? "text-blue-200" : "text-text-tertiary"}`}
                        viewBox="0 0 20 20"
                        fill="currentColor"
                      >
                        <path
                          fillRule="evenodd"
                          d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zm-4 0H9v2h2V9z"
                          clipRule="evenodd"
                        />
                      </svg>
                    )}
                    <span
                      className={`text-xs font-medium ${msg.role === "user" ? "text-blue-200" : "text-text-tertiary"}`}
                    >
                      {msg.role === "user" ? "You" : "Colloquia"}
                    </span>
                    {msg.model && msg.role === "model" && (
                      <span className="text-xs font-mono text-text-tertiary">
                        {msg.model}
                      </span>
                    )}
                    <span
                      className={`ml-auto text-xs ${msg.role === "user" ? "text-blue-200" : "text-text-tertiary"}`}
                    >
                      {formatRelativeTime(msg.timestamp)}
                    </span>
                  </div>
                )}
                {msg.isStreaming && !msg.text ? (
                  <span className="inline-flex items-center gap-1 text-text-tertiary">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-text-tertiary [animation-delay:-0.3s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-text-tertiary [animation-delay:-0.15s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-text-tertiary" />
                  </span>
                ) : msg.role === "model" ? (
                  <MarkdownRenderer content={msg.text} />
                ) : (
                  <p className="whitespace-pre-wrap">{msg.text}</p>
                )}
                {/* Thinking trace */}
                {msg.thinking && (
                  <ThinkingStep
                    content={msg.thinking.content}
                    durationMs={msg.thinking.durationMs}
                  />
                )}
                {/* Tool calls (collapsed/expandable) */}
                {msg.toolCalls && msg.toolCalls.length > 0 && (
                  <div className="mt-1.5 space-y-1">
                    {msg.toolCalls.map((tc, idx: number) => (
                      <ToolCallBadge
                        key={idx}
                        toolName={tc.toolName}
                        status={tc.status}
                        durationMs={tc.durationMs}
                        input={tc.input}
                        output={tc.output}
                        error={tc.error}
                      />
                    ))}
                  </div>
                )}
                {/* Inline media (images/videos) */}
                {msg.media && msg.media.length > 0 && (
                  <div className="mt-2 space-y-2">
                    {msg.media.map((m: MediaPart) => (
                      <MediaRenderer
                        key={m.id}
                        media={m}
                        onExpand={setExpandedMedia}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Text input */}
      {showTextInput && (
        <form
          onSubmit={handleSubmit}
          className="border-t border-border-primary p-3"
        >
          <div className="flex gap-2">
            <input
              type="text"
              value={inputText}
              onChange={(e: React.ChangeEvent<HTMLInputElement>): void =>
                setInputText(e.target.value)
              }
              placeholder={
                isConnected ? "Type a message..." : "Connect to start chatting"
              }
              disabled={!isConnected}
              className="flex-1 rounded-lg border border-border-primary bg-surface-primary px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-accent-primary focus:ring-1 focus:ring-accent-primary disabled:bg-surface-tertiary disabled:text-text-tertiary"
            />
            {isTextGenerating ? (
              <button
                type="button"
                onClick={onStopGeneration}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700"
              >
                Stop
              </button>
            ) : (
              <button
                type="submit"
                disabled={!isConnected || !inputText.trim()}
                className="rounded-lg bg-accent-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-primary-hover disabled:bg-surface-tertiary disabled:text-text-tertiary disabled:cursor-not-allowed"
              >
                Send
              </button>
            )}
          </div>
        </form>
      )}

      {/* Image lightbox */}
      <ImageLightbox
        media={expandedMedia}
        onClose={() => setExpandedMedia(null)}
      />
    </div>
  );
}

export default ChatPanel;
