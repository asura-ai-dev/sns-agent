/**
 * 受信トレイ (Inbox) ルート
 *
 * Task 6003: 受信・会話管理エンドポイント。
 * design.md セクション 4.2 (/api/inbox)、
 * spec.md 主要機能 14 (受信・会話管理) に準拠。
 *
 * エンドポイント:
 *   GET  /api/inbox                 (inbox:read)
 *   GET  /api/inbox/:threadId       (inbox:read)
 *   POST /api/inbox/sync            (inbox:read)
 *   POST /api/inbox/:threadId/reply (inbox:reply, editor 以上)
 */
import { Hono } from "hono";
import { and, eq, inArray } from "drizzle-orm";
import type { Platform } from "@sns-agent/config";
import { PLATFORMS } from "@sns-agent/config";
import {
  listThreads,
  getThread,
  sendInboxReply,
  syncInboxFromProvider,
  performInboxEngagementAction,
  createApprovalRequest,
  requiresApproval,
  ValidationError,
  type ApprovalUsecaseDeps,
  type InboxUsecaseDeps,
  type ConversationThread,
  type EngagementAction,
  type InboxEngagementActionType,
  type MediaAttachment,
  type Message,
  type ThreadStatus,
} from "@sns-agent/core";
import {
  DrizzleAccountRepository,
  DrizzleApprovalRepository,
  DrizzleAuditLogRepository,
  DrizzleConversationRepository,
  DrizzleEngagementActionRepository,
  DrizzleMessageRepository,
  posts,
} from "@sns-agent/db";
import { requirePermission } from "../middleware/rbac.js";
import { getProviderRegistry } from "../providers.js";
import type { AppVariables } from "../types.js";

const inbox = new Hono<{ Variables: AppVariables }>();

const THREAD_STATUSES: readonly ThreadStatus[] = ["open", "closed", "archived"];

// ───────────────────────────────────────────
// 依存注入
// ───────────────────────────────────────────

function buildDeps(db: AppVariables["db"]): InboxUsecaseDeps {
  const encryptionKey =
    process.env.ENCRYPTION_KEY ||
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  return {
    conversationRepo: new DrizzleConversationRepository(db),
    messageRepo: new DrizzleMessageRepository(db),
    engagementActionRepo: new DrizzleEngagementActionRepository(db),
    accountRepo: new DrizzleAccountRepository(db),
    usageRepo: undefined,
    providers: getProviderRegistry().getAll(),
    encryptionKey,
  };
}

// ───────────────────────────────────────────
// シリアライザ
// ───────────────────────────────────────────

function serializeThread(thread: ConversationThread): Record<string, unknown> {
  return {
    id: thread.id,
    workspaceId: thread.workspaceId,
    socialAccountId: thread.socialAccountId,
    platform: thread.platform,
    externalThreadId: thread.externalThreadId,
    participantName: thread.participantName,
    participantExternalId: thread.participantExternalId,
    channel: thread.channel,
    initiatedBy: thread.initiatedBy,
    lastMessageAt: thread.lastMessageAt,
    providerMetadata: thread.providerMetadata,
    status: thread.status,
    createdAt: thread.createdAt,
  };
}

function serializeMessage(message: Message): Record<string, unknown> {
  return {
    id: message.id,
    threadId: message.threadId,
    direction: message.direction,
    contentText: message.contentText,
    contentMedia: message.contentMedia,
    externalMessageId: message.externalMessageId,
    authorExternalId: message.authorExternalId,
    authorDisplayName: message.authorDisplayName,
    sentAt: message.sentAt,
    providerMetadata: message.providerMetadata,
    createdAt: message.createdAt,
  };
}

function serializeEngagementAction(action: EngagementAction): Record<string, unknown> {
  return {
    id: action.id,
    workspaceId: action.workspaceId,
    socialAccountId: action.socialAccountId,
    threadId: action.threadId,
    messageId: action.messageId,
    actionType: action.actionType,
    targetPostId: action.targetPostId,
    actorId: action.actorId,
    externalActionId: action.externalActionId,
    status: action.status,
    metadata: action.metadata,
    performedAt: action.performedAt,
    createdAt: action.createdAt,
  };
}

interface RelatedPostSummary {
  id: string;
  platform: string;
  status: string;
  platformPostId: string | null;
  contentText: string | null;
  createdAt: Date;
  publishedAt: Date | null;
}

