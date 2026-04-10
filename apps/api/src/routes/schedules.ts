/**
 * 予約管理ルート
 *
 * Task 2005: 予約の作成・更新・キャンセル、一覧、詳細エンドポイント。
 * design.md セクション 4.2 に準拠。
 *
 * RBAC:
 * - GET   /api/schedules      → post:read
 * - POST  /api/schedules      → post:publish
 * - GET   /api/schedules/:id  → post:read
 * - PATCH /api/schedules/:id  → post:publish
 * - DELETE /api/schedules/:id → post:publish
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
  ValidationError,
} from "@sns-agent/core";
import type { ScheduledJob, ScheduleUsecaseDeps } from "@sns-agent/core";
import {
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

function parseDateOrUndefined(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
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
schedules.get("/", requirePermission("post:read"), async (c) => {
  const actor = c.get("actor");
  const db = c.get("db");
  const deps = buildDeps(db);

  const statusQ = c.req.query("status");
  const postIdQ = c.req.query("postId");
  const fromQ = c.req.query("from");
  const toQ = c.req.query("to");

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
  });

  return c.json({
    data: jobs.map(serializeJob),
    meta: { total: jobs.length },
  });
});

// ───────────────────────────────────────────
// POST /api/schedules - 予約作成
// ───────────────────────────────────────────
schedules.post("/", requirePermission("post:publish"), async (c) => {
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
// GET /api/schedules/:id - 詳細
// ───────────────────────────────────────────
schedules.get("/:id", requirePermission("post:read"), async (c) => {
  const actor = c.get("actor");
  const db = c.get("db");
  const deps = buildDeps(db);
  const id = c.req.param("id");

  const job = await getSchedule(deps, actor.workspaceId, id);
  return c.json({ data: serializeJob(job) });
});

// ───────────────────────────────────────────
// PATCH /api/schedules/:id - 予約日時変更
// ───────────────────────────────────────────
schedules.patch("/:id", requirePermission("post:publish"), async (c) => {
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
schedules.delete("/:id", requirePermission("post:publish"), async (c) => {
  const actor = c.get("actor");
  const db = c.get("db");
  const deps = buildDeps(db);
  const id = c.req.param("id");

  const job = await cancelSchedule(deps, actor.workspaceId, id);
  return c.json({ data: serializeJob(job) });
});

export { schedules };
