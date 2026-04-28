/**
 * 予約投稿ユースケース
 *
 * Task 2005: 予約の作成・更新・キャンセル、一覧、ジョブ実行ロジック。
 * design.md セクション 1.3（Queue / Scheduler）、3.1（scheduled_jobs）、4.2（予約）に準拠。
 *
 * ワーカーから `executeJob` を呼び出すことで、publishPost が実行される。
 * 失敗時は exponential backoff (30s / 120s / 480s) で再試行する。
 */
import type { Platform } from "@sns-agent/config";
import type { Post, ScheduledJob } from "../domain/entities.js";
import type {
  AuditLogRepository,
  PostRepository,
  ScheduledJobRepository,
} from "../interfaces/repositories.js";
import {
  AuthorizationError,
  BudgetExceededError,
  DomainError,
  NotFoundError,
  ProviderError,
  RateLimitError,
  ValidationError,
} from "../errors/domain-error.js";
import { recordAudit } from "./audit.js";
import { publishPost } from "./post.js";
import type { PostUsecaseDeps } from "./post.js";

// ───────────────────────────────────────────
// 依存注入コンテキスト
// ───────────────────────────────────────────

export interface ScheduleUsecaseDeps {
  scheduledJobRepo: ScheduledJobRepository;
  postRepo: PostRepository;
  auditRepo?: AuditLogRepository;
  /**
   * publishPost 呼び出しに必要な投稿ユースケース依存。
   * executeJob から `publishPost(postUsecaseDeps, workspaceId, postId)` を呼ぶ。
   */
  postUsecaseDeps: PostUsecaseDeps;
  /**
   * 現在時刻取得関数（テスト注入用）。未指定時は `() => new Date()`。
   */
  now?: () => Date;
}

// ───────────────────────────────────────────
// 定数 / 型
// ───────────────────────────────────────────

/**
 * 再試行の backoff 秒数。attempt_count - 1 をインデックスとして参照する。
 * attempt 1 失敗 → 30 秒後、attempt 2 失敗 → 120 秒後、attempt 3 失敗 → final failed
 */
export const RETRY_BACKOFF_SECONDS = [30, 120, 480] as const;

/** デッドロック回避: lock 取得から 5 分経過したジョブは再取得可能 */
export const LOCK_TIMEOUT_MS = 5 * 60 * 1000;

/** 1 回の polling で取り出すジョブ数の上限 */
export const POLL_BATCH_SIZE = 20;

export interface SchedulePostInput {
  workspaceId: string;
  postId: string;
  scheduledAt: Date;
  maxAttempts?: number;
}

export interface ListSchedulesFilters {
  status?: ScheduledJob["status"];
  postId?: string;
  from?: Date;
  to?: Date;
  limit?: number;
}

export interface ExecuteJobResult {
  job: ScheduledJob;
  /** publishPost の結果（成功時のみ） */
  post?: Post;
  /** エラーメッセージ（失敗時のみ） */
  error?: string;
  /** true なら次回 polling で retry 対象になる */
  willRetry: boolean;
}

export interface DispatchDueJobsItem {
  id: string;
  postId: string;
  beforeStatus: ScheduledJob["status"];
  afterStatus: ScheduledJob["status"] | "skipped";
  willRetry: boolean;
  recoveredStaleLock: boolean;
  error?: string;
}

export interface DispatchDueJobsResult {
  processedAt: Date;
  scanned: number;
  processed: number;
  skipped: number;
  succeeded: number;
  retrying: number;
  failed: number;
  jobs: DispatchDueJobsItem[];
}

export interface ScheduleNotificationTarget {
  type: "post_creator" | "workspace_admin";
  actorId: string | null;
  label: string;
  reason: string;
}

export interface ScheduleExecutionLog {
  id: string;
  action: string;
  status: "succeeded" | "retrying" | "failed";
  createdAt: Date;
  actorId: string;
  actorType: "user" | "agent" | "system";
  message: string;
  error: string | null;
  willRetry: boolean;
  retryable: boolean | null;
  retryRule: "retryable" | "non_retryable" | "exhausted" | "not_applicable";
  classificationReason: string | null;
  attemptCount: number | null;
  maxAttempts: number | null;
  nextRetryAt: Date | null;
  notificationTarget: ScheduleNotificationTarget | null;
}

