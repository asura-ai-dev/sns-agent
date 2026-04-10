/**
 * AuditLogRepository の Drizzle 実装（骨格）
 * core/interfaces/repositories.ts の AuditLogRepository に準拠
 * 追記のみ: update / delete メソッドなし
 */
import { eq, and, gte, lte, desc } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { AuditLogRepository } from "@sns-agent/core";
import type { AuditLog } from "@sns-agent/core";
import { auditLogs } from "../schema/audit-logs.js";
import type { DbClient } from "../client.js";

function rowToEntity(row: typeof auditLogs.$inferSelect): AuditLog {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    actorId: row.actorId,
    actorType: row.actorType as AuditLog["actorType"],
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    platform: row.platform,
    socialAccountId: row.socialAccountId,
    inputSummary: row.inputSummary,
    resultSummary: row.resultSummary,
    estimatedCostUsd: row.estimatedCostUsd,
    requestId: row.requestId,
    createdAt: row.createdAt,
  };
}

export class DrizzleAuditLogRepository implements AuditLogRepository {
  constructor(private readonly db: DbClient) {}

  async create(log: Omit<AuditLog, "id">): Promise<AuditLog> {
    const id = randomUUID();
    await this.db.insert(auditLogs).values({
      id,
      workspaceId: log.workspaceId,
      actorId: log.actorId,
      actorType: log.actorType,
      action: log.action,
      resourceType: log.resourceType,
      resourceId: log.resourceId,
      platform: log.platform,
      socialAccountId: log.socialAccountId,
      inputSummary: log.inputSummary as Record<string, unknown> | null,
      resultSummary: log.resultSummary as Record<string, unknown> | null,
      estimatedCostUsd: log.estimatedCostUsd,
      requestId: log.requestId,
      createdAt: log.createdAt,
    });
    return { ...log, id };
  }

  async findByWorkspace(
    workspaceId: string,
    options?: {
      actorId?: string;
      action?: string;
      startDate?: Date;
      endDate?: Date;
      limit?: number;
      offset?: number;
    },
  ): Promise<AuditLog[]> {
    const conditions = [eq(auditLogs.workspaceId, workspaceId)];

    if (options?.actorId) {
      conditions.push(eq(auditLogs.actorId, options.actorId));
    }
    if (options?.action) {
      conditions.push(eq(auditLogs.action, options.action));
    }
    if (options?.startDate) {
      conditions.push(gte(auditLogs.createdAt, options.startDate));
    }
    if (options?.endDate) {
      conditions.push(lte(auditLogs.createdAt, options.endDate));
    }

    let query = this.db
      .select()
      .from(auditLogs)
      .where(and(...conditions))
      .orderBy(desc(auditLogs.createdAt));

    if (options?.limit) {
      query = query.limit(options.limit) as typeof query;
    }
    if (options?.offset) {
      query = query.offset(options.offset) as typeof query;
    }

    const rows = await query;
    return rows.map(rowToEntity);
  }
}
