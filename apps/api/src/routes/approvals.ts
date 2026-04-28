/**
 * 承認フロールート
 *
 * Task 6002: 承認リクエストの一覧/承認/却下 API。
 * design.md セクション 4.2（承認エンドポイント）に準拠。
 *
 * RBAC:
 *   GET /api/approvals           -> approval:review (admin 以上)
 *   POST /api/approvals/:id/approve -> approval:manage (admin 以上)
 *   POST /api/approvals/:id/reject  -> approval:manage (admin 以上)
 */
import { Hono } from "hono";
import {
  listApprovals,
  approveRequest,
  rejectRequest,
  countPendingApprovals,
  publishPost,
  sendInboxReply,
  ValidationError,
  type ApprovalExecutor,
  type ApprovalStatus,
  type ApprovalUsecaseDeps,
  type InboxUsecaseDeps,
  type MediaAttachment,
  type PostUsecaseDeps,
} from "@sns-agent/core";
import {
  DrizzleApprovalRepository,
  DrizzleConversationRepository,
  DrizzleAuditLogRepository,
  DrizzlePostRepository,
  DrizzleAccountRepository,
  DrizzleMessageRepository,
  DrizzleUsageRepository,
} from "@sns-agent/db";
import { requirePermission } from "../middleware/rbac.js";
import { getProviderRegistry } from "../providers.js";
import type { AppVariables } from "../types.js";

const approvals = new Hono<{ Variables: AppVariables }>();

// ───────────────────────────────────────────
// 依存注入ヘルパー
// ───────────────────────────────────────────

function buildPostDeps(db: AppVariables["db"]): PostUsecaseDeps {
  const encryptionKey =
    process.env.ENCRYPTION_KEY ||
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  return {
    postRepo: new DrizzlePostRepository(db),
    accountRepo: new DrizzleAccountRepository(db),
    providers: getProviderRegistry().getAll(),
    encryptionKey,
  };
}

function buildInboxDeps(db: AppVariables["db"]): InboxUsecaseDeps {
  const encryptionKey =
    process.env.ENCRYPTION_KEY ||
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  return {
    conversationRepo: new DrizzleConversationRepository(db),
    messageRepo: new DrizzleMessageRepository(db),
    accountRepo: new DrizzleAccountRepository(db),
    usageRepo: new DrizzleUsageRepository(db),
    providers: getProviderRegistry().getAll(),
    encryptionKey,
  };
}

/**
 * 承認後の元操作を実行する executors マップを構築する。
 * v1 では post の publish のみ対応。
 */
function buildApprovalDeps(db: AppVariables["db"]): ApprovalUsecaseDeps {
  const postDeps = buildPostDeps(db);
  const inboxDeps = buildInboxDeps(db);

  // Post は承認待ちで status='scheduled' になっているため、
  // publishPost (draft 限定) を呼ぶ前に draft に戻してから公開する。
  const postExecutor: ApprovalExecutor = async (postId, ctx) => {
    const current = await postDeps.postRepo.findById(postId);
    if (!current || current.workspaceId !== ctx.workspaceId) {
      throw new Error(`Post not found for approval execution: ${postId}`);
    }
    if (current.status === "scheduled" || current.status === "draft") {
      if (current.status === "scheduled") {
        await postDeps.postRepo.update(postId, { status: "draft" });
      }
      return publishPost(postDeps, ctx.workspaceId, postId);
    }
    throw new Error(`Cannot publish post ${postId} from status ${current.status} after approval`);
  };

  const inboxReplyExecutor: ApprovalExecutor = async (threadId, ctx, request) => {
    const payload = (request.payload ?? {}) as {
      contentText?: unknown;
      contentMedia?: unknown;
    };
    const contentText = typeof payload.contentText === "string" ? payload.contentText : "";
    const contentMedia = Array.isArray(payload.contentMedia)
      ? (payload.contentMedia as MediaAttachment[])
      : null;

    if (contentText.trim().length === 0 && (!contentMedia || contentMedia.length === 0)) {
      throw new Error(`Approval payload missing inbox reply content: ${request.id}`);
    }

    return sendInboxReply(inboxDeps, {
      workspaceId: ctx.workspaceId,
      threadId,
      contentText,
      contentMedia,
      actorId: ctx.approvedBy,
    });
  };

  const executors = new Map<string, ApprovalExecutor>();
  executors.set("post", postExecutor);
  executors.set("inbox_reply", inboxReplyExecutor);

  return {
    approvalRepo: new DrizzleApprovalRepository(db),
    auditRepo: new DrizzleAuditLogRepository(db),
    executors,
  };
}

// ───────────────────────────────────────────
// ヘルパー: シリアライズ
// ───────────────────────────────────────────

