/**
 * 予約管理ルート
 *
 * Task 2005: 予約の作成・更新・キャンセル、一覧、詳細エンドポイント。
 * design.md セクション 4.2 に準拠。
 *
 * RBAC:
 * - GET   /api/schedules          → schedule:read
 * - POST  /api/schedules          → schedule:create
 * - POST  /api/schedules/run-due  → schedule:update
 * - GET   /api/schedules/:id      → schedule:read
 * - PATCH /api/schedules/:id      → schedule:update
 * - DELETE /api/schedules/:id     → schedule:delete
 */
import { Hono } from "hono";
import { JOB_STATUSES } from "@sns-agent/config";
import type { JobStatus } from "@sns-agent/config";
import {
  schedulePost,
  updateSchedule,
  cancelSchedule,
  listSchedules,
  getSchedule,
  getScheduleOperationalView,
  dispatchDueJobs,
  ValidationError,
} from "@sns-agent/core";
import type {
  DispatchDueJobsResult,
  ScheduledJob,
  ScheduleExecutionLog,
  ScheduleNotificationTarget,
  ScheduleOperationalView,
  ScheduleUsecaseDeps,
} from "@sns-agent/core";
import {
  DrizzleAuditLogRepository,
  DrizzleScheduledJobRepository,
  DrizzlePostRepository,
  DrizzleAccountRepository,
  DrizzleUsageRepository,
} from "@sns-agent/db";
import { requirePermission } from "../middleware/rbac.js";
import { getProviderRegistry } from "../providers.js";
import type { AppVariables } from "../types.js";

const schedules = new Hono<{ Variables: AppVariables }>();

// ───────────────────────────────────────────
// ヘルパー: 依存注入
// ───────────────────────────────────────────

function buildDeps(db: AppVariables["db"]): ScheduleUsecaseDeps {
  const encryptionKey =
    process.env.ENCRYPTION_KEY ||
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  const postRepo = new DrizzlePostRepository(db);
  const accountRepo = new DrizzleAccountRepository(db);
  const scheduledJobRepo = new DrizzleScheduledJobRepository(db);
  const providers = getProviderRegistry().getAll();

  const usageRepo = new DrizzleUsageRepository(db);

  return {
    scheduledJobRepo,
    postRepo,
    auditRepo: new DrizzleAuditLogRepository(db),
    postUsecaseDeps: {
      postRepo,
      accountRepo,
      providers,
      encryptionKey,
      usageRepo,
    },
  };
}

// ───────────────────────────────────────────
// ヘルパー: シリアライズ
// ───────────────────────────────────────────

function serializeJob(job: ScheduledJob): Record<string, unknown> {
  return {
    id: job.id,
    workspaceId: job.workspaceId,
    postId: job.postId,
    scheduledAt: job.scheduledAt,
    status: job.status,
    lockedAt: job.lockedAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    attemptCount: job.attemptCount,
    maxAttempts: job.maxAttempts,
    lastError: job.lastError,
    nextRetryAt: job.nextRetryAt,
    createdAt: job.createdAt,
  };
}

function serializeDispatchResult(result: DispatchDueJobsResult): Record<string, unknown> {
  return {
    processedAt: result.processedAt,
    scanned: result.scanned,
    processed: result.processed,
    skipped: result.skipped,
    succeeded: result.succeeded,
    retrying: result.retrying,
    failed: result.failed,
    jobs: result.jobs,
  };
}

function serializeNotificationTarget(
  target: ScheduleNotificationTarget,
): Record<string, unknown> {
  return {
    type: target.type,
    actorId: target.actorId,
    label: target.label,
    reason: target.reason,
  };
}

function serializeExecutionLog(log: ScheduleExecutionLog): Record<string, unknown> {
  return {
    id: log.id,
    action: log.action,
    status: log.status,
    createdAt: log.createdAt,
    actorId: log.actorId,
    actorType: log.actorType,
    message: log.message,
    error: log.error,
    willRetry: log.willRetry,
    retryable: log.retryable,
    retryRule: log.retryRule,
    classificationReason: log.classificationReason,
    attemptCount: log.attemptCount,
    maxAttempts: log.maxAttempts,
    nextRetryAt: log.nextRetryAt,
    notificationTarget: log.notificationTarget
      ? serializeNotificationTarget(log.notificationTarget)
      : null,
  };
}

function serializeOperationalView(detail: ScheduleOperationalView): Record<string, unknown> {
  return {
    post: detail.post,
    retryPolicy: detail.retryPolicy,
    notificationTarget: serializeNotificationTarget(detail.notificationTarget),
    latestExecution: detail.latestExecution ? serializeExecutionLog(detail.latestExecution) : null,
    executionLogs: detail.executionLogs.map(serializeExecutionLog),
    recommendedAction: detail.recommendedAction,
  };
}

