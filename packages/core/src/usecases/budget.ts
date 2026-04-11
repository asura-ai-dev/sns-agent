/**
 * 予算ポリシーユースケース (Task 4004)
 *
 * design.md セクション 3.1 (budget_policies)、セクション 4.2 (/api/budget)、
 * spec.md 主要機能 10 に準拠。
 *
 * 提供するユースケース:
 * - listPolicies      : ワークスペースのポリシー一覧
 * - createPolicy      : ポリシー作成
 * - updatePolicy      : ポリシー更新
 * - deletePolicy      : ポリシー削除
 * - getBudgetStatus   : 全ポリシーの現在消費状況
 */
import type { BudgetAction } from "@sns-agent/config";
import type { BudgetPolicy, BudgetPeriod, BudgetScopeType } from "../domain/entities.js";
import type { BudgetPolicyRepository, UsageRepository } from "../interfaces/repositories.js";
import { NotFoundError, ValidationError } from "../errors/domain-error.js";
import { getPeriodEnd, getPeriodStart } from "../policies/budget.js";

// ───────────────────────────────────────────
// 依存注入コンテキスト
// ───────────────────────────────────────────

export interface BudgetUsecaseDeps {
  budgetPolicyRepo: BudgetPolicyRepository;
  usageRepo: UsageRepository;
}

// ───────────────────────────────────────────
// 入出力型
// ───────────────────────────────────────────

export interface CreateBudgetPolicyInput {
  workspaceId: string;
  scopeType: BudgetScopeType;
  scopeValue?: string | null;
  period: BudgetPeriod;
  limitAmountUsd: number;
  actionOnExceed: BudgetAction;
}

export interface UpdateBudgetPolicyInput {
  scopeType?: BudgetScopeType;
  scopeValue?: string | null;
  period?: BudgetPeriod;
  limitAmountUsd?: number;
  actionOnExceed?: BudgetAction;
}

/** 単一ポリシーの現在消費状況 */
export interface BudgetPolicyStatus {
  policy: BudgetPolicy;
  consumed: number;
  limit: number;
  percentage: number;
  /** 80% 到達で true */
  warning: boolean;
  /** 100% 到達で true */
  exceeded: boolean;
  periodStart: Date;
  periodEnd: Date;
}

export interface BudgetStatusResult {
  data: BudgetPolicyStatus[];
}

// ───────────────────────────────────────────
// バリデーション
// ───────────────────────────────────────────

const VALID_SCOPE_TYPES: BudgetScopeType[] = ["workspace", "platform", "endpoint"];
const VALID_PERIODS: BudgetPeriod[] = ["daily", "weekly", "monthly"];
const VALID_ACTIONS: BudgetAction[] = ["warn", "require-approval", "block"];

function validateCreateInput(input: CreateBudgetPolicyInput): void {
  if (!input.workspaceId) {
    throw new ValidationError("workspaceId is required");
  }
  if (!VALID_SCOPE_TYPES.includes(input.scopeType)) {
    throw new ValidationError(
      `Invalid scopeType: ${input.scopeType}. Must be one of: ${VALID_SCOPE_TYPES.join(", ")}`,
    );
  }
  if (input.scopeType !== "workspace") {
    if (!input.scopeValue) {
      throw new ValidationError(`scopeValue is required for scopeType=${input.scopeType}`);
    }
  }
  if (!VALID_PERIODS.includes(input.period)) {
    throw new ValidationError(
      `Invalid period: ${input.period}. Must be one of: ${VALID_PERIODS.join(", ")}`,
    );
  }
  if (!VALID_ACTIONS.includes(input.actionOnExceed)) {
    throw new ValidationError(
      `Invalid actionOnExceed: ${input.actionOnExceed}. Must be one of: ${VALID_ACTIONS.join(", ")}`,
    );
  }
  if (!Number.isFinite(input.limitAmountUsd) || input.limitAmountUsd <= 0) {
    throw new ValidationError("limitAmountUsd must be a positive number");
  }
}

function validateUpdateInput(input: UpdateBudgetPolicyInput): void {
  if (input.scopeType !== undefined && !VALID_SCOPE_TYPES.includes(input.scopeType)) {
    throw new ValidationError(`Invalid scopeType: ${input.scopeType}`);
  }
  if (input.period !== undefined && !VALID_PERIODS.includes(input.period)) {
    throw new ValidationError(`Invalid period: ${input.period}`);
  }
  if (input.actionOnExceed !== undefined && !VALID_ACTIONS.includes(input.actionOnExceed)) {
    throw new ValidationError(`Invalid actionOnExceed: ${input.actionOnExceed}`);
  }
  if (input.limitAmountUsd !== undefined) {
    if (!Number.isFinite(input.limitAmountUsd) || input.limitAmountUsd <= 0) {
      throw new ValidationError("limitAmountUsd must be a positive number");
    }
  }
}