function collectRelatedPlatformPostIds(
  thread: ConversationThread,
  messages: Message[],
): {
  entryType: string | null;
  conversationId: string | null;
  rootPostId: string | null;
  focusPostId: string | null;
  replyToPostId: string | null;
  platformPostIds: string[];
} {
  const ids = new Set<string>();
  const threadMeta = thread.providerMetadata?.x;

  const addId = (value: string | null | undefined) => {
    if (typeof value === "string" && value.length > 0) {
      ids.add(value);
    }
  };

  addId(threadMeta?.rootPostId);
  addId(threadMeta?.focusPostId);
  addId(threadMeta?.replyToPostId);

  for (const message of messages) {
    const meta = message.providerMetadata?.x;
    addId(meta?.postId);
    addId(meta?.replyToPostId);
  }

  return {
    entryType: threadMeta?.entryType ?? null,
    conversationId: threadMeta?.conversationId ?? null,
    rootPostId: threadMeta?.rootPostId ?? null,
    focusPostId: threadMeta?.focusPostId ?? null,
    replyToPostId: threadMeta?.replyToPostId ?? null,
    platformPostIds: [...ids],
  };
}

async function loadRelatedPosts(
  db: AppVariables["db"],
  workspaceId: string,
  platform: Platform,
  platformPostIds: string[],
): Promise<RelatedPostSummary[]> {
  const ids = platformPostIds.filter((value) => value.length > 0);
  if (ids.length === 0) {
    return [];
  }

  const rows = await db
    .select({
      id: posts.id,
      platform: posts.platform,
      status: posts.status,
      platformPostId: posts.platformPostId,
      contentText: posts.contentText,
      createdAt: posts.createdAt,
      publishedAt: posts.publishedAt,
    })
    .from(posts)
    .where(
      and(
        eq(posts.workspaceId, workspaceId),
        eq(posts.platform, platform),
        inArray(posts.platformPostId, ids),
      ),
    );

  const order = new Map(ids.map((id, index) => [id, index]));
  return rows.sort((a, b) => {
    const aIndex = order.get(a.platformPostId ?? "") ?? Number.MAX_SAFE_INTEGER;
    const bIndex = order.get(b.platformPostId ?? "") ?? Number.MAX_SAFE_INTEGER;
    return aIndex - bIndex;
  });
}

function parseIntOrUndefined(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isNaN(n) ? undefined : n;
}

function hasMediaAttachments(
  contentMedia: MediaAttachment[] | null | undefined,
): contentMedia is MediaAttachment[] {
  return Array.isArray(contentMedia) && contentMedia.length > 0;
}

function buildDepsFromContext(c: {
  get<K extends keyof AppVariables>(key: K): AppVariables[K];
}): InboxUsecaseDeps {
  const deps = buildDeps(c.get("db"));
  return {
    ...deps,
    usageRepo: c.get("usageRepo"),
  };
}

function buildApprovalDeps(db: AppVariables["db"]): ApprovalUsecaseDeps {
  return {
    approvalRepo: new DrizzleApprovalRepository(db),
    auditRepo: new DrizzleAuditLogRepository(db),
  };
}

// ───────────────────────────────────────────
// GET /api/inbox  -- スレッド一覧
// ───────────────────────────────────────────
inbox.get("/", requirePermission("inbox:read"), async (c) => {
  const actor = c.get("actor");
  const deps = buildDepsFromContext(c);

  const platformQ = c.req.query("platform");
  const statusQ = c.req.query("status");
  const limitQ = c.req.query("limit");
  const offsetQ = c.req.query("offset");

  if (platformQ && !PLATFORMS.includes(platformQ as Platform)) {
    throw new ValidationError(
      `Invalid platform: ${platformQ}. Must be one of: ${PLATFORMS.join(", ")}`,
    );
  }
  if (statusQ && !THREAD_STATUSES.includes(statusQ as ThreadStatus)) {
    throw new ValidationError(
      `Invalid status: ${statusQ}. Must be one of: ${THREAD_STATUSES.join(", ")}`,
    );
  }

  const result = await listThreads(deps, actor.workspaceId, {
    platform: platformQ as Platform | undefined,
    status: statusQ as ThreadStatus | undefined,
    limit: parseIntOrUndefined(limitQ),
    offset: parseIntOrUndefined(offsetQ),
  });

  return c.json({
    data: result.data.map(serializeThread),
    meta: result.meta,
  });
});

// ───────────────────────────────────────────
// GET /api/inbox/:threadId  -- スレッド詳細 + メッセージ
// ───────────────────────────────────────────
inbox.get("/:threadId", requirePermission("inbox:read"), async (c) => {
  const actor = c.get("actor");
  const deps = buildDepsFromContext(c);
  const db = c.get("db");
  const threadId = c.req.param("threadId");

  const limit = parseIntOrUndefined(c.req.query("limit"));
  const offset = parseIntOrUndefined(c.req.query("offset"));

  const result = await getThread(deps, actor.workspaceId, threadId, { limit, offset });
  const context = collectRelatedPlatformPostIds(result.thread, result.messages);
  const relatedPosts = await loadRelatedPosts(
    db,
    actor.workspaceId,
    result.thread.platform,
    context.platformPostIds,
  );

  return c.json({
    data: {
      thread: serializeThread(result.thread),
      messages: result.messages.map(serializeMessage),
      engagementActions: result.engagementActions.map(serializeEngagementAction),
      context: {
        entryType: context.entryType,
        conversationId: context.conversationId,
        rootPostId: context.rootPostId,
        focusPostId: context.focusPostId,
        replyToPostId: context.replyToPostId,
        relatedPosts,
      },
    },
  });
});

