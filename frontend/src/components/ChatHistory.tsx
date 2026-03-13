/**
 * ChatHistory — sidebar panel showing saved chats with management actions.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import type { ChatSummary } from "../lib/protocol";
import { fetchChats, renameChat, deleteChat } from "../lib/chatApi";

interface ChatHistoryProps {
  backendUrl: string;
  apiKey: string;
  activeChatId: string | null;
  onSelectChat: (chatId: string, chatType: "voice" | "text") => void;
  onNewChat: (chatType: "voice" | "text") => void;
  onChatDeleted: (chatId: string) => void;
  onChatRenamed: (chatId: string, title: string) => void;
}

function relativeTime(dateStr: string): string {
  const now: number = Date.now();
  const then: number = new Date(dateStr).getTime();
  const diffMs: number = now - then;
  const diffMin: number = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr: number = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay: number = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function ChatHistory({
  backendUrl,
  apiKey,
  activeChatId,
  onSelectChat,
  onNewChat,
  onChatDeleted,
  onChatRenamed,
}: ChatHistoryProps): React.ReactElement {
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState<string>("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showNewMenu, setShowNewMenu] = useState<boolean>(false);
  const editInputRef = useRef<HTMLInputElement>(null);

  const loadChats = useCallback(async (): Promise<void> => {
    if (!backendUrl || !apiKey) return;
    try {
      const result: ChatSummary[] = await fetchChats(backendUrl, apiKey);
      setChats(result);
    } catch (err: unknown) {
      console.error("Failed to load chats:", err);
    } finally {
      setLoading(false);
    }
  }, [backendUrl, apiKey]);

  useEffect(() => {
    loadChats();
  }, [loadChats]);

  // Refresh on visibility change
  useEffect(() => {
    const handler = (): void => {
      if (document.visibilityState === "visible") {
        loadChats();
      }
    };
    document.addEventListener("visibilitychange", handler);
    return (): void => document.removeEventListener("visibilitychange", handler);
  }, [loadChats]);

  // Auto-focus edit input
  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  const handleStartEdit = useCallback(
    (chat: ChatSummary): void => {
      setEditingId(chat.id);
      setEditTitle(chat.title);
      setDeletingId(null);
    },
    [],
  );

  const handleSaveEdit = useCallback(
    async (chatId: string): Promise<void> => {
      const trimmed: string = editTitle.trim();
      if (!trimmed) return;
      try {
        await renameChat(backendUrl, chatId, trimmed);
        setChats((prev: ChatSummary[]) =>
          prev.map((c: ChatSummary) =>
            c.id === chatId ? { ...c, title: trimmed } : c,
          ),
        );
        onChatRenamed(chatId, trimmed);
      } catch (err: unknown) {
        console.error("Failed to rename:", err);
      }
      setEditingId(null);
    },
    [backendUrl, editTitle, onChatRenamed],
  );

  const handleDelete = useCallback(
    async (chatId: string): Promise<void> => {
      try {
        await deleteChat(backendUrl, chatId);
        setChats((prev: ChatSummary[]) =>
          prev.filter((c: ChatSummary) => c.id !== chatId),
        );
        onChatDeleted(chatId);
      } catch (err: unknown) {
        console.error("Failed to delete:", err);
      }
      setDeletingId(null);
    },
    [backendUrl, onChatDeleted],
  );

  // Expose refresh method for parent to call when title updates arrive
  const publicRefresh = loadChats;
  // Attach to window for WS handler access
  useEffect(() => {
    (
      window as unknown as Record<string, () => Promise<void>>
    ).__chatHistoryRefresh = publicRefresh;
    return (): void => {
      delete (window as unknown as Record<string, () => Promise<void>>)
        .__chatHistoryRefresh;
    };
  }, [publicRefresh]);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border-primary px-4 py-3">
        <h2 className="font-display text-sm font-semibold text-text-primary">
          Chat History
        </h2>
        <div className="relative">
          <button
            onClick={(): void => setShowNewMenu(!showNewMenu)}
            className="rounded-lg bg-accent-primary/10 px-3 py-1.5 text-xs font-medium text-accent-primary transition-all hover:bg-accent-primary/20 active:scale-[0.98]"
          >
            + New Chat
          </button>
          {showNewMenu && (
            <div className="absolute right-0 top-full z-10 mt-1 w-36 rounded-lg border border-border-primary bg-surface-primary py-1 shadow-elevated">
              <button
                onClick={(): void => {
                  onNewChat("text");
                  setShowNewMenu(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-xs text-text-primary hover:bg-surface-tertiary"
              >
                <svg
                  className="h-3.5 w-3.5"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zm-4 0H9v2h2V9z"
                    clipRule="evenodd"
                  />
                </svg>
                Text Chat
              </button>
              <button
                onClick={(): void => {
                  onNewChat("voice");
                  setShowNewMenu(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-xs text-text-primary hover:bg-surface-tertiary"
              >
                <svg
                  className="h-3.5 w-3.5"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z"
                    clipRule="evenodd"
                  />
                </svg>
                Voice Chat
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Chat list */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center py-8 text-xs text-text-secondary">
            Loading chats...
          </div>
        )}
        {!loading && chats.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-text-secondary">
            <svg
              className="mb-3 h-10 w-10 opacity-40"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zm-4 0H9v2h2V9z"
                clipRule="evenodd"
              />
            </svg>
            <p className="text-sm font-medium">No saved chats yet</p>
            <p className="mt-1 text-xs">
              Start a new conversation to get going
            </p>
          </div>
        )}
        {chats.map((chat: ChatSummary) => {
          const isActive: boolean = chat.id === activeChatId;
          return (
            <div
              key={chat.id}
              className={`group relative border-b border-border-primary/50 transition-colors ${
                isActive
                  ? "border-l-2 border-l-accent-primary bg-accent-primary/5"
                  : "hover:bg-surface-tertiary/50"
              }`}
            >
              <button
                onClick={(): void =>
                  onSelectChat(chat.id, chat.chat_type)
                }
                className="w-full px-4 py-3 text-left"
              >
                <div className="flex items-start gap-2">
                  {/* Type icon */}
                  <span className="mt-0.5 shrink-0 text-text-secondary">
                    {chat.chat_type === "voice" ? (
                      <svg
                        className="h-3.5 w-3.5"
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
                        className="h-3.5 w-3.5"
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
                  </span>
                  <div className="min-w-0 flex-1">
                    {editingId === chat.id ? (
                      <input
                        ref={editInputRef}
                        value={editTitle}
                        onChange={(
                          e: React.ChangeEvent<HTMLInputElement>,
                        ): void => setEditTitle(e.target.value)}
                        onKeyDown={(
                          e: React.KeyboardEvent<HTMLInputElement>,
                        ): void => {
                          if (e.key === "Enter") void handleSaveEdit(chat.id);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        onBlur={(): void => {
                          void handleSaveEdit(chat.id);
                        }}
                        className="w-full rounded border border-accent-primary/30 bg-surface-primary px-1.5 py-0.5 text-sm text-text-primary outline-none focus:border-accent-primary"
                        onClick={(e: React.MouseEvent): void =>
                          e.stopPropagation()
                        }
                      />
                    ) : (
                      <p className="truncate text-sm font-medium text-text-primary">
                        {chat.title}
                      </p>
                    )}
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-text-secondary">
                      <span>{relativeTime(chat.updated_at)}</span>
                      <span className="rounded-full bg-surface-tertiary px-1.5 py-0.5 text-[10px]">
                        {chat.message_count} msgs
                      </span>
                    </div>
                  </div>
                </div>
              </button>

              {/* Hover actions */}
              {editingId !== chat.id && (
                <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    onClick={(e: React.MouseEvent): void => {
                      e.stopPropagation();
                      handleStartEdit(chat);
                    }}
                    className="rounded p-1 text-text-secondary hover:bg-surface-tertiary hover:text-text-primary"
                    title="Rename"
                  >
                    <svg
                      className="h-3.5 w-3.5"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                    </svg>
                  </button>
                  <button
                    onClick={(e: React.MouseEvent): void => {
                      e.stopPropagation();
                      setDeletingId(chat.id);
                    }}
                    className="rounded p-1 text-text-secondary hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950 dark:hover:text-red-400"
                    title="Delete"
                  >
                    <svg
                      className="h-3.5 w-3.5"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path
                        fillRule="evenodd"
                        d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </button>
                </div>
              )}

              {/* Delete confirmation */}
              {deletingId === chat.id && (
                <div className="flex items-center gap-2 border-t border-red-100 bg-red-50 px-4 py-2 dark:border-red-900 dark:bg-red-950">
                  <span className="text-xs text-red-600 dark:text-red-400">
                    Delete this chat?
                  </span>
                  <button
                    onClick={(): void => setDeletingId(null)}
                    className="rounded px-2 py-0.5 text-xs text-text-secondary hover:bg-surface-tertiary"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={(): void => {
                      handleDelete(chat.id);
                    }}
                    className="rounded bg-red-600 px-2 py-0.5 text-xs text-white hover:bg-red-700"
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default ChatHistory;
