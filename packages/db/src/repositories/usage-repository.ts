/**
 * UsageRepository の Drizzle 実装（骨格）
 * core/interfaces/repositories.ts の UsageRepository に準拠
 */
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { UsageRepository, UsageAggregation } from "@sns-agent/core";
import type { UsageRecord } from "@sns-agent/core";
import { usageRecords } from "../schema/usage-records.js";
import type { DbClient } from "../client.js";

function rowToEntity(row: typeof usageRecords.$inferSelect): UsageRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    platform: row.platform,
    endpoint: row.endpoint,
    actorId: row.actorId,
    actorType: row.actorType as UsageRecord["actorType"],
    requestCount: row.requestCount,
    success: row.success,
    estimatedCostUsd: row.estimatedCostUsd,
    recordedAt: row.recordedAt,
    createdAt: row.createdAt,
  };
}

export class DrizzleUsageRepository implements UsageRepository {
  constructor(private readonly db: DbClient) {}

  async record(usage: Omit<UsageRecord, "id" | "createdAt">): Promise<UsageRecord> {
    const now = new Date();
    const id = randomUUID();
    await this.db.insert(usageRecords).values({
      id,
      workspaceId: usage.workspaceId,
      platform: usage.platform,
      endpoint: usage.endpoint,
      actorId: usage.actorId,
      actorType: usage.actorType,
      requestCount: usage.requestCount,
      success: usage.success,
      estimatedCostUsd: usage.estimatedCostUsd,
      recordedAt: usage.recordedAt,
      createdAt: now,
    });
    return { ...usage, id, createdAt: now };
  }

  async aggregate(
    workspaceId: string,
    options: { platform?: string; startDate: Date; endDate: Date },
  ): Promise<UsageAggregation[]> {
    const conditions = [
      eq(usageRecords.workspaceId, workspaceId),
      gte(usageRecords.recordedAt, options.startDate),
      lte(usageRecords.recordedAt, options.endDate),
    ];

    if (options.platform) {
      conditions.push(eq(usageRecords.platform, options.platform));
    }

    const rows = await this.db
      .select({
        platform: usageRecords.platform,
        totalRequests: sql<number>`sum(${usageRecords.requestCount})`,
        successCount: sql<number>`sum(case when ${usageRecords.success} = 1 then ${usageRecords.requestCount} else 0 end)`,
        failureCount: sql<number>`sum(case when ${usageRecords.success} = 0 then ${usageRecords.requestCount} else 0 end)`,
        totalCostUsd: sql<number>`coalesce(sum(${usageRecords.estimatedCostUsd}), 0)`,
      })
      .from(usageRecords)
      .where(and(...conditions))
      .groupBy(usageRecords.platform);

    return rows.map((row) => ({
      platform: row.platform,
      totalRequests: Number(row.totalRequests) || 0,
      successCount: Number(row.successCount) || 0,
      failureCount: Number(row.failureCount) || 0,
      totalCostUsd: Number(row.totalCostUsd) || 0,
    }));
  }
}
