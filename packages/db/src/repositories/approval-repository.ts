/**
 * ApprovalRepository の Drizzle 実装
 *
 * Task 6002: core/interfaces/repositories.ts の ApprovalRepository に準拠。
 * design.md セクション 3.1（approval_requests テーブル）に対応。
 */
import { eq, and, lt, desc, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type {
  ApprovalRepository,
  ApprovalFilterOptions,
  ApprovalRequest,
  ApprovalStatus,
} from "@sns-agent/core";
import { approvalRequests } from "../schema/approval-requests.js";
import type { DbClient } from "../client.js";

function rowToEntity(row: typeof approvalRequests.$inferSelect): ApprovalRequest {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    payload: row.payload ? JSON.parse(row.payload) : null,
    requestedBy: row.requestedBy,
    requestedAt: row.requestedAt,
    status: row.status as ApprovalStatus,
    reviewedBy: row.reviewedBy,
    reviewedAt: row.reviewedAt,
    reason: row.reason,
  };
}

function buildConditions(
  workspaceId: string,
  options?: Omit<ApprovalFilterOptions, "limit" | "offset">,
) {
  const conditions = [eq(approvalRequests.workspaceId, workspaceId)];
  if (options?.status) {
    conditions.push(eq(approvalRequests.status, options.status));
  }
  if (options?.resourceType) {
    conditions.push(eq(approvalRequests.resourceType, options.resourceType));
  }
  if (options?.requestedBy) {
    conditions.push(eq(approvalRequests.requestedBy, options.requestedBy));
  }
  return conditions;
}

export class DrizzleApprovalRepository implements ApprovalRepository {
  constructor(private readonly db: DbClient) {}

  async findById(id: string): Promise<ApprovalRequest | null> {
    const rows = await this.db
      .select()
      .from(approvalRequests)
      .where(eq(approvalRequests.id, id))
      .limit(1);
    return rows.length > 0 ? rowToEntity(rows[0]) : null;
  }

  async findByWorkspace(
    workspaceId: string,
    options?: ApprovalFilterOptions,
  ): Promise<ApprovalRequest[]> {
    const conditions = buildConditions(workspaceId, options);

    let query = this.db
      .select()
      .from(approvalRequests)
      .where(and(...conditions))
      .orderBy(desc(approvalRequests.requestedAt));

    if (options?.limit) {
      query = query.limit(options.limit) as typeof query;
    }
    if (options?.offset) {
      query = query.offset(options.offset) as typeof query;
    }

    const rows = await query;
    return rows.map(rowToEntity);
  }

  async countByWorkspace(
    workspaceId: string,
    options?: Omit<ApprovalFilterOptions, "limit" | "offset">,
  ): Promise<number> {
    const conditions = buildConditions(workspaceId, options);
    const result = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(approvalRequests)
      .where(and(...conditions));
    return Number(result[0]?.count ?? 0);
  }

  async create(req: Omit<ApprovalRequest, "id">): Promise<ApprovalRequest> {
    const id = randomUUID();
    await this.db.insert(approvalRequests).values({
      id,
      workspaceId: req.workspaceId,
      resourceType: req.resourceType,
      resourceId: req.resourceId,
      payload: req.payload == null ? null : JSON.stringify(req.payload),
      requestedBy: req.requestedBy,
      requestedAt: req.requestedAt,
      status: req.status,
      reviewedBy: req.reviewedBy,
      reviewedAt: req.reviewedAt,
      reason: req.reason,
    });
    return { ...req, id };
  }

  async update(id: string, data: Partial<ApprovalRequest>): Promise<ApprovalRequest> {
    const patch: Record<string, unknown> = {};
    if (data.status !== undefined) patch.status = data.status;
    if (data.reviewedBy !== undefined) patch.reviewedBy = data.reviewedBy;
    if (data.reviewedAt !== undefined) patch.reviewedAt = data.reviewedAt;
    if (data.reason !== undefined) patch.reason = data.reason;
    if (data.resourceType !== undefined) patch.resourceType = data.resourceType;
    if (data.resourceId !== undefined) patch.resourceId = data.resourceId;
    if (data.payload !== undefined) {
      patch.payload = data.payload == null ? null : JSON.stringify(data.payload);
    }
    if (data.requestedAt !== undefined) patch.requestedAt = data.requestedAt;
    if (data.requestedBy !== undefined) patch.requestedBy = data.requestedBy;

    if (Object.keys(patch).length > 0) {
      await this.db.update(approvalRequests).set(patch).where(eq(approvalRequests.id, id));
    }

    const rows = await this.db
      .select()
      .from(approvalRequests)
      .where(eq(approvalRequests.id, id))
      .limit(1);
    if (rows.length === 0) {
      throw new Error(`ApprovalRequest not found after update: ${id}`);
    }
    return rowToEntity(rows[0]);
  }

  async expirePending(cutoff: Date): Promise<number> {
    // 対象件数を先にカウント（更新後の戻り値 rowsAffected は driver 依存のため）
    const targets = await this.db
      .select({ id: approvalRequests.id })
      .from(approvalRequests)
      .where(and(eq(approvalRequests.status, "pending"), lt(approvalRequests.requestedAt, cutoff)));

    if (targets.length === 0) return 0;

    await this.db
      .update(approvalRequests)
      .set({ status: "expired" })
      .where(and(eq(approvalRequests.status, "pending"), lt(approvalRequests.requestedAt, cutoff)));

    return targets.length;
  }
}