export interface ScheduleOperationalView {
  post: {
    id: string;
    status: Post["status"];
    platform: Platform;
    socialAccountId: string;
    contentText: string | null;
    createdBy: string | null;
  } | null;
  retryPolicy: {
    maxAttempts: number;
    backoffSeconds: number[];
    retryableRule: string;
    nonRetryableRule: string;
  };
  notificationTarget: ScheduleNotificationTarget;
  latestExecution: ScheduleExecutionLog | null;
  executionLogs: ScheduleExecutionLog[];
  recommendedAction: string;
}

// ───────────────────────────────────────────
// ヘルパー
// ───────────────────────────────────────────

function nowFn(deps: ScheduleUsecaseDeps): Date {
  return deps.now ? deps.now() : new Date();
}

function buildNotificationTarget(post: Post | null): ScheduleNotificationTarget {
  if (post?.createdBy) {
    return {
      type: "post_creator",
      actorId: post.createdBy,
      label: `投稿作成者 (${post.createdBy})`,
      reason: "まず投稿内容と接続アカウントの状態を確認してほしいため",
    };
  }

  return {
    type: "workspace_admin",
    actorId: null,
    label: "ワークスペース運用担当 / admin",
    reason: "作成者情報が残っていないため、運用担当が確認する前提にするため",
  };
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function parseDateLike(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value !== "string" && typeof value !== "number") return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizeErrorMessage(message: string): string {
  return message.replace(/^Failed to publish post:\s*/i, "").trim();
}

function formatPersistedFailureState(args: {
  state: "retryable" | "terminal";
  errorMessage: string;
  exhausted?: boolean;
}): string {
  const normalized = normalizeErrorMessage(args.errorMessage) || args.errorMessage;
  if (args.state === "retryable") {
    return `retryable:${normalized}`;
  }
  if (args.exhausted) {
    return `terminal:retry_exhausted:${normalized}`;
  }
  return `terminal:${normalized}`;
}

function isPermanentProviderError(err: ProviderError): boolean {
  const raw = `${err.message} ${JSON.stringify(err.details ?? {})}`.toLowerCase();
  const patterns = [
    /invalid .*credential/,
    /invalid .*token/,
    /invalid x credentials/,
    /failed to decrypt account credentials/,
    /access_token missing/,
    /unauthorized/,
    /forbidden/,
    /pkce verifier not found/,
    /state is required/,
    /unsupported platform/,
    /not active/,
    /only draft posts can be published/,
    /post validation failed/,
  ];
  return patterns.some((pattern) => pattern.test(raw));
}

function classifyExecutionError(err: unknown): {
  retryable: boolean;
  retryRule: "retryable" | "non_retryable";
  reason: string;
  errorCode: string | null;
} {
  if (err instanceof RateLimitError) {
    return {
      retryable: true,
      retryRule: "retryable",
      reason: "X 側の一時的なレート制限のため、時間を空けて再試行します。",
      errorCode: err.code,
    };
  }

  if (err instanceof ValidationError) {
    return {
      retryable: false,
      retryRule: "non_retryable",
      reason: "入力内容または投稿状態に問題があるため、自動再試行では直りません。",
      errorCode: err.code,
    };
  }

  if (err instanceof NotFoundError) {
    return {
      retryable: false,
      retryRule: "non_retryable",
      reason: "必要な投稿または関連データが見つからないため、自動再試行では直りません。",
      errorCode: err.code,
    };
  }

  if (err instanceof AuthorizationError || err instanceof BudgetExceededError) {
    return {
      retryable: false,
      retryRule: "non_retryable",
      reason: "権限または運用ルールの制約が原因のため、自動再試行では直りません。",
      errorCode: err.code,
    };
  }

  if (err instanceof ProviderError) {
    if (isPermanentProviderError(err)) {
      return {
        retryable: false,
        retryRule: "non_retryable",
        reason: "認証情報や接続設定の問題と判断できるため、自動再試行は行いません。",
        errorCode: err.code,
      };
    }

    return {
      retryable: true,
      retryRule: "retryable",
      reason: "外部 API 側の一時障害の可能性があるため、自動再試行します。",
      errorCode: err.code,
    };
  }

  if (err instanceof DomainError) {
    return {
      retryable: false,
      retryRule: "non_retryable",
      reason: "ドメイン上の制約違反のため、自動再試行では直りません。",
      errorCode: err.code,
    };
  }

  return {
    retryable: true,
    retryRule: "retryable",
    reason: "ネットワークや一時障害の可能性がある不明エラーとして扱い、自動再試行します。",
    errorCode: null,
  };
}

async function recordScheduleExecutionLog(
  deps: ScheduleUsecaseDeps,
  args: {
    job: ScheduledJob;
    post: Post | null;
    status: "succeeded" | "retrying" | "failed";
    message: string;
    error: string | null;
    willRetry: boolean;
    retryable: boolean | null;
    retryRule: "retryable" | "non_retryable" | "exhausted" | "not_applicable";
    classificationReason: string | null;
    notificationTarget: ScheduleNotificationTarget | null;
  },
): Promise<void> {
  if (!deps.auditRepo) return;

  try {
    await recordAudit(deps.auditRepo, {
      workspaceId: args.job.workspaceId,
      actorId: "scheduler",
      actorType: "system",
      action: `schedule.execution.${args.status}`,
      resourceType: "schedule",
      resourceId: args.job.id,
      platform: args.post?.platform ?? null,
      socialAccountId: args.post?.socialAccountId ?? null,
      inputSummary: {
        jobId: args.job.id,
        postId: args.job.postId,
        status: args.status,
      },
      resultSummary: {
        jobId: args.job.id,
        postId: args.job.postId,
        status: args.status,
        message: args.message,
        error: args.error,
        willRetry: args.willRetry,
        retryable: args.retryable,
        retryRule: args.retryRule,
        classificationReason: args.classificationReason,
        attemptCount: args.job.attemptCount,
        maxAttempts: args.job.maxAttempts,
        nextRetryAt: args.job.nextRetryAt ? args.job.nextRetryAt.toISOString() : null,
        notificationTarget: args.notificationTarget,
      },
      estimatedCostUsd: null,
      requestId: null,
    });
  } catch (err) {
    console.error("[schedule.audit] failed to record execution log", err);
  }
}

function mapExecutionLog(log: {
  id: string;
  action: string;
  actorId: string;
  actorType: "user" | "agent" | "system";
  resultSummary: unknown;
  createdAt: Date;
}): ScheduleExecutionLog | null {
  if (!log.action.startsWith("schedule.execution.")) return null;

  const result =
    log.resultSummary && typeof log.resultSummary === "object"
      ? (log.resultSummary as Record<string, unknown>)
      : {};
  const status = log.action.replace("schedule.execution.", "");
  if (status !== "succeeded" && status !== "retrying" && status !== "failed") {
    return null;
  }

  const notificationRaw =
    result.notificationTarget && typeof result.notificationTarget === "object"
      ? (result.notificationTarget as Record<string, unknown>)
      : null;

  return {
    id: log.id,
    action: log.action,
    status,
    createdAt: log.createdAt,
    actorId: log.actorId,
    actorType: log.actorType,
    message: asText(result.message) ?? status,
    error: asText(result.error),
    willRetry: result.willRetry === true,
    retryable:
      typeof result.retryable === "boolean" ? (result.retryable as boolean) : status === "retrying",
    retryRule:
      result.retryRule === "retryable" ||
      result.retryRule === "non_retryable" ||
      result.retryRule === "exhausted" ||
      result.retryRule === "not_applicable"
        ? (result.retryRule as ScheduleExecutionLog["retryRule"])
        : "not_applicable",
    classificationReason: asText(result.classificationReason),
    attemptCount: typeof result.attemptCount === "number" ? (result.attemptCount as number) : null,
    maxAttempts: typeof result.maxAttempts === "number" ? (result.maxAttempts as number) : null,
    nextRetryAt: parseDateLike(result.nextRetryAt),
    notificationTarget: notificationRaw
      ? {
          type: notificationRaw.type === "post_creator" ? "post_creator" : "workspace_admin",
          actorId: asText(notificationRaw.actorId),
          label: asText(notificationRaw.label) ?? "ワークスペース運用担当 / admin",
          reason: asText(notificationRaw.reason) ?? "",
        }
      : null,
  };
}

function buildRecommendedAction(
  job: ScheduledJob,
  latestExecution: ScheduleExecutionLog | null,
  notificationTarget: ScheduleNotificationTarget,
): string {
  if (job.status === "succeeded") {
    return "対応は不要です。投稿は正常に完了しています。";
  }

  if (latestExecution?.willRetry && latestExecution.nextRetryAt) {
    return `${latestExecution.nextRetryAt.toLocaleString("ja-JP")} に自動再試行されます。継続して失敗した場合は ${notificationTarget.label} が確認してください。`;
  }

  if (job.status === "retrying") {
    return "自動再試行待ちです。次回実行予定時刻を確認し、それでも失敗が続く場合は運用担当が接続状態を確認してください。";
  }

  if (job.status === "failed") {
    return `${notificationTarget.label} が「認証状態 / 接続アカウント / 投稿内容」を確認してください。自動では再試行しません。`;
  }

  if (job.status === "pending") {
    return "予定時刻になると scheduler が自動実行します。手動確認したい場合は CLI の run-due を使えます。";
  }

  return "現在の状態を確認し、必要なら実行ログから原因を追跡してください。";
}

async function loadOwnedPost(
  postRepo: PostRepository,
  workspaceId: string,
  postId: string,
): Promise<Post> {
  const post = await postRepo.findById(postId);
  if (!post || post.workspaceId !== workspaceId) {
    throw new NotFoundError("Post", postId);
  }
  return post;
}

async function loadOwnedJob(
  jobRepo: ScheduledJobRepository,
  workspaceId: string,
  jobId: string,
): Promise<ScheduledJob> {
  const job = await jobRepo.findById(jobId);
  if (!job || job.workspaceId !== workspaceId) {
    throw new NotFoundError("ScheduledJob", jobId);
  }
  return job;
}

// ───────────────────────────────────────────
// ユースケース: schedulePost
// ───────────────────────────────────────────

/**
 * 投稿を予約する。
 *
 * - 投稿は draft 状態である必要がある
 * - scheduledAt が過去の場合は ValidationError
 * - 投稿の status を 'scheduled' に更新し、scheduled_jobs に pending ジョブを作成する
 */
export async function schedulePost(
  deps: ScheduleUsecaseDeps,
  input: SchedulePostInput,
): Promise<ScheduledJob> {
  const now = nowFn(deps);

  if (input.scheduledAt.getTime() <= now.getTime()) {
    throw new ValidationError("scheduledAt must be in the future", {
      scheduledAt: input.scheduledAt.toISOString(),
      now: now.toISOString(),
    });
  }

  const post = await loadOwnedPost(deps.postRepo, input.workspaceId, input.postId);

  if (post.status !== "draft") {
    throw new ValidationError(`Only draft posts can be scheduled (current status: ${post.status})`);
  }

  // 投稿の status を scheduled に更新
  await deps.postRepo.update(post.id, { status: "scheduled" });

  // ジョブを作成（pending）
  const job = await deps.scheduledJobRepo.create({
    workspaceId: input.workspaceId,
    postId: post.id,
    scheduledAt: input.scheduledAt,
    status: "pending",
    lockedAt: null,
    startedAt: null,
    completedAt: null,
    attemptCount: 0,
    maxAttempts: input.maxAttempts ?? 3,
    lastError: null,
    nextRetryAt: null,
  });

  return job;
}

// ───────────────────────────────────────────
// ユースケース: updateSchedule
// ───────────────────────────────────────────

/**
 * 予約日時を変更する。
 * status が pending 以外の場合はエラー。
 */
export async function updateSchedule(
  deps: ScheduleUsecaseDeps,
  workspaceId: string,
  jobId: string,
  scheduledAt: Date,
): Promise<ScheduledJob> {
  const now = nowFn(deps);
  if (scheduledAt.getTime() <= now.getTime()) {
    throw new ValidationError("scheduledAt must be in the future");
  }

  const job = await loadOwnedJob(deps.scheduledJobRepo, workspaceId, jobId);
  if (job.status !== "pending" && job.status !== "retrying") {
    throw new ValidationError(
      `Only pending or retrying jobs can be rescheduled (current status: ${job.status})`,
    );
  }

  return deps.scheduledJobRepo.update(jobId, {
    scheduledAt,
    status: "pending",
    nextRetryAt: null,
    lockedAt: null,
  });
}

// ───────────────────────────────────────────
// ユースケース: cancelSchedule
// ───────────────────────────────────────────

/**
 * 予約をキャンセルする。
 * - ジョブの status を失敗/成功/retrying 以外であれば 'failed' に更新する
 *   （キャンセル専用 status は design に存在しないため、canceled は lastError にマーク）
 * - 投稿の status を 'draft' に戻す
 */
export async function cancelSchedule(
  deps: ScheduleUsecaseDeps,
  workspaceId: string,
  jobId: string,
): Promise<ScheduledJob> {
  const job = await loadOwnedJob(deps.scheduledJobRepo, workspaceId, jobId);

  // 既に終了状態のジョブはキャンセル不可
  if (job.status === "succeeded") {
    throw new ValidationError("Cannot cancel a succeeded job");
  }
  if (job.status === "running" || job.status === "locked") {
    throw new ValidationError(`Cannot cancel a ${job.status} job; wait for completion or retry`);
  }
  if (job.status === "failed" && job.lastError === "canceled_by_user") {
    return job;
  }

  // 投稿を draft に戻す
  const post = await deps.postRepo.findById(job.postId);
  if (post && post.status === "scheduled") {
    await deps.postRepo.update(job.postId, { status: "draft" });
  }

  // ジョブを failed 扱いにし、lastError にキャンセル理由を記録
  const canceled = await deps.scheduledJobRepo.update(jobId, {
    status: "failed",
    lastError: "canceled_by_user",
    completedAt: nowFn(deps),
  });

  return canceled;
}

// ───────────────────────────────────────────
// ユースケース: listSchedules / getSchedule
// ───────────────────────────────────────────

/**
 * ワークスペースの予約一覧。
 * 現状 ScheduledJobRepository は findPendingJobs しか持たないため、
 * ここでは findPendingJobs + 全件走査のフォールバックを行う。
 * リポジトリ側で findByWorkspace を拡充するまでの暫定実装。
 */
export async function listSchedules(
  deps: ScheduleUsecaseDeps,
  workspaceId: string,
  filters: ListSchedulesFilters = {},
): Promise<ScheduledJob[]> {
  // ScheduledJobRepository には findByWorkspace が無いため、
  // 拡張メソッド findByWorkspace があればそれを呼ぶ（Drizzle 実装側で追加）。
  const repo = deps.scheduledJobRepo as ScheduledJobRepository & {
    findByWorkspace?: (
      wsId: string,
      opts?: { status?: ScheduledJob["status"]; postId?: string; limit?: number },
    ) => Promise<ScheduledJob[]>;
  };

  let jobs: ScheduledJob[];
  if (repo.findByWorkspace) {
    jobs = await repo.findByWorkspace(workspaceId, {
      status: filters.status,
      postId: filters.postId,
      limit: filters.limit,
    });
  } else {
    // フォールバック: findPendingJobs + filter
    const pending = await deps.scheduledJobRepo.findPendingJobs(1000);
    jobs = pending.filter((j) => j.workspaceId === workspaceId);
  }

  return jobs.filter((j) => {
    if (filters.from && j.scheduledAt < filters.from) return false;
    if (filters.to && j.scheduledAt > filters.to) return false;
    return true;
  });
}

export async function getSchedule(
  deps: ScheduleUsecaseDeps,
  workspaceId: string,
  jobId: string,
): Promise<ScheduledJob> {
  return loadOwnedJob(deps.scheduledJobRepo, workspaceId, jobId);
}

export async function getScheduleOperationalView(
  deps: ScheduleUsecaseDeps,
  workspaceId: string,
  jobId: string,
): Promise<ScheduleOperationalView> {
  const job = await loadOwnedJob(deps.scheduledJobRepo, workspaceId, jobId);
  const post = await deps.postRepo.findById(job.postId);
  const ownedPost = post && post.workspaceId === workspaceId ? post : null;
  const notificationTarget = buildNotificationTarget(ownedPost);

  let executionLogs: ScheduleExecutionLog[] = [];
  if (deps.auditRepo) {
    const rawLogs = await deps.auditRepo.findByWorkspace(workspaceId, {
      resourceType: "schedule",
      resourceId: job.id,
      limit: 20,
    });
    executionLogs = rawLogs
      .map((log) =>
        mapExecutionLog({
          id: log.id,
          action: log.action,
          actorId: log.actorId,
          actorType: log.actorType,
          resultSummary: log.resultSummary,
          createdAt: log.createdAt,
        }),
      )
      .filter((log): log is ScheduleExecutionLog => log !== null);
  }

  const latestExecution = executionLogs[0] ?? null;

  return {
    post: ownedPost
      ? {
          id: ownedPost.id,
          status: ownedPost.status,
          platform: ownedPost.platform,
          socialAccountId: ownedPost.socialAccountId,
          contentText: ownedPost.contentText,
          createdBy: ownedPost.createdBy,
        }
      : null,
    retryPolicy: {
      maxAttempts: job.maxAttempts,
      backoffSeconds: [...RETRY_BACKOFF_SECONDS],
      retryableRule: "一時的な API 障害・ネットワーク障害・レート制限は自動再試行します。",
      nonRetryableRule: "入力不備・認証不備・存在しない投稿 / アカウントは自動再試行しません。",
    },
    notificationTarget,
    latestExecution,
    executionLogs,
    recommendedAction: buildRecommendedAction(job, latestExecution, notificationTarget),
  };
}

// ───────────────────────────────────────────
// ユースケース: executeJob
// ───────────────────────────────────────────

/**
 * ジョブを実行する。ワーカーから呼ばれる。
 *
 * フロー:
 * 1. lockJob で楽観的ロックを取得（pending のみ）
 *    - 取れなかった場合は null を返して終了（他のワーカーが処理中）
 * 2. attemptCount をインクリメントし、status=running・startedAt をセット
 * 3. Post の status を draft に一時的に戻してから publishPost を呼ぶ
 *    - 予約実行時は Post が scheduled だが、publishPost は draft を期待するため
 * 4. 成功: status=succeeded, completedAt セット
 *    失敗: attempt < maxAttempts → retrying + nextRetryAt,
 *          到達 → failed
 */
export async function executeJob(
  deps: ScheduleUsecaseDeps,
  jobId: string,
): Promise<ExecuteJobResult | null> {
  const now = nowFn(deps);

  // 1. atomic lock
  const locked = await deps.scheduledJobRepo.lockJob(jobId, {
    now,
    lockTimeoutMs: LOCK_TIMEOUT_MS,
  });
  if (!locked) {
    return null;
  }

  // 2. running に遷移 + attempt++
  const attemptCount = locked.attemptCount + 1;
  const runningJob = await deps.scheduledJobRepo.update(jobId, {
    status: "running",
    startedAt: now,
    attemptCount,
  });

  // 3. publishPost を呼ぶ
  // executeJob は予約実行経路。Post の status は scheduled なので、
  // publishPost が期待する draft に戻してから呼ぶ。
  const post = await deps.postRepo.findById(runningJob.postId);
  const notificationTarget = buildNotificationTarget(post);
  try {
    if (!post) {
      throw new NotFoundError("Post", runningJob.postId);
    }
    if (post.status === "scheduled" || post.status === "failed" || post.status === "publishing") {
      await deps.postRepo.update(post.id, { status: "draft" });
    }

    const published = await publishPost(
      deps.postUsecaseDeps,
      runningJob.workspaceId,
      runningJob.postId,
    );

    // 4a. 成功
    const succeeded = await deps.scheduledJobRepo.update(jobId, {
      status: "succeeded",
      completedAt: nowFn(deps),
      lockedAt: null,
      lastError: null,
      nextRetryAt: null,
    });

    await recordScheduleExecutionLog(deps, {
      job: succeeded,
      post,
      status: "succeeded",
      message: "予約投稿は正常に完了しました。",
      error: null,
      willRetry: false,
      retryable: null,
      retryRule: "not_applicable",
      classificationReason: null,
      notificationTarget: null,
    });

    return { job: succeeded, post: published, willRetry: false };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const classification = classifyExecutionError(err);
    const shouldRetry = classification.retryable && attemptCount < runningJob.maxAttempts;

    // 4b. 失敗 - 再試行判定
    if (shouldRetry) {
      const backoffSec =
        RETRY_BACKOFF_SECONDS[Math.min(attemptCount - 1, RETRY_BACKOFF_SECONDS.length - 1)];
      const nextRetryAt = new Date(nowFn(deps).getTime() + backoffSec * 1000);

      const retrying = await deps.scheduledJobRepo.update(jobId, {
        status: "retrying",
        lastError: formatPersistedFailureState({
          state: "retryable",
          errorMessage,
        }),
        nextRetryAt,
        lockedAt: null,
      });

      await recordScheduleExecutionLog(deps, {
        job: retrying,
        post,
        status: "retrying",
        message: "一時的な障害として扱い、自動再試行を予定しました。",
        error: normalizeErrorMessage(errorMessage),
        willRetry: true,
        retryable: true,
        retryRule: classification.retryRule,
        classificationReason: classification.reason,
        notificationTarget,
      });
      return { job: retrying, error: errorMessage, willRetry: true };
    }

    // 最終失敗
    const failed = await deps.scheduledJobRepo.update(jobId, {
      status: "failed",
      lastError: formatPersistedFailureState({
        state: "terminal",
        errorMessage,
        exhausted: classification.retryable,
      }),
      completedAt: nowFn(deps),
      lockedAt: null,
      nextRetryAt: null,
    });

    // Post も failed に
    if (post) {
      await deps.postRepo.update(runningJob.postId, { status: "failed" });
    }

    await recordScheduleExecutionLog(deps, {
      job: failed,
      post,
      status: "failed",
      message: classification.retryable
        ? "再試行上限に達したため、永続失敗として停止しました。"
        : "自動では解消しないエラーのため、再試行せず停止しました。",
      error: normalizeErrorMessage(errorMessage),
      willRetry: false,
      retryable: classification.retryable,
      retryRule: classification.retryable ? "exhausted" : classification.retryRule,
      classificationReason: classification.reason,
      notificationTarget,
    });

    return { job: failed, error: errorMessage, willRetry: false };
  }
}

// ───────────────────────────────────────────
// ワーカー向け: 実行対象ジョブの取得
// ───────────────────────────────────────────

/**
 * ワーカーの polling 対象となるジョブを取得する。
 *
 * 条件:
 * - status = 'pending' AND scheduled_at <= now
 * - status = 'retrying' AND next_retry_at <= now
 * - status = 'locked' AND locked_at <= (now - LOCK_TIMEOUT_MS)（デッドロック回復）
 *
 * リポジトリが findExecutable を持てばそれを使い、無ければ findPendingJobs のみを使う。
 */
export async function findExecutableJobs(
  deps: ScheduleUsecaseDeps,
  limit: number = POLL_BATCH_SIZE,
): Promise<ScheduledJob[]> {
  const repo = deps.scheduledJobRepo as ScheduledJobRepository & {
    findExecutable?: (opts: {
      now: Date;
      lockTimeoutMs: number;
      limit: number;
    }) => Promise<ScheduledJob[]>;
  };

  if (repo.findExecutable) {
    return repo.findExecutable({
      now: nowFn(deps),
      lockTimeoutMs: LOCK_TIMEOUT_MS,
      limit,
    });
  }

  // フォールバック: pending のみ
  return deps.scheduledJobRepo.findPendingJobs(limit);
}

/**
 * 期限到来ジョブを 1 バッチ実行する。
 *
 * アーキテクチャ上の役割:
 * - cron entrypoint
 * - API 手動実行
 * - 常駐 worker の 1 tick
 *
 * のすべてがこの関数を共有することで、運用経路ごとの差をなくす。
 */
export async function dispatchDueJobs(
  deps: ScheduleUsecaseDeps,
  options: { limit?: number } = {},
): Promise<DispatchDueJobsResult> {
  const processedAt = nowFn(deps);
  const candidates = await findExecutableJobs(deps, options.limit ?? POLL_BATCH_SIZE);

  const result: DispatchDueJobsResult = {
    processedAt,
    scanned: candidates.length,
    processed: 0,
    skipped: 0,
    succeeded: 0,
    retrying: 0,
    failed: 0,
    jobs: [],
  };

  const staleBefore = new Date(processedAt.getTime() - LOCK_TIMEOUT_MS);

  for (const candidate of candidates) {
    const execution = await executeJob(deps, candidate.id);
    if (!execution) {
      result.skipped += 1;
      result.jobs.push({
        id: candidate.id,
        postId: candidate.postId,
        beforeStatus: candidate.status,
        afterStatus: "skipped",
        willRetry: false,
        recoveredStaleLock:
          candidate.status === "locked" &&
          candidate.lockedAt !== null &&
          candidate.lockedAt <= staleBefore,
      });
      continue;
    }

    result.processed += 1;
    if (execution.job.status === "succeeded") result.succeeded += 1;
    if (execution.job.status === "retrying") result.retrying += 1;
    if (execution.job.status === "failed") result.failed += 1;

    result.jobs.push({
      id: execution.job.id,
      postId: execution.job.postId,
      beforeStatus: candidate.status,
      afterStatus: execution.job.status,
      willRetry: execution.willRetry,
      recoveredStaleLock:
        candidate.status === "locked" &&
        candidate.lockedAt !== null &&
        candidate.lockedAt <= staleBefore,
      error: execution.error,
    });
  }

  return result;
}

// Platform 型の再エクスポート抑制（未使用警告回避用）
export type { Platform };