function parseDateOrUndefined(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function parseIntOrUndefined(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isNaN(n) ? undefined : n;
}

function parseDateStrict(value: unknown, field: string): Date {
  if (typeof value !== "string" || !value) {
    throw new ValidationError(`${field} is required (ISO 8601 string)`);
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new ValidationError(`${field} is not a valid date: ${value}`);
  }
  return d;
}

// ───────────────────────────────────────────
// GET /api/schedules - 一覧
// ───────────────────────────────────────────
schedules.get("/", requirePermission("schedule:read"), async (c) => {
  const actor = c.get("actor");
  const db = c.get("db");
  const deps = buildDeps(db);

  const statusQ = c.req.query("status");
  const postIdQ = c.req.query("postId");
  const fromQ = c.req.query("from");
  const toQ = c.req.query("to");
  const limitQ = c.req.query("limit");

  if (statusQ && !JOB_STATUSES.includes(statusQ as JobStatus)) {
    throw new ValidationError(
      `Invalid status: ${statusQ}. Must be one of: ${JOB_STATUSES.join(", ")}`,
    );
  }

  const jobs = await listSchedules(deps, actor.workspaceId, {
    status: statusQ as JobStatus | undefined,
    postId: postIdQ,
    from: parseDateOrUndefined(fromQ),
    to: parseDateOrUndefined(toQ),
    limit: parseIntOrUndefined(limitQ),
  });

  return c.json({
    data: jobs.map(serializeJob),
    meta: { total: jobs.length },
  });
});

// ───────────────────────────────────────────
// POST /api/schedules - 予約作成
// ───────────────────────────────────────────
schedules.post("/", requirePermission("schedule:create"), async (c) => {
  const actor = c.get("actor");
  const db = c.get("db");
  const deps = buildDeps(db);

  const body = await c.req.json<{
    postId?: string;
    scheduledAt?: string;
    maxAttempts?: number;
  }>();

  if (!body.postId) {
    throw new ValidationError("postId is required");
  }
  const scheduledAt = parseDateStrict(body.scheduledAt, "scheduledAt");

  const job = await schedulePost(deps, {
    workspaceId: actor.workspaceId,
    postId: body.postId,
    scheduledAt,
    maxAttempts: body.maxAttempts,
  });

  return c.json({ data: serializeJob(job) }, 201);
});

// ───────────────────────────────────────────
// POST /api/schedules/run-due - 期限到来ジョブを即時実行
// ───────────────────────────────────────────
schedules.post("/run-due", requirePermission("schedule:update"), async (c) => {
  const actor = c.get("actor");
  const db = c.get("db");
  const deps = buildDeps(db);

  let body: { limit?: number } = {};
  try {
    body = await c.req.json<{ limit?: number }>();
  } catch {
    body = {};
  }

  const limit = body.limit ?? parseIntOrUndefined(c.req.query("limit"));
  if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
    throw new ValidationError("limit must be a positive integer");
  }

  const result = await dispatchDueJobs(deps, { limit });
  return c.json({
    data: serializeDispatchResult(result),
    meta: { workspaceId: actor.workspaceId },
  });
});

// ───────────────────────────────────────────
// GET /api/schedules/:id - 詳細
// ───────────────────────────────────────────
schedules.get("/:id", requirePermission("schedule:read"), async (c) => {
  const actor = c.get("actor");
  const db = c.get("db");
  const deps = buildDeps(db);
  const id = c.req.param("id");

  const job = await getSchedule(deps, actor.workspaceId, id);
  const detail = await getScheduleOperationalView(deps, actor.workspaceId, id);
  return c.json({
    data: serializeJob(job),
    detail: serializeOperationalView(detail),
  });
});

// ───────────────────────────────────────────
// PATCH /api/schedules/:id - 予約日時変更
// ───────────────────────────────────────────
schedules.patch("/:id", requirePermission("schedule:update"), async (c) => {
  const actor = c.get("actor");
  const db = c.get("db");
  const deps = buildDeps(db);
  const id = c.req.param("id");

  const body = await c.req.json<{ scheduledAt?: string }>();
  const scheduledAt = parseDateStrict(body.scheduledAt, "scheduledAt");

  const job = await updateSchedule(deps, actor.workspaceId, id, scheduledAt);
  return c.json({ data: serializeJob(job) });
});

// ───────────────────────────────────────────
// DELETE /api/schedules/:id - キャンセル
// ───────────────────────────────────────────
schedules.delete("/:id", requirePermission("schedule:delete"), async (c) => {
  const actor = c.get("actor");
  const db = c.get("db");
  const deps = buildDeps(db);
  const id = c.req.param("id");

  const job = await cancelSchedule(deps, actor.workspaceId, id);
  return c.json({ data: serializeJob(job) });
});

export { schedules };
