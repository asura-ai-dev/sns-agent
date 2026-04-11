/**
 * LINE 受信 (inbox) 操作
 *
 * LINE Messaging API にはメッセージの「過去取得」API が存在しない。
 * (X のようにサーバー側でスレッドを列挙するエンドポイントは無い)
 *
 * v1 では以下の方式を取る:
 * - Webhook (webhook.ts の handleWebhook) で受信したメッセージを usecase 層で DB に蓄積
 * - listThreads / getMessages はその蓄積データから返す
 *
 * provider-line 単体ではストアを持たないので、外部から注入された `InboxStore`
 * を参照する形にする。ストアが未注入の場合は空結果を返す (プロバイダとしてインターフェースは満たしつつ、実データは usecase 層で組み立てる)。
 */
import type {
  ListThreadsInput,
  ThreadListResult,
  GetMessagesInput,
  MessageListResult,
  SendReplyInput,
  SendReplyResult,
  MediaAttachment,
} from "@sns-agent/core";
import { LineApiClient } from "./http-client.js";
import { parseLineCredentials } from "./credentials.js";
import { buildLineMessages } from "./post.js";

/**
 * usecase 層が実装する inbox ストア。
 * provider-line は署名検証とイベント解析の責任を持ち、
 * 永続化はこのインターフェース経由で行う。
 */
export interface LineInboxStore {
  listThreads(input: {
    accountCredentials: string;
    limit?: number;
    cursor?: string;
  }): Promise<ThreadListResult>;

  getMessages(input: {
    accountCredentials: string;
    externalThreadId: string;
    limit?: number;
    cursor?: string;
  }): Promise<MessageListResult>;
}

/** ストア未注入時のデフォルト実装: 空結果を返す。 */
export const EMPTY_LINE_INBOX_STORE: LineInboxStore = {
  async listThreads(): Promise<ThreadListResult> {
    return { threads: [], nextCursor: null };
  },
  async getMessages(): Promise<MessageListResult> {
    return { messages: [], nextCursor: null };
  },
};

export async function listThreads(
  input: ListThreadsInput,
  store: LineInboxStore,
): Promise<ThreadListResult> {
  return store.listThreads({
    accountCredentials: input.accountCredentials,
    limit: input.limit,
    cursor: input.cursor,
  });
}

export async function getMessages(
  input: GetMessagesInput,
  store: LineInboxStore,
): Promise<MessageListResult> {
  return store.getMessages({
    accountCredentials: input.accountCredentials,
    externalThreadId: input.externalThreadId,
    limit: input.limit,
    cursor: input.cursor,
  });
}

// ───────────────────────────────────────────
// sendReply: LINE の reply API
// ───────────────────────────────────────────

/**
 * LINE の返信は「replyToken」を使った reply API で行う。
 * replyToken は Webhook イベントに付与される短命トークン (約 1 分有効)。
 *
 * core の SendReplyInput には replyToken フィールドが無いため、
 * externalThreadId に一時的に `reply:<token>` 形式で渡すか、
 * extra フィールドで replyToken を受け取る運用とする。
 */
export async function sendReply(
  input: SendReplyInput,
  httpClient: LineApiClient,
): Promise<SendReplyResult> {
  const creds = parseLineCredentials(input.accountCredentials);

  const anyInput = input as unknown as { extra?: { replyToken?: string } };
  let replyToken = anyInput.extra?.replyToken;
  if (!replyToken && input.externalThreadId.startsWith("reply:")) {
    replyToken = input.externalThreadId.slice("reply:".length);
  }
  if (!replyToken) {
    return {
      success: false,
      externalMessageId: null,
      error:
        "LINE sendReply requires replyToken (pass via extra.replyToken or externalThreadId='reply:<token>')",
    };
  }

  const messages = buildLineMessages({
    contentText: input.contentText,
    contentMedia: (input.contentMedia as MediaAttachment[] | undefined) ?? null,
  });
  if (messages.length === 0) {
    return {
      success: false,
      externalMessageId: null,
      error: "Empty LINE reply: neither text nor media provided",
    };
  }

  try {
    const res = await httpClient.request<{ sentMessages?: Array<{ id?: string }> }>({
      method: "POST",
      path: "/v2/bot/message/reply",
      accessToken: creds.accessToken,
      json: { replyToken, messages },
    });
    const id = res.data?.sentMessages?.[0]?.id ?? `line-reply-${Date.now()}`;
    return { success: true, externalMessageId: id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, externalMessageId: null, error: message };
  }
}
