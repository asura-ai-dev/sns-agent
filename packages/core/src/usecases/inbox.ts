/**
 * 受信・会話管理ユースケース (Task 6003)
 *
 * design.md セクション 3.1 (conversation_threads / messages)、
 * セクション 4.2 (受信エンドポイント)、
 * spec.md 主要機能 14 (受信・会話管理) に準拠。
 *
 * 責務:
 * - スレッド一覧 / 詳細取得
 * - Webhook 受信イベントをスレッド + messages テーブルへ正規化
 * - 返信送信 (Provider.sendReply を呼び、outbound として記録)
 *
 * スコープ外:
 * - 承認フロー本体 (Phase 6 の approvals usecase に委譲)
 *   v1 実装では Provider.sendReply を直接呼ぶ最小構成とし、
 *   将来 approvals が完成したら requireApproval コールバックを差し替えて繋ぐ。
 */
import type { Platform } from "@sns-agent/config";
import type {
  ConversationThread,
  Message,
  MediaAttachment,
  SocialAccount,
  ThreadStatus,
} from "../domain/entities.js";
import type {
  AccountRepository,
  ConversationRepository,
  MessageRepository,
} from "../interfaces/repositories.js";
import type { SocialProvider } from "../interfaces/social-provider.js";
import { NotFoundError, ValidationError, ProviderError } from "../errors/domain-error.js";
import { decrypt } from "../domain/crypto.js";

// ───────────────────────────────────────────
// 依存注入
// ───────────────────────────────────────────

export interface InboxUsecaseDeps {
  conversationRepo: ConversationRepository;
  messageRepo: MessageRepository;
  accountRepo: AccountRepository;
  /** platform -> SocialProvider */
  providers: Map<Platform, SocialProvider>;
  /** AES-256-GCM 用の暗号化キー */
  encryptionKey: string;
}

// ───────────────────────────────────────────
// 入出力型
// ───────────────────────────────────────────

export interface ListThreadsFilters {
  platform?: Platform;
  status?: ThreadStatus;
  limit?: number;
  offset?: number;
}

export interface ListThreadsResult {
  data: ConversationThread[];
  meta: {
    limit: number;
    offset: number;
    total: number;
  };
}

export interface GetThreadResult {
  thread: ConversationThread;
  messages: Message[];
}

/**
 * Webhook などから受信したメッセージイベント。
 * routes/webhooks.ts の各ハンドラが WebhookEvent を正規化してから渡す。
 */
export interface InboundMessageInput {
  workspaceId: string;
  socialAccountId: string;
  platform: Platform;
  externalThreadId: string;
  /** 外部ユーザー ID や DM 相手の表示名 */
  participantName?: string | null;
  externalMessageId?: string | null;
  contentText?: string | null;
  contentMedia?: MediaAttachment[] | null;
  sentAt?: Date | null;
}

export interface InboundMessageResult {
  thread: ConversationThread;
  message: Message;
  created: boolean;
}

export interface SendReplyInput {
  workspaceId: string;
  threadId: string;
  contentText: string;
  contentMedia?: MediaAttachment[] | null;
  /** actor_id (user or agent) */
  actorId: string;
}

export interface SendReplyResult {
  message: Message;
  externalMessageId: string | null;
}

// ───────────────────────────────────────────
// ヘルパー
// ───────────────────────────────────────────

function getProvider(deps: InboxUsecaseDeps, platform: Platform): SocialProvider {
  const provider = deps.providers.get(platform);
  if (!provider) {
    throw new ValidationError(`Unsupported platform: ${platform}`);
  }
  return provider;
}

async function loadOwnedThread(
  deps: InboxUsecaseDeps,
  workspaceId: string,
  threadId: string,
): Promise<ConversationThread> {
  const thread = await deps.conversationRepo.findById(threadId);
  if (!thread || thread.workspaceId !== workspaceId) {
    throw new NotFoundError("ConversationThread", threadId);
  }
  return thread;
}

async function loadAccount(
  deps: InboxUsecaseDeps,
  workspaceId: string,
  socialAccountId: string,
): Promise<SocialAccount> {
  const account = await deps.accountRepo.findById(socialAccountId);
  if (!account || account.workspaceId !== workspaceId) {
    throw new NotFoundError("SocialAccount", socialAccountId);
  }
  return account;
}

function decryptCredentials(credentialsEncrypted: string, encryptionKey: string): string {
  try {
    return decrypt(credentialsEncrypted, encryptionKey);
  } catch {
    throw new ProviderError("Failed to decrypt account credentials");
  }
}

// ───────────────────────────────────────────
// listThreads
// ───────────────────────────────────────────

/**
 * ワークスペースのスレッド一覧を取得する。
 * 最新メッセージ日時 (lastMessageAt) の降順、未設定は createdAt 降順で並ぶ。
 * limit / offset でページネーション。
 */
export async function listThreads(
  deps: InboxUsecaseDeps,
  workspaceId: string,
  filters: ListThreadsFilters = {},
): Promise<ListThreadsResult> {
  const limit = filters.limit && filters.limit > 0 ? Math.min(filters.limit, 200) : 50;
  const offset = filters.offset && filters.offset >= 0 ? filters.offset : 0;

  const [data, total] = await Promise.all([
    deps.conversationRepo.findByWorkspace(workspaceId, {
      platform: filters.platform,
      status: filters.status,
      limit,
      offset,
    }),
    deps.conversationRepo.countByWorkspace(workspaceId, {
      platform: filters.platform,
      status: filters.status,
    }),
  ]);

  return {
    data,
    meta: { limit, offset, total },
  };
}

