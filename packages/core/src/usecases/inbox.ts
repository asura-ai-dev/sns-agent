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
import { estimateCost } from "@sns-agent/config";
import type {
  ConversationThread,
  InboxChannel,
  InboxInitiator,
  Message,
  MessageProviderMetadata,
  MediaAttachment,
  SocialAccount,
  ThreadProviderMetadata,
  ThreadStatus,
  InboxEngagementActionType,
  EngagementAction,
} from "../domain/entities.js";
import type {
  AccountRepository,
  ConversationRepository,
  EngagementActionRepository,
  MessageRepository,
  UsageRepository,
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
  engagementActionRepo?: EngagementActionRepository;
  accountRepo: AccountRepository;
  usageRepo?: UsageRepository;
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
  engagementActions: EngagementAction[];
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
  participantExternalId?: string | null;
  /** direct=DM系、public=公開会話系 */
  channel?: InboxChannel | null;
  /**
   * 会話の起点。
   * - self: 自アカウント起点
   * - external: 相手起点
   * - mixed: 途中で両方向が混ざる
   */
  initiatedBy?: InboxInitiator | null;
  externalMessageId?: string | null;
  contentText?: string | null;
  contentMedia?: MediaAttachment[] | null;
  authorExternalId?: string | null;
  authorDisplayName?: string | null;
  threadProviderMetadata?: ThreadProviderMetadata | null;
  messageProviderMetadata?: MessageProviderMetadata | null;
  sentAt?: Date | null;
}

export interface InboundMessageResult {
  thread: ConversationThread;
  message: Message;
  created: boolean;
}

export interface SyncInboxFromProviderInput {
  workspaceId: string;
  socialAccountId: string;
  actorId?: string | null;
  limit?: number;
  cursor?: string | null;
}

