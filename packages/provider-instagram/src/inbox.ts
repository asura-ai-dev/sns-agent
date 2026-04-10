/**
 * Instagram Messaging API (DM) の参照
 *
 * Instagram Messaging は Messenger Platform の Conversations API を使う:
 * - GET /{page-id}/conversations?platform=instagram  (スレッド一覧)
 * - GET /{conversation-id}?fields=messages           (スレッド内のメッセージ ID 一覧)
 * - GET /{message-id}?fields=id,from,to,message,created_time (個別メッセージ詳細)
 *
 * v1 は参照のみ。書き込み (sendReply) は将来タスクで対応する。
 */
import type {
  ListThreadsInput,
  ThreadListResult,
  GetMessagesInput,
  MessageListResult,
} from "@sns-agent/core";
import { ProviderError } from "@sns-agent/core";
import { InstagramApiClient } from "./http-client.js";

interface InboxCredentials {
  /** Facebook Page ID (Messenger conversations は Page スコープ) */
  pageId: string;
  /** Page Access Token */
  accessToken: string;
}

function parseInboxCredentials(raw: string): InboxCredentials {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    if (typeof obj.accessToken !== "string" || obj.accessToken.length === 0) {
      throw new Error("accessToken missing");
    }
    if (typeof obj.pageId !== "string" || obj.pageId.length === 0) {
      throw new Error("pageId missing");
    }
    return { accessToken: obj.accessToken, pageId: obj.pageId };
  } catch (err) {
    throw new ProviderError(`Invalid Instagram inbox credentials: ${(err as Error).message}`, {
      cause: String(err),
    });
  }
}

/**
 * スレッド一覧を取得する。
 * Instagram Messaging は Messenger Conversations API の platform=instagram フィルタで取る。
 */
export async function listThreads(
  input: ListThreadsInput,
  httpClient: InstagramApiClient,
): Promise<ThreadListResult> {
  const creds = parseInboxCredentials(input.accountCredentials);

  const query: Record<string, string | number | undefined> = {
    platform: "instagram",
    fields: "id,participants,updated_time",
    limit: input.limit ?? 25,
  };
  if (input.cursor) {
    query.after = input.cursor;
  }

  const res = await httpClient.request<{
    data?: Array<{
      id: string;
      participants?: { data?: Array<{ id: string; username?: string; name?: string }> };
      updated_time?: string;
    }>;
    paging?: { cursors?: { after?: string }; next?: string };
  }>({
    method: "GET",
    path: `/${encodeURIComponent(creds.pageId)}/conversations`,
    accessToken: creds.accessToken,
    query,
  });

  const rows = res.data?.data ?? [];
  const threads = rows.map((row) => {
    const participantRows = row.participants?.data ?? [];
    // Page 自身以外の最初の participant を相手とみなす
    const other = participantRows.find((p) => p.id !== creds.pageId) ?? participantRows[0];
    const name = other?.username ?? other?.name ?? null;
    const updatedAt = row.updated_time ? new Date(row.updated_time) : null;
    return {
      externalThreadId: row.id,
      participantName: name,
      lastMessageAt: updatedAt,
    };
  });

  const nextCursor = res.data?.paging?.next ? (res.data.paging.cursors?.after ?? null) : null;

  return { threads, nextCursor };
}

/**
 * スレッド内メッセージを取得する。
 * Conversations API の messages エッジはメッセージ ID のみ返すため、
 * 個別 GET でメッセージ本文・送信者を解決する。
 */
export async function getMessages(
  input: GetMessagesInput,
  httpClient: InstagramApiClient,
): Promise<MessageListResult> {
  const creds = parseInboxCredentials(input.accountCredentials);

  const query: Record<string, string | number | undefined> = {
    fields: "messages.limit(" + String(input.limit ?? 25) + "){id,from,to,message,created_time}",
  };
  if (input.cursor) {
    // messages エッジは独立したページングを持つため、ここでは after を渡さず
    // 呼び出し側が next messages URL を追うのを前提とする
    query.after = input.cursor;
  }

  const res = await httpClient.request<{
    messages?: {
      data?: Array<{
        id: string;
        from?: { id: string; username?: string };
        to?: { data?: Array<{ id: string; username?: string }> };
        message?: string;
        created_time?: string;
      }>;
      paging?: { cursors?: { after?: string }; next?: string };
    };
    id?: string;
  }>({
    method: "GET",
    path: `/${encodeURIComponent(input.externalThreadId)}`,
    accessToken: creds.accessToken,
    query,
  });

  const rows = res.data?.messages?.data ?? [];
  const messages = rows.map((row) => {
    const direction: "inbound" | "outbound" =
      row.from?.id === creds.pageId ? "outbound" : "inbound";
    return {
      externalMessageId: row.id,
      direction,
      contentText: row.message ?? null,
      // 画像/動画メッセージは attachments から取得する必要があるが v1 はテキストのみ
      contentMedia: null,
      sentAt: row.created_time ? new Date(row.created_time) : null,
    };
  });

  const nextCursor = res.data?.messages?.paging?.next
    ? (res.data.messages.paging.cursors?.after ?? null)
    : null;

  return { messages, nextCursor };
}