// ───────────────────────────────────────────
// getThread
// ───────────────────────────────────────────

/**
 * スレッド詳細 + メッセージ一覧を返す。
 * ワークスペースの所有権チェックを行う。
 * messages は 古い -> 新しい 順 (sentAt 昇順) で返す。
 */
export async function getThread(
  deps: InboxUsecaseDeps,
  workspaceId: string,
  threadId: string,
  options?: { limit?: number; offset?: number },
): Promise<GetThreadResult> {
  const thread = await loadOwnedThread(deps, workspaceId, threadId);

  const limit = options?.limit && options.limit > 0 ? Math.min(options.limit, 500) : 200;
  const offset = options?.offset && options.offset >= 0 ? options.offset : 0;

  const messages = await deps.messageRepo.findByThread(threadId, { limit, offset });

  return { thread, messages };
}

// ───────────────────────────────────────────
// processInboundMessage
// ───────────────────────────────────────────

/**
 * 受信イベントを処理する。
 *
 * 手順:
 * 1. socialAccount 所有権確認
 * 2. (workspace, account, externalThreadId) で既存スレッド検索
 *    - 無ければ create し、created=true
 *    - 有れば participant_name / last_message_at を更新
 * 3. message を inbound として挿入
 * 4. thread の last_message_at を message.sentAt (なければ now) で更新
 */
export async function processInboundMessage(
  deps: InboxUsecaseDeps,
  input: InboundMessageInput,
): Promise<InboundMessageResult> {
  if (!input.externalThreadId) {
    throw new ValidationError("externalThreadId is required");
  }

  // 1. アカウント所有権
  await loadAccount(deps, input.workspaceId, input.socialAccountId);

  // 2. 既存スレッドを検索 or 作成
  const existing = await deps.conversationRepo.findByExternalThread(
    input.workspaceId,
    input.socialAccountId,
    input.externalThreadId,
  );

  const now = new Date();
  const messageSentAt = input.sentAt ?? now;

  let thread: ConversationThread;
  let created = false;

  if (existing) {
    thread = await deps.conversationRepo.update(existing.id, {
      lastMessageAt: messageSentAt,
      participantName: input.participantName ?? existing.participantName,
      // 既読管理は v1 では持たないが、archived に戻ってきたら open に再オープン
      status: existing.status === "archived" ? "open" : existing.status,
    });
  } else {
    thread = await deps.conversationRepo.create({
      workspaceId: input.workspaceId,
      socialAccountId: input.socialAccountId,
      platform: input.platform,
      externalThreadId: input.externalThreadId,
      participantName: input.participantName ?? null,
      lastMessageAt: messageSentAt,
      status: "open",
    });
    created = true;
  }

  // 3. message を inbound として挿入
  const message = await deps.messageRepo.create({
    threadId: thread.id,
    direction: "inbound",
    contentText: input.contentText ?? null,
    contentMedia: input.contentMedia ?? null,
    externalMessageId: input.externalMessageId ?? null,
    sentAt: messageSentAt,
  });

  return { thread, message, created };
}

// ───────────────────────────────────────────
// sendReply
// ───────────────────────────────────────────

/**
 * 返信を送信する。
 *
 * 手順:
 * 1. スレッドと account を取得
 * 2. Provider.sendReply が無ければ ProviderError
 * 3. credentials を復号し sendReply を呼ぶ
 * 4. outbound message として記録し、thread.last_message_at を更新
 *
 * NOTE: 承認フロー (Phase 6 approvals usecase) は本 usecase の呼び出し側で
 * 予め評価する想定 (deps として注入する enforcer を受け取る拡張は将来対応)。
 * 現状は「呼ばれたら送る」最小構成。
 */
export async function sendReply(
  deps: InboxUsecaseDeps,
  input: SendReplyInput,
): Promise<SendReplyResult> {
  if (!input.contentText || input.contentText.trim().length === 0) {
    throw new ValidationError("contentText is required");
  }

  const thread = await loadOwnedThread(deps, input.workspaceId, input.threadId);
  const account = await loadAccount(deps, input.workspaceId, thread.socialAccountId);

  if (account.status !== "active") {
    throw new ValidationError(
      `SocialAccount ${account.id} is not active (status=${account.status})`,
    );
  }

  const provider = getProvider(deps, thread.platform);
  if (!provider.sendReply) {
    throw new ProviderError(`Provider for platform ${thread.platform} does not support sendReply`);
  }

  const credentials = decryptCredentials(account.credentialsEncrypted, deps.encryptionKey);

  const externalThreadId = thread.externalThreadId;
  if (!externalThreadId) {
    throw new ValidationError("Thread has no externalThreadId");
  }

  let externalMessageId: string | null = null;
  try {
    const result = await provider.sendReply({
      accountCredentials: credentials,
      externalThreadId,
      contentText: input.contentText,
      contentMedia: input.contentMedia ?? undefined,
    });
    if (!result.success) {
      throw new ProviderError(`sendReply failed: ${result.error ?? "unknown error"}`);
    }
    externalMessageId = result.externalMessageId;
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    throw new ProviderError(
      `sendReply failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const now = new Date();
  const message = await deps.messageRepo.create({
    threadId: thread.id,
    direction: "outbound",
    contentText: input.contentText,
    contentMedia: input.contentMedia ?? null,
    externalMessageId,
    sentAt: now,
  });

  await deps.conversationRepo.update(thread.id, {
    lastMessageAt: now,
    status: thread.status === "closed" ? "open" : thread.status,
  });

  return { message, externalMessageId };
}
