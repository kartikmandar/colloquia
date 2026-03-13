/**
 * REST client for chat history endpoints.
 */

import type { ChatSummary, SavedChatMessage } from "./protocol";

export async function fetchChats(
  baseUrl: string,
  apiKey: string,
): Promise<ChatSummary[]> {
  const url = `${baseUrl}/chats?api_key=${encodeURIComponent(apiKey)}`;
  const resp: Response = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to fetch chats: ${resp.status}`);
  const data: { chats: ChatSummary[] } = await resp.json();
  return data.chats;
}

export async function fetchChat(
  baseUrl: string,
  chatId: string,
): Promise<{ chat: ChatSummary; messages: SavedChatMessage[] }> {
  const resp: Response = await fetch(`${baseUrl}/chats/${chatId}`);
  if (!resp.ok) throw new Error(`Failed to fetch chat: ${resp.status}`);
  return await resp.json();
}

export async function renameChat(
  baseUrl: string,
  chatId: string,
  title: string,
): Promise<void> {
  const resp: Response = await fetch(`${baseUrl}/chats/${chatId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!resp.ok) throw new Error(`Failed to rename chat: ${resp.status}`);
}

export async function deleteChat(
  baseUrl: string,
  chatId: string,
): Promise<void> {
  const resp: Response = await fetch(`${baseUrl}/chats/${chatId}`, {
    method: "DELETE",
  });
  if (!resp.ok) throw new Error(`Failed to delete chat: ${resp.status}`);
}
