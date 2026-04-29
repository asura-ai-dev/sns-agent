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
    gateId: row.gateId,
    feature: row.feature,
    metadata: row.metadata as UsageRecord["metadata"],
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
      gateId: usage.gateId,
      feature: usage.feature,
      metadata: usage.metadata,
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
    options: { platform?: string; endpoint?: string; startDate: Date; endDate: Date },
  ): Promise<UsageAggregation[]> {
    const conditions = [
      eq(usageRecords.workspaceId, workspaceId),
      gte(usageRecords.recordedAt, options.startDate),
      lte(usageRecords.recordedAt, options.endDate),
    ];

    if (options.platform) {
      conditions.push(eq(usageRecords.platform, options.platform));
    }
    if (options.endpoint) {
      conditions.push(eq(usageRecords.endpoint, options.endpoint));
    }
    if (options.gateId) {
      conditions.push(eq(usageRecords.gateId, options.gateId));
    }

    const totals = {
      totalRequests: sql<number>`sum(${usageRecords.requestCount})`,
      successCount: sql<number>`sum(case when ${usageRecords.success} = 1 then ${usageRecords.requestCount} else 0 end)`,
      failureCount: sql<number>`sum(case when ${usageRecords.success} = 0 then ${usageRecords.requestCount} else 0 end)`,
      totalCostUsd: sql<number>`coalesce(sum(${usageRecords.estimatedCostUsd}), 0)`,
    };

    if (options.dimension === "endpoint") {
      const rows = await this.db
        .select({
          platform: usageRecords.platform,
          endpoint: usageRecords.endpoint,
          ...totals,
        })
        .from(usageRecords)
        .where(and(...conditions))
        .groupBy(usageRecords.platform, usageRecords.endpoint);

      return rows.map((row) => ({
        platform: row.platform,
        endpoint: row.endpoint,
        totalRequests: Number(row.totalRequests) || 0,
        successCount: Number(row.successCount) || 0,
        failureCount: Number(row.failureCount) || 0,
        totalCostUsd: Number(row.totalCostUsd) || 0,
      }));
    }

    if (options.dimension === "gate") {
      conditions.push(sql`${usageRecords.gateId} is not null`);
      const rows = await this.db
        .select({
          platform: usageRecords.platform,
          gateId: usageRecords.gateId,
          feature: usageRecords.feature,
          ...totals,
        })
        .from(usageRecords)
        .where(and(...conditions))
        .groupBy(usageRecords.platform, usageRecords.gateId, usageRecords.feature);

      return rows.map((row) => ({
        platform: row.platform,
        gateId: row.gateId,
        feature: row.feature,
        totalRequests: Number(row.totalRequests) || 0,
        successCount: Number(row.successCount) || 0,
        failureCount: Number(row.failureCount) || 0,
        totalCostUsd: Number(row.totalCostUsd) || 0,
      }));
    }

    const rows = await this.db
      .select({
        platform: usageRecords.platform,
        ...totals,
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

  /**
   * 指定範囲のサマリ集計を取得する (Task 4003)。
   * コアインターフェース外の補助メソッド。aggregate の結果を platform 横断で合算する。
   */
  async getSummary(
    workspaceId: string,
    options: { startDate: Date; endDate: Date },
  ): Promise<{
    totalRequests: number;
    successCount: number;
    failureCount: number;
    totalCostUsd: number;
    byPlatform: UsageAggregation[];
  }> {
    const byPlatform = await this.aggregate(workspaceId, options);
    const totals = byPlatform.reduce(
      (acc, row) => {
        acc.totalRequests += row.totalRequests;
        acc.successCount += row.successCount;
        acc.failureCount += row.failureCount;
        acc.totalCostUsd += row.totalCostUsd;
        return acc;
      },
      { totalRequests: 0, successCount: 0, failureCount: 0, totalCostUsd: 0 },
    );
    return { ...totals, byPlatform };
  }

  async findRecent(workspaceId: string, limit = 50): Promise<UsageRecord[]> {
    const rows = await this.db
      .select()
      .from(usageRecords)
      .where(eq(usageRecords.workspaceId, workspaceId))
      .orderBy(sql`${usageRecords.recordedAt} desc`)
      .limit(limit);
    return rows.map(rowToEntity);
  }
}
