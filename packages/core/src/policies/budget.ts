/**
 * 予算ポリシー評価ロジック (Task 4004)
 *
 * design.md セクション 3.1 (budget_policies)、セクション 4.2 (/api/budget)、
 * architecture.md セクション 13.3 (制御ポリシー)、spec.md 主要機能 10 に準拠。
 *
 * 評価ルール:
 * - 該当するポリシーを scope の優先度順 (endpoint > platform > workspace) で検索し、
 *   最も具体的なポリシーを適用する。
 * - 現在期間 (daily / weekly / monthly) の消費額を usage_records から集計する。
 * - additionalCost を加算した見込み消費額と limit を比較する。
 * - ポリシー定義の action が warn / require-approval / block のいずれでも、
 *   80% 到達時には警告フラグを立てる（ポリシー action に関わらず）。
 */
import type { BudgetAction, Platform } from "@sns-agent/config";
import type { BudgetPolicy, BudgetPeriod } from "../domain/entities.js";
import type { BudgetPolicyRepository, UsageRepository } from "../interfaces/repositories.js";

// ───────────────────────────────────────────
// 入出力型
// ───────────────────────────────────────────

export interface EvaluateBudgetPolicyDeps {
  budgetPolicyRepo: BudgetPolicyRepository;
  usageRepo: UsageRepository;
}

export interface EvaluateBudgetPolicyInput {
  workspaceId: string;
  /** 対象 SNS / LLM プロバイダ ('x' | 'line' | 'instagram' | 'openai' など) */
  platform: string;
  /** 対象エンドポイント ('post.publish' 'tweet.create' など) */
  endpoint: string;
  /** これから発生させる追加コスト (USD)。0 を許容 */
  additionalCost: number;
  /** 評価基準時刻。省略時は現在時刻（テスト向け） */
  now?: Date;
}

/**
 * 予算ポリシー評価結果。
 *
 * - allowed: true なら公開を続行してよい (warn でも true)。block のみ false。
 * - action: 適用されるアクション ('warn' | 'require-approval' | 'block').
 *           該当するポリシーがない場合は 'warn' を返し warningOnly=true とする。
 * - matchedPolicy: 適用されたポリシー。ポリシーがない場合は null。
 * - consumed: 現在期間の既消費額 (USD)。
 * - projected: consumed + additionalCost。
 * - limit: ポリシーの上限額。ポリシーがない場合は null。
 * - percentage: projected / limit （0-1）。ポリシーがない場合は 0。
 * - warning: 80% 到達時に true。block / require-approval の場合は action が優先される。
 * - reason: ログ・UI 表示用の簡潔な理由文字列。
 */
export interface BudgetEvaluation {
  allowed: boolean;
  action: BudgetAction;
  matchedPolicy: BudgetPolicy | null;
  consumed: number;
  projected: number;
  limit: number | null;
  percentage: number;
  warning: boolean;
  reason: string;
}

// ───────────────────────────────────────────
// scope 優先度ルール
// ───────────────────────────────────────────

/**
 * 対象ポリシーが与えられた platform/endpoint にマッチするか判定する。
 * - workspace: 常にマッチ
 * - platform:  scope_value === platform なら一致
 * - endpoint:  scope_value === endpoint なら一致
 */
function isPolicyMatching(policy: BudgetPolicy, platform: string, endpoint: string): boolean {
  switch (policy.scopeType) {
    case "workspace":
      return true;
    case "platform":
      return policy.scopeValue === platform;
    case "endpoint":
      return policy.scopeValue === endpoint;
    default:
      return false;
  }
}

/**
 * scope の優先度順にポリシーを並べ替える（endpoint > platform > workspace）。
 * 同スコープ内は createdAt 昇順（安定ソート用）。
 */
function comparePolicyScope(a: BudgetPolicy, b: BudgetPolicy): number {
  const rank: Record<BudgetPolicy["scopeType"], number> = {
    endpoint: 0,
    platform: 1,
    workspace: 2,
  };
  const diff = rank[a.scopeType] - rank[b.scopeType];
  if (diff !== 0) return diff;
  return a.createdAt.getTime() - b.createdAt.getTime();
}

// ───────────────────────────────────────────
// 期間計算
// ───────────────────────────────────────────

/**
 * 指定期間の開始時刻を返す（UTC）。
 * daily   : 当日 00:00:00
 * weekly  : 当週月曜 00:00:00 (ISO 8601)
 * monthly : 当月 1 日 00:00:00
 */
export function getPeriodStart(period: BudgetPeriod, now: Date = new Date()): Date {
  if (period === "daily") {
    return new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0),
    );
  }
  if (period === "monthly") {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  }
  // weekly: ISO 週の月曜 00:00 UTC
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0),
  );
  const dayNum = d.getUTCDay() || 7; // 日曜=0 を 7 扱い
  d.setUTCDate(d.getUTCDate() - (dayNum - 1));
  return d;
}

/**
 * 指定期間の終了時刻（次期間の開始）を返す。
 */
