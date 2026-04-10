/**
 * ScheduledJobRepository の Drizzle 実装
 * core/interfaces/repositories.ts の ScheduledJobRepository に準拠。
 *
 * Task 2005: 予約ジョブのロック / 実行対象抽出 / ワークスペース一覧を拡充。
 */
import { eq, and, lte, or, isNull, inArray, desc } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { ScheduledJobRepository } from "@sns-agent/core";
import type { ScheduledJob } from "@sns-agent/core";
import { scheduledJobs } from "../schema/scheduled-jobs.js";
import type { DbClient } from "../client.js";

function rowToEntity(row: typeof scheduledJobs.$inferSelect): ScheduledJob {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    postId: row.postId,
    scheduledAt: row.scheduledAt,
    status: row.status as ScheduledJob["status"],
    lockedAt: row.lockedAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    attemptCount: row.attemptCount,
    maxAttempts: row.maxAttempts,
    lastError: row.lastError,
    nextRetryAt: row.nextRetryAt,
    createdAt: row.createdAt,
  };
}

export class DrizzleScheduledJobRepository implements ScheduledJobRepository {
  constructor(private readonly db: DbClient) {}

  async findById(id: string): Promise<ScheduledJob | null> {
    const rows = await this.db
      .select()
      .from(scheduledJobs)
      .where(eq(scheduledJobs.id, id))
      .limit(1);
    return rows.length > 0 ? rowToEntity(rows[0]) : null;
  }

  async findPendingJobs(limit: number): Promise<ScheduledJob[]> {
    const now = new Date();
    const rows = await this.db
      .select()
      .from(scheduledJobs)
      .where(and(eq(scheduledJobs.status, "pending"), lte(scheduledJobs.scheduledAt, now)))
      .limit(limit);
    return rows.map(rowToEntity);
  }

  async create(job: Omit<ScheduledJob, "id" | "createdAt">): Promise<ScheduledJob> {
    const now = new Date();
    const id = randomUUID();
    await this.db.insert(scheduledJobs).values({
      id,
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
      createdAt: now,
    });
    return { ...job, id, createdAt: now };
  }

  async update(id: string, data: Partial<ScheduledJob>): Promise<ScheduledJob> {
    const updateData: Record<string, unknown> = { ...data };
    delete updateData.id;
    delete updateData.createdAt;

    await this.db.update(scheduledJobs).set(updateData).where(eq(scheduledJobs.id, id));

    const updated = await this.findById(id);
    if (!updated) {
      throw new Error(`ScheduledJob not found: ${id}`);
    }
    return updated;
  }

  /**
   * ジョブをアトミックにロックする。
   *
   * 対象となる前提状態:
   * - status = 'pending'
   * - status = 'retrying'（next_retry_at チェックはワーカー側 findExecutable で実施）
   * - status = 'locked' かつ locked_at が古い（デッドロック回復）
   *
   * status が上記以外だった場合は null を返す。
   */
  async lockJob(id: string): Promise<ScheduledJob | null> {
    const now = new Date();

    // Atomic lock: pending / retrying のみを locked に遷移させる。
    // SQLite の UPDATE ... WHERE は原子的であり、複数ワーカーが同時に呼んでも
    // 1 プロセスのみが .returning() で行を得られる。
    const result = await this.db
      .update(scheduledJobs)
      .set({
        status: "locked",
        lockedAt: now,
      })
      .where(and(eq(scheduledJobs.id, id), inArray(scheduledJobs.status, ["pending", "retrying"])))
      .returning();

    if (result.length === 0) {
      return null;
    }

    return rowToEntity(result[0]);
  }

  /**
   * ワーカー向け: 実行可能なジョブを列挙する。
   *
   * - status = 'pending' AND scheduled_at <= now
   * - status = 'retrying' AND next_retry_at <= now
   * - status = 'locked' AND locked_at <= (now - lockTimeoutMs)（デッドロック回復）
   */
  async findExecutable(opts: {
    now: Date;
    lockTimeoutMs: number;
    limit: number;
  }): Promise<ScheduledJob[]> {
    const { now, lockTimeoutMs, limit } = opts;
    const staleBefore = new Date(now.getTime() - lockTimeoutMs);

    const rows = await this.db
      .select()
      .from(scheduledJobs)
      .where(
        or(
          and(eq(scheduledJobs.status, "pending"), lte(scheduledJobs.scheduledAt, now)),
          and(eq(scheduledJobs.status, "retrying"), lte(scheduledJobs.nextRetryAt, now)),
          and(eq(scheduledJobs.status, "locked"), lte(scheduledJobs.lockedAt, staleBefore)),
        ),
      )
      .limit(limit);

    return rows.map(rowToEntity);
  }

  /**
   * 指定した post_id 群に紐づく予約ジョブを返す。
   * 投稿一覧の schedule 情報（scheduledAt, status）を埋めるために使う。
   * scheduled_at 降順で返すため、呼び出し側は先頭を最新として扱える。
   */
  async findByPostIds(postIds: string[]): Promise<ScheduledJob[]> {
    if (postIds.length === 0) return [];
    const rows = await this.db
      .select()
      .from(scheduledJobs)
      .where(inArray(scheduledJobs.postId, postIds))
      .orderBy(desc(scheduledJobs.scheduledAt));
    return rows.map(rowToEntity);
  }

  /**
   * ワークスペース単位の予約一覧取得。
   * status / postId でフィルタ可能。scheduled_at 降順で返す。
   */
  async findByWorkspace(
    workspaceId: string,
    opts?: { status?: ScheduledJob["status"]; postId?: string; limit?: number },
  ): Promise<ScheduledJob[]> {
    const conditions = [eq(scheduledJobs.workspaceId, workspaceId)];
    if (opts?.status) {
      conditions.push(eq(scheduledJobs.status, opts.status));
    }
    if (opts?.postId) {
      conditions.push(eq(scheduledJobs.postId, opts.postId));
    }

    const query = this.db
      .select()
      .from(scheduledJobs)
      .where(and(...conditions))
      .orderBy(desc(scheduledJobs.scheduledAt));

    const rows = opts?.limit ? await query.limit(opts.limit) : await query;
    return rows.map(rowToEntity);
  }
}

// isNull is imported to silence unused-import if future usage is added;
// reference it to prevent tree-shaker complaints in strict mode.
void isNull;
