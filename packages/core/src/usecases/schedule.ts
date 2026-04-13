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
import type { PostRepository, ScheduledJobRepository } from "../interfaces/repositories.js";
import { NotFoundError, ValidationError } from "../errors/domain-error.js";
import { publishPost } from "./post.js";
import type { PostUsecaseDeps } from "./post.js";

// ───────────────────────────────────────────
// 依存注入コンテキスト
// ───────────────────────────────────────────

export interface ScheduleUsecaseDeps {
  scheduledJobRepo: ScheduledJobRepository;
  postRepo: PostRepository;
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

// ───────────────────────────────────────────
// ヘルパー
// ───────────────────────────────────────────

function nowFn(deps: ScheduleUsecaseDeps): Date {
  return deps.now ? deps.now() : new Date();
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
  try {
    const post = await deps.postRepo.findById(runningJob.postId);
    if (!post) {
      throw new Error(`Post not found: ${runningJob.postId}`);
    }
    if (post.status === "scheduled") {
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

    return { job: succeeded, post: published, willRetry: false };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    // 4b. 失敗 - 再試行判定
    if (attemptCount < runningJob.maxAttempts) {
      const backoffSec =
        RETRY_BACKOFF_SECONDS[Math.min(attemptCount - 1, RETRY_BACKOFF_SECONDS.length - 1)];
      const nextRetryAt = new Date(nowFn(deps).getTime() + backoffSec * 1000);

      const retrying = await deps.scheduledJobRepo.update(jobId, {
        status: "retrying",
        lastError: errorMessage,
        nextRetryAt,
        lockedAt: null,
      });
      return { job: retrying, error: errorMessage, willRetry: true };
    }

    // 最終失敗
    const failed = await deps.scheduledJobRepo.update(jobId, {
      status: "failed",
      lastError: errorMessage,
      completedAt: nowFn(deps),
      lockedAt: null,
      nextRetryAt: null,
    });

    // Post も failed に
    await deps.postRepo.update(runningJob.postId, { status: "failed" });

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
