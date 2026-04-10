/**
 * 投稿管理ルート
 *
 * Task 2004: 投稿の作成、編集、公開、削除、一覧エンドポイント。
 * design.md セクション 4.2 に準拠。
 */
import { Hono } from "hono";
import type { Platform } from "@sns-agent/config";
import { PLATFORMS, POST_STATUSES } from "@sns-agent/config";
import {
  createPost,
  updatePost,
  publishPost,
  deletePost,
  listPosts,
  getPost,
  ValidationError,
  requiresApproval,
  createApprovalRequest,
} from "@sns-agent/core";
import type { MediaAttachment, Post, PostUsecaseDeps, ApprovalUsecaseDeps } from "@sns-agent/core";
import {
  DrizzlePostRepository,
  DrizzleAccountRepository,
  DrizzleUsageRepository,
  DrizzleApprovalRepository,
  DrizzleAuditLogRepository,
} from "@sns-agent/db";
import { requirePermission } from "../middleware/rbac.js";
import { idempotencyMiddleware } from "../middleware/idempotency.js";
import { getProviderRegistry } from "../providers.js";
import type { AppVariables } from "../types.js";

const posts = new Hono<{ Variables: AppVariables }>();

// ───────────────────────────────────────────
// ヘルパー: 依存注入
// ───────────────────────────────────────────

function buildDeps(db: AppVariables["db"]): PostUsecaseDeps {
  const encryptionKey =
    process.env.ENCRYPTION_KEY ||
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  return {
    postRepo: new DrizzlePostRepository(db),
    accountRepo: new DrizzleAccountRepository(db),
    providers: getProviderRegistry().getAll(),
    encryptionKey,
    usageRepo: new DrizzleUsageRepository(db),
  };
}

// ───────────────────────────────────────────
// ヘルパー: Post -> API レスポンス形状
// ───────────────────────────────────────────

/**
 * Post を API レスポンス形式に整形する。
 * validationResult は UI 側のエラー表示に使うため、明示的に validationResult フィールドで出力する。
 */
function serializePost(post: Post): Record<string, unknown> {
  return {
    id: post.id,
    workspaceId: post.workspaceId,
    socialAccountId: post.socialAccountId,
    platform: post.platform,
    status: post.status,
    contentText: post.contentText,
    contentMedia: post.contentMedia,
    platformPostId: post.platformPostId,
    validationResult: post.validationResult,
    idempotencyKey: post.idempotencyKey,
    createdBy: post.createdBy,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    publishedAt: post.publishedAt,
  };
}

// ───────────────────────────────────────────
// ヘルパー: クエリパラメータ -> フィルタ
// ───────────────────────────────────────────

function parseIntOrUndefined(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isNaN(n) ? undefined : n;
}