// ───────────────────────────────────────────
// POST /api/inbox/:threadId/actions  -- X reply 操作 (like/repost)
// ───────────────────────────────────────────
inbox.post("/:threadId/actions", requirePermission("inbox:reply"), async (c) => {
  const actor = c.get("actor");
  const deps = buildDepsFromContext(c);
  const threadId = c.req.param("threadId");

  const body = await c.req.json<{
    actionType?: string;
    targetMessageId?: string | null;
    targetPostId?: string | null;
  }>();

  if (body.actionType !== "like" && body.actionType !== "repost") {
    throw new ValidationError("actionType must be one of: like, repost");
  }

  const result = await performInboxEngagementAction(deps, {
    workspaceId: actor.workspaceId,
    threadId,
    actionType: body.actionType as InboxEngagementActionType,
    actorId: actor.id,
    targetMessageId: body.targetMessageId ?? null,
    targetPostId: body.targetPostId ?? null,
  });

  return c.json(
    {
      data: {
        action: serializeEngagementAction(result.action),
        created: result.created,
      },
    },
    result.created ? 201 : 200,
  );
});

// ───────────────────────────────────────────
// POST /api/inbox/:threadId/reply  -- 返信送信
// ───────────────────────────────────────────
inbox.post("/:threadId/reply", requirePermission("inbox:reply"), async (c) => {
  const actor = c.get("actor");
  const db = c.get("db");
  const deps = buildDepsFromContext(c);
  const threadId = c.req.param("threadId");

  const body = await c.req.json<{
    contentText?: string;
    contentMedia?: MediaAttachment[] | null;
  }>();

  const contentText = typeof body.contentText === "string" ? body.contentText : "";
  const contentMedia = body.contentMedia ?? null;

  if (contentText.trim().length === 0 && !hasMediaAttachments(contentMedia)) {
    throw new ValidationError("contentText or contentMedia is required");
  }

  const thread = await getThread(deps, actor.workspaceId, threadId, { limit: 1, offset: 0 });
  const needsApproval = requiresApproval("inbox:reply", actor.role, {
    platform: thread.thread.platform,
  });

  if (needsApproval) {
    const approvalDeps = buildApprovalDeps(db);
    const approval = await createApprovalRequest(approvalDeps, {
      workspaceId: actor.workspaceId,
      resourceType: "inbox_reply",
      resourceId: threadId,
      payload: {
        contentText,
        contentMedia,
      },
      requestedBy: actor.id,
      requestedByType: actor.type === "agent" ? "agent" : "user",
      reason: `${actor.role} requested ${thread.thread.platform} inbox reply`,
    });

    return c.json(
      {
        data: {
          threadId,
          status: "pending_approval",
          contentText,
        },
        meta: {
          requiresApproval: true,
          approvalId: approval.id,
        },
      },
      202,
    );
  }

  const result = await sendInboxReply(deps, {
    workspaceId: actor.workspaceId,
    threadId,
    contentText,
    contentMedia,
    actorId: actor.id,
  });

  return c.json(
    {
      data: {
        message: serializeMessage(result.message),
        externalMessageId: result.externalMessageId,
      },
    },
    201,
  );
});

// ───────────────────────────────────────────
// POST /api/inbox/sync  -- Provider から inbox を同期
// ───────────────────────────────────────────
inbox.post("/sync", requirePermission("inbox:read"), async (c) => {
  const actor = c.get("actor");
  const deps = buildDepsFromContext(c);

  const body = await c.req.json<{
    socialAccountId?: string;
    limit?: number;
    cursor?: string;
  }>();

  if (!body.socialAccountId || typeof body.socialAccountId !== "string") {
    throw new ValidationError("socialAccountId is required");
  }

  const result = await syncInboxFromProvider(deps, {
    workspaceId: actor.workspaceId,
    socialAccountId: body.socialAccountId,
    actorId: actor.id,
    limit: typeof body.limit === "number" ? body.limit : undefined,
    cursor: typeof body.cursor === "string" ? body.cursor : undefined,
  });

  return c.json({
    data: result,
  });
});

export { inbox };
