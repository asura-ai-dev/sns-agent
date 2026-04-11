/**
 * BudgetPolicyRepository の Drizzle 実装（骨格）
 * core/interfaces/repositories.ts の BudgetPolicyRepository に準拠
 */
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { BudgetPolicyRepository } from "@sns-agent/core";
import type { BudgetPolicy } from "@sns-agent/core";
import { budgetPolicies } from "../schema/budget-policies.js";
import type { DbClient } from "../client.js";

function rowToEntity(row: typeof budgetPolicies.$inferSelect): BudgetPolicy {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    scopeType: row.scopeType as BudgetPolicy["scopeType"],
    scopeValue: row.scopeValue,
    period: row.period as BudgetPolicy["period"],
    limitAmountUsd: row.limitAmountUsd,
    actionOnExceed: row.actionOnExceed as BudgetPolicy["actionOnExceed"],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class DrizzleBudgetPolicyRepository implements BudgetPolicyRepository {
  constructor(private readonly db: DbClient) {}

  async findById(id: string): Promise<BudgetPolicy | null> {
    const rows = await this.db
      .select()
      .from(budgetPolicies)
      .where(eq(budgetPolicies.id, id))
      .limit(1);
    if (rows.length === 0) return null;
    return rowToEntity(rows[0]);
  }

  async findByWorkspace(workspaceId: string): Promise<BudgetPolicy[]> {
    const rows = await this.db
      .select()
      .from(budgetPolicies)
      .where(eq(budgetPolicies.workspaceId, workspaceId));
    return rows.map(rowToEntity);
  }

  async create(
    policy: Omit<BudgetPolicy, "id" | "createdAt" | "updatedAt">,
  ): Promise<BudgetPolicy> {
    const now = new Date();
    const id = randomUUID();
    await this.db.insert(budgetPolicies).values({
      id,
      workspaceId: policy.workspaceId,
      scopeType: policy.scopeType,
      scopeValue: policy.scopeValue,
      period: policy.period,
      limitAmountUsd: policy.limitAmountUsd,
      actionOnExceed: policy.actionOnExceed,
      createdAt: now,
      updatedAt: now,
    });
    return { ...policy, id, createdAt: now, updatedAt: now };
  }

  async update(id: string, data: Partial<BudgetPolicy>): Promise<BudgetPolicy> {
    const now = new Date();
    const updateData: Record<string, unknown> = { ...data, updatedAt: now };
    delete updateData.id;
    delete updateData.createdAt;

    await this.db.update(budgetPolicies).set(updateData).where(eq(budgetPolicies.id, id));

    const rows = await this.db
      .select()
      .from(budgetPolicies)
      .where(eq(budgetPolicies.id, id))
      .limit(1);
    if (rows.length === 0) {
      throw new Error(`BudgetPolicy not found: ${id}`);
    }
    return rowToEntity(rows[0]);
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(budgetPolicies).where(eq(budgetPolicies.id, id));
  }
}
