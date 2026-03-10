/**
 * ChatPanel — displays conversation messages and provides text input.
 */

import { useState, useRef, useEffect } from "react";
import type { ChatMessage } from "../hooks/useWebSocket";

interface ChatPanelProps {
  messages: ChatMessage[];
  onSendText: (text: string) => void;
  isConnected: boolean;
}

function ChatPanel({
  messages,
  onSendText,
  isConnected,
}: ChatPanelProps): React.ReactElement {
  const [inputText, setInputText] = useState<string>("");
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
        className="flex-1 overflow-y-auto px-4 py-3 space-y-3"
      >
        {messages.length === 0 && (
          <div className="flex h-full items-center justify-center text-sm text-gray-400">
            Start a conversation using voice or text
          </div>
        )}
        {messages.map((msg: ChatMessage) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                msg.role === "user"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-900"
              }`}
            >
              <div className="flex items-center gap-1.5 mb-0.5">
                {msg.mode === "voice" ? (
                  <svg
                    className={`h-3 w-3 ${msg.role === "user" ? "text-blue-200" : "text-gray-400"}`}
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
                    className={`h-3 w-3 ${msg.role === "user" ? "text-blue-200" : "text-gray-400"}`}
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
                  className={`text-[10px] font-medium ${msg.role === "user" ? "text-blue-200" : "text-gray-400"}`}
                >
                  {msg.role === "user" ? "You" : "Colloquia"}
                </span>
              </div>
              <p className="whitespace-pre-wrap">{msg.text}</p>
              {/* Tool calls (collapsed) */}
              {msg.toolCalls && msg.toolCalls.length > 0 && (
                <div className="mt-1.5 space-y-1">
                  {msg.toolCalls.map((tc, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-1 rounded bg-gray-200/50 px-2 py-0.5 text-[10px] text-gray-500"
                    >
                      <span className="font-mono">{tc.toolName}</span>
                      <span>
                        {tc.status === "calling"
                          ? "..."
                          : tc.status === "done"
                            ? `(${tc.durationMs ?? 0}ms)`
                            : "failed"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Text input */}
      <form onSubmit={handleSubmit} className="border-t border-gray-200 p-3">
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
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-400"
          />
          <button
            type="submit"
            disabled={!isConnected || !inputText.trim()}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}

export default ChatPanel;