export interface SyncInboxFromProviderResult {
  syncedThreadCount: number;
  syncedMessageCount: number;
  nextCursor: string | null;
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

export interface PerformInboxEngagementActionInput {
  workspaceId: string;
  threadId: string;
  actionType: InboxEngagementActionType;
  actorId: string;
  targetMessageId?: string | null;
  targetPostId?: string | null;
}

export interface PerformInboxEngagementActionResult {
  action: EngagementAction;
  created: boolean;
}

interface StoreThreadMessageInput extends InboundMessageInput {
  direction: Message["direction"];
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

function getEngagementActionRepo(deps: InboxUsecaseDeps): EngagementActionRepository {
  if (!deps.engagementActionRepo) {
    throw new ValidationError("Engagement action repository is required");
  }
  return deps.engagementActionRepo;
}

function decryptCredentials(credentialsEncrypted: string, encryptionKey: string): string {
  try {
    return decrypt(credentialsEncrypted, encryptionKey);
  } catch {
    throw new ProviderError("Failed to decrypt account credentials");
  }
}

function mergeInitiatedBy(
  existing: InboxInitiator | null | undefined,
  incoming: InboxInitiator | null | undefined,
): InboxInitiator | null {
  if (!incoming) return existing ?? null;
  if (!existing) return incoming;
  if (existing === incoming) return existing;
  if (existing === "mixed" || incoming === "mixed") return "mixed";
  return "mixed";
}

function mergeThreadProviderMetadata(
  existing: ThreadProviderMetadata | null | undefined,
  incoming: ThreadProviderMetadata | null | undefined,
): ThreadProviderMetadata | null {
  if (!existing) return incoming ?? null;
  if (!incoming) return existing;

  return {
    ...existing,
    ...incoming,
    x:
      existing.x || incoming.x
        ? ({
            ...(existing.x ?? {}),
            ...(incoming.x ?? {}),
          } as ThreadProviderMetadata["x"])
        : undefined,
  };
}

async function recordProviderUsage(
  deps: InboxUsecaseDeps,
  args: {
    workspaceId: string;
    platform: Platform;
    endpoint: string;
    actorId: string | null;
    success: boolean;
  },
): Promise<void> {
  if (!deps.usageRepo) return;

  try {
    await deps.usageRepo.record({
      workspaceId: args.workspaceId,
      platform: args.platform,
      endpoint: args.endpoint,
      actorId: args.actorId,
      actorType: "user",
      requestCount: 1,
      success: args.success,
      estimatedCostUsd: estimateCost(args.platform, args.endpoint, 1),
      recordedAt: new Date(),
    });
  } catch (err) {
    console.error("[inbox.usage] failed to record usage:", err);
  }
}

async function storeThreadMessage(
  deps: InboxUsecaseDeps,
  input: StoreThreadMessageInput,
): Promise<{
  thread: ConversationThread;
  message: Message;
  threadCreated: boolean;
  messageCreated: boolean;
}> {
  if (!input.externalThreadId) {
    throw new ValidationError("externalThreadId is required");
  }

  await loadAccount(deps, input.workspaceId, input.socialAccountId);

  const existing = await deps.conversationRepo.findByExternalThread(
    input.workspaceId,
    input.socialAccountId,
    input.externalThreadId,
  );

  const now = new Date();
  const messageSentAt = input.sentAt ?? now;

  let thread: ConversationThread;
  let threadCreated = false;

  if (existing) {
    thread = await deps.conversationRepo.update(existing.id, {
      lastMessageAt: messageSentAt,
      participantName: input.participantName ?? existing.participantName,
      participantExternalId: input.participantExternalId ?? existing.participantExternalId,
      channel: input.channel ?? existing.channel,
      initiatedBy: mergeInitiatedBy(existing.initiatedBy, input.initiatedBy),
      providerMetadata: mergeThreadProviderMetadata(
        existing.providerMetadata,
        input.threadProviderMetadata,
      ),
      status: existing.status === "archived" ? "open" : existing.status,
    });
  } else {
    thread = await deps.conversationRepo.create({
      workspaceId: input.workspaceId,
      socialAccountId: input.socialAccountId,
      platform: input.platform,
      externalThreadId: input.externalThreadId,
      participantName: input.participantName ?? null,
      participantExternalId: input.participantExternalId ?? null,
      channel: input.channel ?? null,
      initiatedBy: input.initiatedBy ?? null,
      lastMessageAt: messageSentAt,
      providerMetadata: input.threadProviderMetadata ?? null,
      status: "open",
    });
    threadCreated = true;
  }

  if (input.externalMessageId) {
    const existingMessage = await deps.messageRepo.findByExternalMessage(
      thread.id,
      input.externalMessageId,
    );
    if (existingMessage) {
      return {
        thread,
        message: existingMessage,
        threadCreated,
        messageCreated: false,
      };
    }
  }

  const message = await deps.messageRepo.create({
    threadId: thread.id,
    direction: input.direction,
    contentText: input.contentText ?? null,
    contentMedia: input.contentMedia ?? null,
    externalMessageId: input.externalMessageId ?? null,
    authorExternalId: input.authorExternalId ?? input.participantExternalId ?? null,
    authorDisplayName: input.authorDisplayName ?? input.participantName ?? null,
    sentAt: messageSentAt,
    providerMetadata: input.messageProviderMetadata ?? null,
  });

  return {
    thread,
    message,
    threadCreated,
    messageCreated: true,
  };
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

  const [messages, engagementActions] = await Promise.all([
    deps.messageRepo.findByThread(threadId, { limit, offset }),
    deps.engagementActionRepo?.findByThread(threadId) ?? Promise.resolve([]),
  ]);

  return { thread, messages, engagementActions };
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
  const result = await storeThreadMessage(deps, {
    ...input,
    direction: "inbound",
  });

  return {
    thread: result.thread,
    message: result.message,
    created: result.threadCreated,
  };
}

// ───────────────────────────────────────────
// syncInboxFromProvider
// ───────────────────────────────────────────

export async function syncInboxFromProvider(
  deps: InboxUsecaseDeps,
  input: SyncInboxFromProviderInput,
): Promise<SyncInboxFromProviderResult> {
  const account = await loadAccount(deps, input.workspaceId, input.socialAccountId);
  if (account.status !== "active") {
    throw new ValidationError(
      `SocialAccount ${account.id} is not active (status=${account.status})`,
    );
  }

  const provider = getProvider(deps, account.platform);
  if (!provider.listThreads || !provider.getMessages) {
    throw new ProviderError(
      `Provider for platform ${account.platform} does not support inbox synchronization`,
    );
  }

  const credentials = decryptCredentials(account.credentialsEncrypted, deps.encryptionKey);

  let threadList;
  try {
    threadList = await provider.listThreads({
      accountCredentials: credentials,
      limit: input.limit,
      cursor: input.cursor ?? undefined,
    });
    await recordProviderUsage(deps, {
      workspaceId: input.workspaceId,
      platform: account.platform,
      endpoint: "inbox.list",
      actorId: input.actorId ?? null,
      success: true,
    });
  } catch (err) {
    await recordProviderUsage(deps, {
      workspaceId: input.workspaceId,
      platform: account.platform,
      endpoint: "inbox.list",
      actorId: input.actorId ?? null,
      success: false,
    });
    throw err;
  }

  const syncedThreadIds = new Set<string>();
  let syncedMessageCount = 0;

  for (const thread of threadList.threads) {
    if (!thread.externalThreadId) continue;

    let messages;
    try {
      messages = await provider.getMessages({
        accountCredentials: credentials,
        externalThreadId: thread.externalThreadId,
        limit: input.limit,
      });
      await recordProviderUsage(deps, {
        workspaceId: input.workspaceId,
        platform: account.platform,
        endpoint: "inbox.getMessages",
        actorId: input.actorId ?? null,
        success: true,
      });
    } catch (err) {
      await recordProviderUsage(deps, {
        workspaceId: input.workspaceId,
        platform: account.platform,
        endpoint: "inbox.getMessages",
        actorId: input.actorId ?? null,
        success: false,
      });
      throw err;
    }

    for (const message of messages.messages) {
      const stored = await storeThreadMessage(deps, {
        workspaceId: input.workspaceId,
        socialAccountId: account.id,
        platform: account.platform,
        externalThreadId: thread.externalThreadId,
        participantName: thread.participantName ?? null,
        participantExternalId: thread.participantExternalId ?? null,
        channel: thread.channel ?? null,
        initiatedBy: thread.initiatedBy ?? null,
        externalMessageId: message.externalMessageId ?? null,
        contentText: message.contentText ?? null,
        contentMedia: message.contentMedia ?? null,
        authorExternalId: message.authorExternalId ?? thread.participantExternalId ?? null,
        authorDisplayName: message.authorDisplayName ?? thread.participantName ?? null,
        threadProviderMetadata: thread.providerMetadata ?? null,
        messageProviderMetadata: message.providerMetadata ?? null,
        sentAt: message.sentAt ?? null,
        direction: message.direction,
      });

      syncedThreadIds.add(stored.thread.id);
      if (stored.messageCreated) {
        syncedMessageCount += 1;
      }
    }
  }

  return {
    syncedThreadCount: syncedThreadIds.size,
    syncedMessageCount,
    nextCursor: threadList.nextCursor,
  };
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
  const normalizedContentText = input.contentText.trim();
  const contentMedia = input.contentMedia ?? null;

  if (normalizedContentText.length === 0 && (!contentMedia || contentMedia.length === 0)) {
    throw new ValidationError("contentText or contentMedia is required");
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

  const replyToMessageId = thread.providerMetadata?.x?.focusPostId ?? null;

  let externalMessageId: string | null = null;
  try {
    const result = await provider.sendReply({
      accountCredentials: credentials,
      externalThreadId,
      contentText: normalizedContentText,
      contentMedia: contentMedia ?? undefined,
      replyToMessageId,
    });
    if (!result.success) {
      throw new ProviderError(`sendReply failed: ${result.error ?? "unknown error"}`);
    }
    externalMessageId = result.externalMessageId;
    await recordProviderUsage(deps, {
      workspaceId: input.workspaceId,
      platform: thread.platform,
      endpoint: "inbox.reply",
      actorId: input.actorId,
      success: true,
    });
  } catch (err) {
    await recordProviderUsage(deps, {
      workspaceId: input.workspaceId,
      platform: thread.platform,
      endpoint: "inbox.reply",
      actorId: input.actorId,
      success: false,
    });
    if (err instanceof ProviderError) throw err;
    throw new ProviderError(
      `sendReply failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const now = new Date();
  const message = await deps.messageRepo.create({
    threadId: thread.id,
    direction: "outbound",
    contentText: normalizedContentText.length > 0 ? normalizedContentText : null,
    contentMedia,
    externalMessageId,
    authorExternalId: account.externalAccountId,
    authorDisplayName: account.displayName,
    sentAt: now,
    providerMetadata: null,
  });

  await deps.conversationRepo.update(thread.id, {
    lastMessageAt: now,
    initiatedBy: mergeInitiatedBy(thread.initiatedBy, "self"),
    status: thread.status === "closed" ? "open" : thread.status,
  });

  return { message, externalMessageId };
}

async function resolveEngagementTargetPostId(
  deps: InboxUsecaseDeps,
  thread: ConversationThread,
  input: Pick<PerformInboxEngagementActionInput, "targetMessageId" | "targetPostId">,
): Promise<{ targetPostId: string; messageId: string | null }> {
  const explicitPostId = input.targetPostId?.trim();
  if (explicitPostId) {
    return { targetPostId: explicitPostId, messageId: null };
  }

  if (input.targetMessageId?.trim()) {
    const messages = await deps.messageRepo.findByThread(thread.id, { limit: 500, offset: 0 });
    const message = messages.find(
      (row) =>
        row.id === input.targetMessageId ||
        (row.externalMessageId !== null && row.externalMessageId === input.targetMessageId),
    );
    if (!message) {
      throw new NotFoundError("Message", input.targetMessageId);
    }
    const postId = message.providerMetadata?.x?.postId ?? message.externalMessageId;
    if (!postId) {
      throw new ValidationError("Message has no X post id");
    }
    return { targetPostId: postId, messageId: message.id };
  }

  const focusPostId = thread.providerMetadata?.x?.focusPostId;
  if (focusPostId) {
    return { targetPostId: focusPostId, messageId: null };
  }

  throw new ValidationError("targetPostId or X focusPostId is required");
}

export async function performInboxEngagementAction(
  deps: InboxUsecaseDeps,
  input: PerformInboxEngagementActionInput,
): Promise<PerformInboxEngagementActionResult> {
  const actionRepo = getEngagementActionRepo(deps);
  const thread = await loadOwnedThread(deps, input.workspaceId, input.threadId);
  const account = await loadAccount(deps, input.workspaceId, thread.socialAccountId);

  if (account.status !== "active") {
    throw new ValidationError(
      `SocialAccount ${account.id} is not active (status=${account.status})`,
    );
  }

  const { targetPostId, messageId } = await resolveEngagementTargetPostId(deps, thread, input);
  const existing = await actionRepo.findByDedupeKey({
    workspaceId: input.workspaceId,
    socialAccountId: account.id,
    actionType: input.actionType,
    targetPostId,
  });
  if (existing) {
    return { action: existing, created: false };
  }

  const provider = getProvider(deps, thread.platform);
  if (!provider.performEngagementAction) {
    throw new ProviderError(
      `Provider for platform ${thread.platform} does not support engagement actions`,
    );
  }

  const credentials = decryptCredentials(account.credentialsEncrypted, deps.encryptionKey);
  let externalActionId: string | null = null;
  try {
    const result = await provider.performEngagementAction({
      accountCredentials: credentials,
      accountExternalId: account.externalAccountId,
      actionType: input.actionType,
      targetPostId,
    });
    if (!result.success) {
      throw new ProviderError(
        `performEngagementAction failed: ${result.error ?? "unknown error"}`,
      );
    }
    externalActionId = result.externalActionId;
    await recordProviderUsage(deps, {
      workspaceId: input.workspaceId,
      platform: thread.platform,
      endpoint: `inbox.action.${input.actionType}`,
      actorId: input.actorId,
      success: true,
    });
  } catch (err) {
    await recordProviderUsage(deps, {
      workspaceId: input.workspaceId,
      platform: thread.platform,
      endpoint: `inbox.action.${input.actionType}`,
      actorId: input.actorId,
      success: false,
    });
    if (err instanceof ProviderError) throw err;
    throw new ProviderError(
      `performEngagementAction failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const created = await actionRepo.createOnce({
    workspaceId: input.workspaceId,
    socialAccountId: account.id,
    threadId: thread.id,
    messageId,
    actionType: input.actionType,
    targetPostId,
    actorId: input.actorId,
    externalActionId,
    status: "applied",
    metadata: null,
    performedAt: new Date(),
  });

  return created;
}
