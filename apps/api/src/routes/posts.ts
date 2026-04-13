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
  publishPostChecked,
  deletePost,
  listPosts,
  getPost,
  ValidationError,
  requiresApproval,
  createApprovalRequest,
} from "@sns-agent/core";
import type {
  MediaAttachment,
  Post,
  PostProviderMetadata,
  PostListItem,
  PostUsecaseDeps,
  ApprovalUsecaseDeps,
  PostOrderBy,
  BudgetEvaluation,
} from "@sns-agent/core";
import {
  DrizzlePostRepository,
  DrizzleAccountRepository,
  DrizzleUsageRepository,
  DrizzleApprovalRepository,
  DrizzleAuditLogRepository,
  DrizzleScheduledJobRepository,
  DrizzleBudgetPolicyRepository,
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
    scheduledJobRepo: new DrizzleScheduledJobRepository(db),
    budgetPolicyRepo: new DrizzleBudgetPolicyRepository(db),
    approvalRepo: new DrizzleApprovalRepository(db),
    auditRepo: new DrizzleAuditLogRepository(db),
  };
}

function serializeBudgetEvaluation(ev: BudgetEvaluation | null): Record<string, unknown> | null {
  if (!ev) return null;
  return {
    allowed: ev.allowed,
    action: ev.action,
    consumed: ev.consumed,
    projected: ev.projected,
    limit: ev.limit,
    percentage: ev.percentage,
    warning: ev.warning,
    reason: ev.reason,
    policyId: ev.matchedPolicy?.id ?? null,
    scopeType: ev.matchedPolicy?.scopeType ?? null,
    scopeValue: ev.matchedPolicy?.scopeValue ?? null,
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
    providerMetadata: post.providerMetadata ?? null,
    platformPostId: post.platformPostId,
    validationResult: post.validationResult,
    idempotencyKey: post.idempotencyKey,
    createdBy: post.createdBy,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    publishedAt: post.publishedAt,
  };
}

/**
 * PostListItem を API レスポンス形式に整形する。
 * 基本の Post フィールドに加え、socialAccount / schedule を含める。
 */
function serializePostListItem(item: PostListItem): Record<string, unknown> {
  return {
    ...serializePost(item),
    socialAccount: item.socialAccount,
    schedule: item.schedule,
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

/**
 * カンマ区切りもしくは同一キーの複数出現に対応した配列パーサ。
 * `?platform=x,line` と `?platform=x&platform=line` の両方をサポート。
 */
function parseListParam(values: string[] | undefined): string[] | undefined {
  if (!values || values.length === 0) return undefined;
  const out: string[] = [];
  for (const v of values) {
    for (const item of v.split(",")) {
      const trimmed = item.trim();
      if (trimmed) out.push(trimmed);
    }
  }
  return out.length > 0 ? out : undefined;
}

const ORDER_BY_VALUES = ["createdAt", "publishedAt", "scheduledAt"] as const;
function parseOrderBy(value: string | undefined): PostOrderBy | undefined {
  if (!value) return undefined;
  return (ORDER_BY_VALUES as readonly string[]).includes(value)
    ? (value as PostOrderBy)
    : undefined;
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

  //
  // 対応クエリパラメータ:
  // - platform: "x" | "line" | "instagram"。カンマ区切り or 複数出現で OR 条件
  // - status: draft | scheduled | publishing | published | failed | deleted。同上
  // - from, to: ISO 8601 日付。created_at の範囲
  // - search: contentText の部分一致検索
  // - orderBy: createdAt (default) | publishedAt | scheduledAt
  // - page: 1-based (default 1)
  // - limit: default 20, max 100
  //
  const platformValues = parseListParam(c.req.queries("platform"));
  const statusValues = parseListParam(c.req.queries("status"));
  const fromQ = c.req.query("from");
  const toQ = c.req.query("to");
  const searchQ = c.req.query("search");
  const orderByQ = c.req.query("orderBy");
  const pageQ = c.req.query("page");
  const limitQ = c.req.query("limit");

  // バリデーション: platform / status の値チェック
  if (platformValues) {
    for (const p of platformValues) {
      if (!PLATFORMS.includes(p as Platform)) {
        throw new ValidationError(
          `Invalid platform: ${p}. Must be one of: ${PLATFORMS.join(", ")}`,
        );
      }
    }
  }
  if (statusValues) {
    for (const s of statusValues) {
      if (!POST_STATUSES.includes(s as Post["status"])) {
        throw new ValidationError(
          `Invalid status: ${s}. Must be one of: ${POST_STATUSES.join(", ")}`,
        );
      }
    }
  }

  // orderBy バリデーション
  if (orderByQ && !parseOrderBy(orderByQ)) {
    throw new ValidationError(
      `Invalid orderBy: ${orderByQ}. Must be one of: ${ORDER_BY_VALUES.join(", ")}`,
    );
  }

  // limit 上限チェック
  const parsedLimit = parseIntOrUndefined(limitQ);
  if (parsedLimit !== undefined && parsedLimit > 100) {
    throw new ValidationError("limit must be 100 or less");
  }

  const result = await listPosts(deps, actor.workspaceId, {
    platforms: platformValues as Platform[] | undefined,
    statuses: statusValues as Array<Post["status"]> | undefined,
    from: parseDateOrUndefined(fromQ),
    to: parseDateOrUndefined(toQ),
    search: searchQ,
    orderBy: parseOrderBy(orderByQ),
    page: parseIntOrUndefined(pageQ),
    limit: parsedLimit,
  });

  return c.json({
    data: result.data.map(serializePostListItem),
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
    providerMetadata?: PostProviderMetadata | null;
    publishNow?: boolean;
    idempotencyKey?: string | null;
  }>();

  if (!body.socialAccountId) {
    throw new ValidationError("socialAccountId is required");
  }
  const hasQuoteOnly =
    typeof body.providerMetadata?.x?.quotePostId === "string" &&
    body.providerMetadata.x.quotePostId.trim().length > 0;
  if (body.contentText === undefined && !body.contentMedia && !hasQuoteOnly) {
    throw new ValidationError(
      "contentText, contentMedia, or providerMetadata.x.quotePostId is required",
    );
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
    providerMetadata: body.providerMetadata ?? null,
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
    providerMetadata?: PostProviderMetadata | null;
  }>();

  const updated = await updatePost(deps, actor.workspaceId, id, {
    contentText: body.contentText,
    contentMedia: body.contentMedia,
    providerMetadata: body.providerMetadata,
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

  const result = await publishPostChecked(deps, actor.workspaceId, id, {
    requestedBy: actor.id,
  });

  // 予算 require-approval で承認リクエストが作成された場合
  if (result.approvalRequestId) {
    return c.json(
      {
        data: serializePost(result.post),
        meta: {
          requiresApproval: true,
          approvalId: result.approvalRequestId,
          budget: serializeBudgetEvaluation(result.budgetEvaluation),
        },
      },
      202,
    );
  }

  return c.json({
    data: serializePost(result.post),
    meta: {
      requiresApproval: false,
      budget: serializeBudgetEvaluation(result.budgetEvaluation),
    },
  });
});

export { posts };