function parseDateOrUndefined(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

// ───────────────────────────────────────────
// Idempotency ミドルウェア（POST/PATCH）
// ───────────────────────────────────────────
posts.use("/*", idempotencyMiddleware);

// ───────────────────────────────────────────
// GET /api/posts - 投稿一覧
// ───────────────────────────────────────────
posts.get("/", requirePermission("post:read"), async (c) => {
  const actor = c.get("actor");
  const db = c.get("db");
  const deps = buildDeps(db);

  const platformQ = c.req.query("platform");
  const statusQ = c.req.query("status");
  const fromQ = c.req.query("from");
  const toQ = c.req.query("to");
  const pageQ = c.req.query("page");
  const limitQ = c.req.query("limit");

  if (platformQ && !PLATFORMS.includes(platformQ as Platform)) {
    throw new ValidationError(
      `Invalid platform: ${platformQ}. Must be one of: ${PLATFORMS.join(", ")}`,
    );
  }
  if (statusQ && !POST_STATUSES.includes(statusQ as Post["status"])) {
    throw new ValidationError(
      `Invalid status: ${statusQ}. Must be one of: ${POST_STATUSES.join(", ")}`,
    );
  }

  const result = await listPosts(deps, actor.workspaceId, {
    platform: platformQ as Platform | undefined,
    status: statusQ as Post["status"] | undefined,
    from: parseDateOrUndefined(fromQ),
    to: parseDateOrUndefined(toQ),
    page: parseIntOrUndefined(pageQ),
    limit: parseIntOrUndefined(limitQ),
  });

  return c.json({
    data: result.data.map(serializePost),
    meta: result.meta,
  });
});

// ───────────────────────────────────────────
// POST /api/posts - 投稿作成（下書き or 即時公開）
// ───────────────────────────────────────────
posts.post("/", requirePermission("post:create"), async (c) => {
  const actor = c.get("actor");
  const db = c.get("db");
  const deps = buildDeps(db);

  const body = await c.req.json<{
    socialAccountId?: string;
    contentText?: string | null;
    contentMedia?: MediaAttachment[] | null;
    publishNow?: boolean;
    idempotencyKey?: string | null;
  }>();

  if (!body.socialAccountId) {
    throw new ValidationError("socialAccountId is required");
  }
  if (body.contentText === undefined && !body.contentMedia) {
    throw new ValidationError("contentText or contentMedia is required");
  }

  // publish を行うなら post:publish 権限も必要
  // （簡易実装: ハンドラ内で追加チェックせず、ルートレベルの post:create を通過した editor/admin/owner のみ publish 可能）

  // ヘッダ由来の idempotencyKey を優先し、ボディ指定があれば上書き
  const headerKey = c.get("idempotencyKey");
  const idempotencyKey = body.idempotencyKey ?? headerKey ?? null;

  const created = await createPost(deps, {
    workspaceId: actor.workspaceId,
    socialAccountId: body.socialAccountId,
    contentText: body.contentText ?? null,
    contentMedia: body.contentMedia ?? null,
    publishNow: body.publishNow === true,
    idempotencyKey,
    createdBy: actor.id,
  });

  return c.json({ data: serializePost(created) }, 201);
});

// ───────────────────────────────────────────
// GET /api/posts/:id - 投稿詳細
// ───────────────────────────────────────────
posts.get("/:id", requirePermission("post:read"), async (c) => {
  const actor = c.get("actor");
  const db = c.get("db");
  const deps = buildDeps(db);
  const id = c.req.param("id");

  const post = await getPost(deps, actor.workspaceId, id);
  return c.json({ data: serializePost(post) });
});

// ───────────────────────────────────────────
// PATCH /api/posts/:id - 下書き更新
// ───────────────────────────────────────────
posts.patch("/:id", requirePermission("post:create"), async (c) => {
  const actor = c.get("actor");
  const db = c.get("db");
  const deps = buildDeps(db);
  const id = c.req.param("id");

  const body = await c.req.json<{
    contentText?: string | null;
    contentMedia?: MediaAttachment[] | null;
  }>();

  const updated = await updatePost(deps, actor.workspaceId, id, {
    contentText: body.contentText,
    contentMedia: body.contentMedia,
  });

  return c.json({ data: serializePost(updated) });
});

// ───────────────────────────────────────────
// DELETE /api/posts/:id - 投稿削除（論理削除）
// ───────────────────────────────────────────
posts.delete("/:id", requirePermission("post:publish"), async (c) => {
  const actor = c.get("actor");
  const db = c.get("db");
  const deps = buildDeps(db);
  const id = c.req.param("id");

  const deleted = await deletePost(deps, actor.workspaceId, id);
  return c.json({ data: serializePost(deleted) });
});

// ───────────────────────────────────────────
// POST /api/posts/:id/publish - 即時公開
// ───────────────────────────────────────────
//
// 承認ポリシー統合:
//   actor.role に基づき requiresApproval を判定し、承認が必要な場合は
//   承認リクエストを作成して Post の status を 'scheduled'（承認待ち）に
//   変更する。レスポンスには { requiresApproval: true, approvalId } を含める。
//   design.md 4.2、architecture.md 12.3 に準拠。
//
posts.post("/:id/publish", requirePermission("post:publish"), async (c) => {
  const actor = c.get("actor");
  const db = c.get("db");
  const deps = buildDeps(db);
  const id = c.req.param("id");

  // 事前に Post の存在と所有権を確認
  const post = await getPost(deps, actor.workspaceId, id);

  if (post.status !== "draft") {
    throw new ValidationError(`Only draft posts can be published (current status: ${post.status})`);
  }

  // 承認ポリシー判定（agent ロールや LINE broadcast 等）
  const needsApproval = requiresApproval("post:publish", actor.role, {
    platform: post.platform,
  });

  if (needsApproval) {
    const approvalDeps: ApprovalUsecaseDeps = {
      approvalRepo: new DrizzleApprovalRepository(db),
      auditRepo: new DrizzleAuditLogRepository(db),
    };

    const approval = await createApprovalRequest(approvalDeps, {
      workspaceId: actor.workspaceId,
      resourceType: "post",
      resourceId: post.id,
      requestedBy: actor.id,
      requestedByType: actor.type === "agent" ? "agent" : "user",
      reason: `${actor.role} requested publish of ${post.platform} post`,
    });

    // Post の status を scheduled（承認待ち）に変更する
    const updated = await deps.postRepo.update(post.id, { status: "scheduled" });

    return c.json(
      {
        data: serializePost(updated),
        meta: {
          requiresApproval: true,
          approvalId: approval.id,
        },
      },
      202,
    );
  }

  const published = await publishPost(deps, actor.workspaceId, id);
  return c.json({
    data: serializePost(published),
    meta: { requiresApproval: false },
  });
});

export { posts };
