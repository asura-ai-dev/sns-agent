/**
 * 使用量ユースケース
 *
 * Task 4003: SNS API / LLM API の使用量を記録し、日次・週次・月次で集計する。
 * design.md セクション 3.1 (usage_records)、4.2 (/api/usage)、
 * spec.md AC-9 (CLI usage report)、AC-14 (Web UI 使用量画面) に準拠。
 */
import type { ActorType, UsageRecord } from "../domain/entities.js";
import type {
  UsageRepository,
  UsageAggregation,
  UsageAggregationDimension,
} from "../interfaces/repositories.js";
import { ValidationError } from "../errors/domain-error.js";

// ───────────────────────────────────────────
// 依存注入コンテキスト
// ───────────────────────────────────────────

export interface UsageUsecaseDeps {
  usageRepo: UsageRepository;
}

// ───────────────────────────────────────────
// 入出力型
// ───────────────────────────────────────────

export type UsagePeriod = "daily" | "weekly" | "monthly";

export interface RecordUsageInput {
  workspaceId: string;
  /** 'x' | 'line' | 'instagram' | 'openai' | 'anthropic' 等 */
  platform: string;
  /** エンドポイント識別子 (例: 'tweet.create', 'gpt-4o') */
  endpoint: string;
  /** Engagement gate 由来の usage なら gate id */
  gateId?: string | null;
  /** caller-provided feature label such as engagement_gate */
  feature?: string | null;
  /** Provider or feature-specific metadata */
  metadata?: Record<string, unknown> | null;
  actorId: string | null;
  actorType: ActorType;
  success: boolean;
  /** 推定コスト (USD)。省略時は null */
  estimatedCostUsd?: number | null;
  /** リクエスト件数。省略時は 1 */
  requestCount?: number;
  /** 記録時刻。省略時は new Date() */
  recordedAt?: Date;
}

export interface UsageReportFilters {
  platform?: string;
  endpoint?: string;
  gateId?: string;
  dimension?: UsageAggregationDimension;
  period?: UsagePeriod;
  from?: Date;
  to?: Date;
}

export interface UsageReportEntry {
  period: string;
  platform: string;
  endpoint?: string | null;
  gateId?: string | null;
  feature?: string | null;
  requestCount: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  estimatedCost: number;
}

export interface UsageReport {
  data: UsageReportEntry[];
  range: { from: Date; to: Date };
  period: UsagePeriod;
}

export interface UsageSummary {
  totalCost: number;
  totalRequests: number;
  successRate: number;
  byPlatform: Record<
    string,
    {
      totalRequests: number;
      successCount: number;
      failureCount: number;
      totalCostUsd: number;
    }
  >;
  range: { from: Date; to: Date };
}

// ───────────────────────────────────────────
// 期間計算ヘルパー
// ───────────────────────────────────────────

/**
 * 現在時刻を基準にした今月の開始時刻 (月初 00:00:00) を返す。
 * 時刻は UTC 基準で計算する (テスト容易性のため)。
 */
export function getMonthStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}

/** 今月末の最終時刻 (次月 0 時) */
export function getMonthEnd(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
}

/**
 * period の時刻を切り捨ててバケットキーを返す。
 * daily: YYYY-MM-DD
 * weekly: YYYY-Www (ISO 週)
 * monthly: YYYY-MM
 */
