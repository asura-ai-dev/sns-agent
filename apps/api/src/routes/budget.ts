/**
 * 予算ルート (Task 4004)
 *
 * design.md セクション 4.2: /api/budget
 * spec.md 主要機能 10 (予算ポリシー)
 *
 * - GET    /api/budget/policies      : ポリシー一覧 (budget:read)
 * - POST   /api/budget/policies      : ポリシー作成 (budget:manage)
 * - PATCH  /api/budget/policies/:id  : ポリシー更新 (budget:manage)
 * - DELETE /api/budget/policies/:id  : ポリシー削除 (budget:manage)
 * - GET    /api/budget/status        : 現在の消費状況 (budget:read)
 */
import { Hono } from "hono";
import {
  listBudgetPolicies,
  createBudgetPolicy,
  updateBudgetPolicy,
  deleteBudgetPolicy,
  getBudgetStatus,
  ValidationError,
} from "@sns-agent/core";
import type {
  BudgetPolicy,
  BudgetUsecaseDeps,
  CreateBudgetPolicyInput,
  UpdateBudgetPolicyInput,
  BudgetPolicyStatus,
} from "@sns-agent/core";
import { DrizzleBudgetPolicyRepository, DrizzleUsageRepository } from "@sns-agent/db";
import { requirePermission } from "../middleware/rbac.js";
import type { AppVariables } from "../types.js";

const budget = new Hono<{ Variables: AppVariables }>();

// ───────────────────────────────────────────
// ヘルパー
// ───────────────────────────────────────────

function buildDeps(db: AppVariables["db"]): BudgetUsecaseDeps {
  return {
    budgetPolicyRepo: new DrizzleBudgetPolicyRepository(db),
    usageRepo: new DrizzleUsageRepository(db),
  };
}

function serializePolicy(p: BudgetPolicy): Record<string, unknown> {
  return {
    id: p.id,
    workspaceId: p.workspaceId,
    scopeType: p.scopeType,
    scopeValue: p.scopeValue,
    period: p.period,
    limitAmountUsd: p.limitAmountUsd,
    actionOnExceed: p.actionOnExceed,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

function serializeStatus(s: BudgetPolicyStatus): Record<string, unknown> {
  return {
    policy: serializePolicy(s.policy),
    consumed: s.consumed,
    limit: s.limit,
    percentage: s.percentage,
    warning: s.warning,
    exceeded: s.exceeded,
    periodStart: s.periodStart.toISOString(),
    periodEnd: s.periodEnd.toISOString(),
  };
}

// ───────────────────────────────────────────
// GET /api/budget/policies
// ───────────────────────────────────────────
budget.get("/policies", requirePermission("budget:read"), async (c) => {
  const actor = c.get("actor");
  const db = c.get("db");
  const deps = buildDeps(db);
  const policies = await listBudgetPolicies(deps, actor.workspaceId);
  return c.json({ data: policies.map(serializePolicy) });
});

// ───────────────────────────────────────────
// POST /api/budget/policies
// ───────────────────────────────────────────
budget.post("/policies", requirePermission("budget:manage"), async (c) => {
  const actor = c.get("actor");
  const db = c.get("db");
  const deps = buildDeps(db);

  const body = await c.req.json<Partial<CreateBudgetPolicyInput>>();

  if (!body.scopeType) {
    throw new ValidationError("scopeType is required");
  }
  if (!body.period) {
    throw new ValidationError("period is required");
  }
  if (body.limitAmountUsd === undefined || body.limitAmountUsd === null) {
    throw new ValidationError("limitAmountUsd is required");
  }
  if (!body.actionOnExceed) {
    throw new ValidationError("actionOnExceed is required");
  }

  const created = await createBudgetPolicy(deps, {
    workspaceId: actor.workspaceId,
    scopeType: body.scopeType,
    scopeValue: body.scopeValue ?? null,
    period: body.period,
    limitAmountUsd: Number(body.limitAmountUsd),
    actionOnExceed: body.actionOnExceed,
  });

  return c.json({ data: serializePolicy(created) }, 201);
});

// ───────────────────────────────────────────
// PATCH /api/budget/policies/:id
// ───────────────────────────────────────────
budget.patch("/policies/:id", requirePermission("budget:manage"), async (c) => {
  const actor = c.get("actor");
  const db = c.get("db");
  const deps = buildDeps(db);
  const id = c.req.param("id");

  const body = await c.req.json<UpdateBudgetPolicyInput>();

  const updated = await updateBudgetPolicy(deps, actor.workspaceId, id, {
    ...(body.scopeType !== undefined && { scopeType: body.scopeType }),
    ...(body.scopeValue !== undefined && { scopeValue: body.scopeValue }),
    ...(body.period !== undefined && { period: body.period }),
    ...(body.limitAmountUsd !== undefined && {
      limitAmountUsd: Number(body.limitAmountUsd),
    }),
    ...(body.actionOnExceed !== undefined && { actionOnExceed: body.actionOnExceed }),
  });

  return c.json({ data: serializePolicy(updated) });
});

// ───────────────────────────────────────────
// DELETE /api/budget/policies/:id
// ───────────────────────────────────────────
budget.delete("/policies/:id", requirePermission("budget:manage"), async (c) => {
  const actor = c.get("actor");
  const db = c.get("db");
  const deps = buildDeps(db);
  const id = c.req.param("id");

  await deleteBudgetPolicy(deps, actor.workspaceId, id);
  return c.json({ data: { id, deleted: true } });
});

// ───────────────────────────────────────────
// GET /api/budget/status
// ───────────────────────────────────────────
budget.get("/status", requirePermission("budget:read"), async (c) => {
  const actor = c.get("actor");
  const db = c.get("db");
  const deps = buildDeps(db);

  const result = await getBudgetStatus(deps, actor.workspaceId);

  return c.json({
    data: result.data.map(serializeStatus),
  });
});

export { budget };