function serializeApproval(req: {
  id: string;
  workspaceId: string;
  resourceType: string;
  resourceId: string;
  payload: unknown | null;
  requestedBy: string;
  requestedAt: Date;
  status: string;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  reason: string | null;
}): Record<string, unknown> {
  return {
    id: req.id,
    workspaceId: req.workspaceId,
    resourceType: req.resourceType,
    resourceId: req.resourceId,
    payload: req.payload,
    requestedBy: req.requestedBy,
    requestedAt: req.requestedAt instanceof Date ? req.requestedAt.toISOString() : req.requestedAt,
    status: req.status,
    reviewedBy: req.reviewedBy,
    reviewedAt: req.reviewedAt instanceof Date ? req.reviewedAt.toISOString() : req.reviewedAt,
    reason: req.reason,
  };
}

// ───────────────────────────────────────────
// GET /api/approvals - 承認リクエスト一覧
// ───────────────────────────────────────────

const VALID_STATUSES: ApprovalStatus[] = ["pending", "approved", "rejected", "expired"];

approvals.get("/", requirePermission("approval:review"), async (c) => {
  const actor = c.get("actor");
  const db = c.get("db");
  const deps = buildApprovalDeps(db);

  const query = c.req.query();
  const statusQ = query.status;
  if (statusQ && !VALID_STATUSES.includes(statusQ as ApprovalStatus)) {
    throw new ValidationError(
      `Invalid status: ${statusQ}. Must be one of: ${VALID_STATUSES.join(", ")}`,
    );
  }

  const status = (statusQ as ApprovalStatus | undefined) ?? "pending";

  const page = Math.max(1, Number.parseInt(query.page ?? "1", 10) || 1);
  const rawLimit = Number.parseInt(query.limit ?? "50", 10) || 50;
  const limit = Math.max(1, Math.min(200, rawLimit));

  const result = await listApprovals(deps, {
    workspaceId: actor.workspaceId,
    filters: {
      status,
      resourceType: query.resourceType,
      requestedBy: query.requestedBy,
    },
    page,
    limit,
  });

  // 追加メタ: pending 件数（Header バッジ等で使用）
  const pendingCount =
    status === "pending" ? result.meta.total : await countPendingApprovals(deps, actor.workspaceId);

  return c.json({
    data: result.data.map(serializeApproval),
    meta: {
      ...result.meta,
      pendingCount,
      status,
    },
  });
});

// ───────────────────────────────────────────
// GET /api/approvals/pending-count - 承認待ち件数のみ
// ───────────────────────────────────────────

approvals.get("/pending-count", requirePermission("approval:review"), async (c) => {
  const actor = c.get("actor");
  const db = c.get("db");
  const deps = buildApprovalDeps(db);
  const count = await countPendingApprovals(deps, actor.workspaceId);
  return c.json({ data: { pendingCount: count } });
});

// ───────────────────────────────────────────
// POST /api/approvals/:id/approve
// ───────────────────────────────────────────

approvals.post("/:id/approve", requirePermission("approval:manage"), async (c) => {
  const actor = c.get("actor");
  const db = c.get("db");
  const deps = buildApprovalDeps(db);
  const id = c.req.param("id");

  // 他ワークスペースの承認を誤って操作しないよう、事前にロード
  const existing = await deps.approvalRepo.findById(id);
  if (!existing || existing.workspaceId !== actor.workspaceId) {
    return c.json(
      {
        error: {
          code: "NOT_FOUND",
          message: `ApprovalRequest not found: ${id}`,
        },
      },
      404,
    );
  }

  const result = await approveRequest(deps, {
    requestId: id,
    reviewerId: actor.id,
    reviewerType: actor.type === "agent" ? "agent" : "user",
  });

  return c.json({
    data: {
      request: serializeApproval(result.request),
      executorMissing: result.executorMissing,
      executionError: result.executionError,
    },
  });
});

// ───────────────────────────────────────────
// POST /api/approvals/:id/reject
// ───────────────────────────────────────────

approvals.post("/:id/reject", requirePermission("approval:manage"), async (c) => {
  const actor = c.get("actor");
  const db = c.get("db");
  const deps = buildApprovalDeps(db);
  const id = c.req.param("id");

  const existing = await deps.approvalRepo.findById(id);
  if (!existing || existing.workspaceId !== actor.workspaceId) {
    return c.json(
      {
        error: {
          code: "NOT_FOUND",
          message: `ApprovalRequest not found: ${id}`,
        },
      },
      404,
    );
  }

  let body: { reason?: string | null } = {};
  try {
    body = await c.req.json<{ reason?: string | null }>();
  } catch {
    // empty body OK
  }

  const updated = await rejectRequest(deps, {
    requestId: id,
    reviewerId: actor.id,
    reviewerType: actor.type === "agent" ? "agent" : "user",
    reason: body?.reason ?? null,
  });

  // 却下時は対象 Post を draft に戻す（他の resourceType は何もしない）
  if (existing.resourceType === "post") {
    const postRepo = new DrizzlePostRepository(db);
    const post = await postRepo.findById(existing.resourceId);
    if (post && post.workspaceId === actor.workspaceId && post.status === "scheduled") {
      await postRepo.update(post.id, { status: "draft" });
    }
  }

  return c.json({ data: serializeApproval(updated) });
});

export { approvals };
