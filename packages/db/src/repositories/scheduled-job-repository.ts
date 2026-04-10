/**
 * ScheduledJobRepository の Drizzle 実装
 * core/interfaces/repositories.ts の ScheduledJobRepository に準拠
 */
import { eq, and, lte } from "drizzle-orm";
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

  async lockJob(id: string): Promise<ScheduledJob | null> {
    const now = new Date();

    // Atomic lock: only update if status is still 'pending'
    const result = await this.db
      .update(scheduledJobs)
      .set({
        status: "locked",
        lockedAt: now,
      })
      .where(and(eq(scheduledJobs.id, id), eq(scheduledJobs.status, "pending")))
      .returning();

    if (result.length === 0) {
      return null;
    }

    return rowToEntity(result[0]);
  }
}