export function formatPeriodKey(date: Date, period: UsagePeriod): string {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  if (period === "daily") {
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  if (period === "monthly") {
    return `${y}-${String(m).padStart(2, "0")}`;
  }
  // weekly: ISO 週番号
  return `${y}-W${String(getIsoWeek(date)).padStart(2, "0")}`;
}

/** ISO 8601 週番号を返す */
function getIsoWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // 木曜日を基準に ISO 週を算出
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/** period / from / to のデフォルト値を解決する */
function resolveRange(
  filters: UsageReportFilters,
  now: Date = new Date(),
): { period: UsagePeriod; from: Date; to: Date } {
  const period: UsagePeriod = filters.period ?? "daily";
  const to = filters.to ?? now;
  let from = filters.from;
  if (!from) {
    // デフォルトは period に応じた過去範囲
    if (period === "daily") {
      // 過去 30 日
      from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    } else if (period === "weekly") {
      // 過去 12 週
      from = new Date(to.getTime() - 12 * 7 * 24 * 60 * 60 * 1000);
    } else {
      // 過去 12 ヶ月
      from = new Date(Date.UTC(to.getUTCFullYear() - 1, to.getUTCMonth(), 1, 0, 0, 0, 0));
    }
  }
  if (from > to) {
    throw new ValidationError("from must be earlier than to");
  }
  return { period, from, to };
}

// ───────────────────────────────────────────
// ユースケース: recordUsage
// ───────────────────────────────────────────

/**
 * 使用量レコードを 1 件挿入する。
 *
 * Provider 呼び出し後のユースケース層から呼ばれることを想定している。
 * estimatedCostUsd が未指定の場合、呼び出し側で cost-table から算出しておくこと。
 */
export async function recordUsage(
  deps: UsageUsecaseDeps,
  input: RecordUsageInput,
): Promise<UsageRecord> {
  if (!input.workspaceId) {
    throw new ValidationError("workspaceId is required");
  }
  if (!input.platform) {
    throw new ValidationError("platform is required");
  }
  if (!input.endpoint) {
    throw new ValidationError("endpoint is required");
  }
  const now = input.recordedAt ?? new Date();
  return deps.usageRepo.record({
    workspaceId: input.workspaceId,
    platform: input.platform,
    endpoint: input.endpoint,
    gateId: input.gateId ?? null,
    feature: input.feature ?? null,
    metadata: input.metadata ?? null,
    actorId: input.actorId,
    actorType: input.actorType,
    requestCount: input.requestCount ?? 1,
    success: input.success,
    estimatedCostUsd: input.estimatedCostUsd ?? null,
    recordedAt: now,
  });
}

// ───────────────────────────────────────────
// ユースケース: getUsageReport
// ───────────────────────────────────────────

/**
 * 使用量レポートを集計して返す。
 * period (daily / weekly / monthly) でバケット分割する。
 *
 * 現状の Repository は `aggregate(workspaceId, { platform, startDate, endDate })`
 * のシグネチャで期間全体の platform 別集計しか持たないため、
 * period 分割は使用量ユースケース層で複数バケットに分けて aggregate を呼び、
 * 結果をマージする。
 *
 * Repository 側の大規模変更を避け、v1 スコープ内で動く最小構成とする。
 */
export async function getUsageReport(
  deps: UsageUsecaseDeps,
  workspaceId: string,
  filters: UsageReportFilters = {},
): Promise<UsageReport> {
  const { period, from, to } = resolveRange(filters);
  const buckets = enumerateBuckets(from, to, period);

  const entries: UsageReportEntry[] = [];
  for (const bucket of buckets) {
    const aggregations = await deps.usageRepo.aggregate(workspaceId, {
      platform: filters.platform,
      endpoint: filters.endpoint,
      gateId: filters.gateId,
      dimension: filters.dimension,
      startDate: bucket.start,
      endDate: bucket.end,
    });
    for (const agg of aggregations) {
      const total = agg.totalRequests || 0;
      const successRate = total > 0 ? agg.successCount / total : 0;
      entries.push({
        period: bucket.key,
        platform: agg.platform,
        endpoint: agg.endpoint ?? undefined,
        gateId: agg.gateId ?? undefined,
        feature: agg.feature ?? undefined,
        requestCount: total,
        successCount: agg.successCount,
        failureCount: agg.failureCount,
        successRate,
        estimatedCost: agg.totalCostUsd,
      });
    }
  }

  return {
    data: entries,
    range: { from, to },
    period,
  };
}

interface PeriodBucket {
  key: string;
  start: Date;
  end: Date;
}

/**
 * [from, to] を period で分割したバケット配列を返す。
 * 各バケットの end は次バケットの start を指す半開区間 [start, end)。
 */
function enumerateBuckets(from: Date, to: Date, period: UsagePeriod): PeriodBucket[] {
  const buckets: PeriodBucket[] = [];
  let cursor = floorToPeriod(from, period);
  // guardrail: 最大バケット数 (daily: 366, weekly: 60, monthly: 36)
  const max = period === "daily" ? 366 : period === "weekly" ? 60 : 36;
  while (cursor < to && buckets.length < max) {
    const next = advancePeriod(cursor, period);
    buckets.push({
      key: formatPeriodKey(cursor, period),
      start: cursor,
      end: next > to ? to : next,
    });
    cursor = next;
  }
  return buckets;
}

function floorToPeriod(date: Date, period: UsagePeriod): Date {
  if (period === "daily") {
    return new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0),
    );
  }
  if (period === "monthly") {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0));
  }
  // weekly: ISO 週の月曜 00:00 UTC
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0),
  );
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - (dayNum - 1));
  return d;
}

function advancePeriod(date: Date, period: UsagePeriod): Date {
  if (period === "daily") {
    return new Date(date.getTime() + 24 * 60 * 60 * 1000);
  }
  if (period === "weekly") {
    return new Date(date.getTime() + 7 * 24 * 60 * 60 * 1000);
  }
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1, 0, 0, 0, 0));
}

// ───────────────────────────────────────────
// ユースケース: getUsageSummary
// ───────────────────────────────────────────

/**
 * ダッシュボード用の今月サマリを返す。
 * - 今月の合計コスト、リクエスト数、成功率
 * - SNS (platform) 別の内訳
 */
export async function getUsageSummary(
  deps: UsageUsecaseDeps,
  workspaceId: string,
  now: Date = new Date(),
): Promise<UsageSummary> {
  const from = getMonthStart(now);
  const to = getMonthEnd(now);

  const aggregations = await deps.usageRepo.aggregate(workspaceId, {
    startDate: from,
    endDate: to,
  });

  let totalRequests = 0;
  let totalSuccess = 0;
  let totalCost = 0;
  const byPlatform: UsageSummary["byPlatform"] = {};

  for (const agg of aggregations) {
    totalRequests += agg.totalRequests;
    totalSuccess += agg.successCount;
    totalCost += agg.totalCostUsd;
    byPlatform[agg.platform] = {
      totalRequests: agg.totalRequests,
      successCount: agg.successCount,
      failureCount: agg.failureCount,
      totalCostUsd: agg.totalCostUsd,
    };
  }

  const successRate = totalRequests > 0 ? totalSuccess / totalRequests : 0;

  return {
    totalCost,
    totalRequests,
    successRate,
    byPlatform,
    range: { from, to },
  };
}