// ───────────────────────────────────────────
// ユースケース: listPolicies
// ───────────────────────────────────────────

export async function listPolicies(
  deps: BudgetUsecaseDeps,
  workspaceId: string,
): Promise<BudgetPolicy[]> {
  if (!workspaceId) {
    throw new ValidationError("workspaceId is required");
  }
  return deps.budgetPolicyRepo.findByWorkspace(workspaceId);
}

// ───────────────────────────────────────────
// ユースケース: createPolicy
// ───────────────────────────────────────────

export async function createPolicy(
  deps: BudgetUsecaseDeps,
  input: CreateBudgetPolicyInput,
): Promise<BudgetPolicy> {
  validateCreateInput(input);

  return deps.budgetPolicyRepo.create({
    workspaceId: input.workspaceId,
    scopeType: input.scopeType,
    scopeValue: input.scopeType === "workspace" ? null : (input.scopeValue ?? null),
    period: input.period,
    limitAmountUsd: input.limitAmountUsd,
    actionOnExceed: input.actionOnExceed,
  });
}

// ───────────────────────────────────────────
// ユースケース: updatePolicy
// ───────────────────────────────────────────

/**
 * ポリシーを更新する。ワークスペース一致を確認してから更新。
 */
export async function updatePolicy(
  deps: BudgetUsecaseDeps,
  workspaceId: string,
  policyId: string,
  input: UpdateBudgetPolicyInput,
): Promise<BudgetPolicy> {
  validateUpdateInput(input);

  const existing = await deps.budgetPolicyRepo.findById(policyId);
  if (!existing || existing.workspaceId !== workspaceId) {
    throw new NotFoundError("BudgetPolicy", policyId);
  }

  // scopeType を workspace に変更する場合は scopeValue を null にする
  const patch: Partial<BudgetPolicy> = { ...input };
  if (input.scopeType === "workspace") {
    patch.scopeValue = null;
  }

  return deps.budgetPolicyRepo.update(policyId, patch);
}

// ───────────────────────────────────────────
// ユースケース: deletePolicy
// ───────────────────────────────────────────

export async function deletePolicy(
  deps: BudgetUsecaseDeps,
  workspaceId: string,
  policyId: string,
): Promise<void> {
  const existing = await deps.budgetPolicyRepo.findById(policyId);
  if (!existing || existing.workspaceId !== workspaceId) {
    throw new NotFoundError("BudgetPolicy", policyId);
  }
  await deps.budgetPolicyRepo.delete(policyId);
}

// ───────────────────────────────────────────
// ユースケース: getBudgetStatus
// ───────────────────────────────────────────

/**
 * ワークスペースの全ポリシーについて、現在期間の消費状況を返す。
 * 各ポリシーごとに scope に応じた usage を aggregate して消費額を計算する。
 */
export async function getBudgetStatus(
  deps: BudgetUsecaseDeps,
  workspaceId: string,
  now: Date = new Date(),
): Promise<BudgetStatusResult> {
  if (!workspaceId) {
    throw new ValidationError("workspaceId is required");
  }

  const policies = await deps.budgetPolicyRepo.findByWorkspace(workspaceId);
  const data: BudgetPolicyStatus[] = [];

  for (const policy of policies) {
    const periodStart = getPeriodStart(policy.period, now);
    const periodEnd = getPeriodEnd(policy.period, now);

    const options: Parameters<UsageRepository["aggregate"]>[1] = {
      startDate: periodStart,
      endDate: periodEnd,
    };
    if (policy.scopeType === "platform" && policy.scopeValue) {
      options.platform = policy.scopeValue;
    } else if (policy.scopeType === "endpoint" && policy.scopeValue) {
      options.endpoint = policy.scopeValue;
    }

    const aggregations = await deps.usageRepo.aggregate(workspaceId, options);
    const consumed = aggregations.reduce((sum, a) => sum + (a.totalCostUsd ?? 0), 0);
    const limit = Number(policy.limitAmountUsd);
    const percentage = limit > 0 ? consumed / limit : 0;

    data.push({
      policy,
      consumed,
      limit,
      percentage,
      warning: percentage >= 0.8 && percentage < 1,
      exceeded: percentage >= 1,
      periodStart,
      periodEnd,
    });
  }

  return { data };
}
