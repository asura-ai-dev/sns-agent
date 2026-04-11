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
 *   POST /api/inbox/:threadId/reply (inbox:reply, editor 以上)
 */
import { Hono } from "hono";
import type { Platform } from "@sns-agent/config";
import { PLATFORMS } from "@sns-agent/config";
import {
  listThreads,
  getThread,
  sendInboxReply,
  ValidationError,
  type InboxUsecaseDeps,
  type ConversationThread,
  type Message,
  type ThreadStatus,
} from "@sns-agent/core";
import {
  DrizzleAccountRepository,
  DrizzleConversationRepository,
  DrizzleMessageRepository,
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
    accountRepo: new DrizzleAccountRepository(db),
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
    lastMessageAt: thread.lastMessageAt,
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
    sentAt: message.sentAt,
    createdAt: message.createdAt,
  };
}

function parseIntOrUndefined(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isNaN(n) ? undefined : n;
}

// ───────────────────────────────────────────
// GET /api/inbox  -- スレッド一覧
// ───────────────────────────────────────────
inbox.get("/", requirePermission("inbox:read"), async (c) => {
  const actor = c.get("actor");
  const db = c.get("db");
  const deps = buildDeps(db);

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
  const db = c.get("db");
  const deps = buildDeps(db);
  const threadId = c.req.param("threadId");

  const limit = parseIntOrUndefined(c.req.query("limit"));
  const offset = parseIntOrUndefined(c.req.query("offset"));

  const result = await getThread(deps, actor.workspaceId, threadId, { limit, offset });

  return c.json({
    data: {
      thread: serializeThread(result.thread),
      messages: result.messages.map(serializeMessage),
    },
  });
});

// ───────────────────────────────────────────
// POST /api/inbox/:threadId/reply  -- 返信送信
// ───────────────────────────────────────────
inbox.post("/:threadId/reply", requirePermission("inbox:reply"), async (c) => {
  const actor = c.get("actor");
  const db = c.get("db");
  const deps = buildDeps(db);
  const threadId = c.req.param("threadId");

  const body = await c.req.json<{
    contentText?: string;
  }>();

  if (!body.contentText || typeof body.contentText !== "string") {
    throw new ValidationError("contentText is required");
  }

  const result = await sendInboxReply(deps, {
    workspaceId: actor.workspaceId,
    threadId,
    contentText: body.contentText,
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

export { inbox };