export function getPeriodEnd(period: BudgetPeriod, now: Date = new Date()): Date {
  if (period === "daily") {
    const start = getPeriodStart("daily", now);
    return new Date(start.getTime() + 24 * 60 * 60 * 1000);
  }
  if (period === "monthly") {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  }
  const start = getPeriodStart("weekly", now);
  return new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
}

// ───────────────────────────────────────────
// 消費額集計
// ───────────────────────────────────────────

/**
 * 指定ポリシーの現在期間における消費額を集計する。
 * scope に応じて usage_records を filter する:
 * - workspace: workspaceId のみ
 * - platform: workspaceId + platform
 * - endpoint: workspaceId + endpoint (および platform が推定可能なら併用)
 */
async function sumConsumedForPolicy(
  deps: EvaluateBudgetPolicyDeps,
  workspaceId: string,
  policy: BudgetPolicy,
  now: Date,
): Promise<number> {
  const startDate = getPeriodStart(policy.period, now);
  const endDate = getPeriodEnd(policy.period, now);

  const options: Parameters<UsageRepository["aggregate"]>[1] = {
    startDate,
    endDate,
  };
  if (policy.scopeType === "platform" && policy.scopeValue) {
    options.platform = policy.scopeValue;
  } else if (policy.scopeType === "endpoint" && policy.scopeValue) {
    options.endpoint = policy.scopeValue;
  }

  const aggregations = await deps.usageRepo.aggregate(workspaceId, options);
  return aggregations.reduce((sum, agg) => sum + (agg.totalCostUsd ?? 0), 0);
}

// ───────────────────────────────────────────
// メイン: evaluateBudgetPolicy
// ───────────────────────────────────────────

/**
 * 予算ポリシーを評価する。
 *
 * @returns BudgetEvaluation
 *
 * フロー:
 * 1. workspace のポリシー一覧を取得
 * 2. platform/endpoint にマッチするものだけ残す
 * 3. scope の優先度 (endpoint > platform > workspace) でソートし、最上位を採用
 * 4. 該当ポリシーがない場合は allowed=true, action='warn', warning=false
 * 5. 該当ポリシーの期間内消費額を集計
 * 6. projected = consumed + additionalCost
 * 7. percentage = projected / limit
 * 8. percentage >= 1 なら action を policy.actionOnExceed に従う
 *    - 'block'            -> allowed=false
 *    - 'require-approval' -> allowed=true (呼び出し側で承認フロー)
 *    - 'warn'             -> allowed=true
 * 9. percentage >= 0.8 (かつ超過してない) なら warning=true, action='warn'
 */
export async function evaluateBudgetPolicy(
  deps: EvaluateBudgetPolicyDeps,
  input: EvaluateBudgetPolicyInput,
): Promise<BudgetEvaluation> {
  const now = input.now ?? new Date();
  const additionalCost = Math.max(0, input.additionalCost);

  // 1. ポリシー取得
  const allPolicies = await deps.budgetPolicyRepo.findByWorkspace(input.workspaceId);

  // 2. マッチングフィルタ
  const matched = allPolicies
    .filter((p) => isPolicyMatching(p, input.platform, input.endpoint))
    .sort(comparePolicyScope);

  // 4. 該当なし
  if (matched.length === 0) {
    return {
      allowed: true,
      action: "warn",
      matchedPolicy: null,
      consumed: 0,
      projected: additionalCost,
      limit: null,
      percentage: 0,
      warning: false,
      reason: "no matching budget policy",
    };
  }

  const policy = matched[0];

  // 5. 消費額集計
  const consumed = await sumConsumedForPolicy(deps, input.workspaceId, policy, now);
  const projected = consumed + additionalCost;
  const limit = Number(policy.limitAmountUsd);
  const percentage = limit > 0 ? projected / limit : 0;

  // 8. 超過判定
  if (limit > 0 && projected > limit) {
    const action = policy.actionOnExceed;
    const allowed = action !== "block";
    return {
      allowed,
      action,
      matchedPolicy: policy,
      consumed,
      projected,
      limit,
      percentage,
      warning: true,
      reason: `budget ${policy.scopeType} exceeded: projected ${projected.toFixed(
        4,
      )} USD > limit ${limit.toFixed(2)} USD (action=${action})`,
    };
  }

  // 9. 80% 警告
  if (limit > 0 && percentage >= 0.8) {
    return {
      allowed: true,
      action: "warn",
      matchedPolicy: policy,
      consumed,
      projected,
      limit,
      percentage,
      warning: true,
      reason: `budget ${policy.scopeType} at ${(percentage * 100).toFixed(
        1,
      )}% of limit ${limit.toFixed(2)} USD`,
    };
  }

  // 通常範囲内
  return {
    allowed: true,
    action: "warn",
    matchedPolicy: policy,
    consumed,
    projected,
    limit,
    percentage,
    warning: false,
    reason: `within budget: projected ${projected.toFixed(4)} USD / limit ${limit.toFixed(2)} USD`,
  };
}

// ───────────────────────────────────────────
// 型再 export
// ───────────────────────────────────────────
export type { Platform };
