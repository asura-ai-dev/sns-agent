/**
 * 使用量ルート (Task 4003)
 * design.md セクション 4.2: /api/usage, /api/usage/summary
 *
 * - GET /api/usage          : 期間集計レポート (usage:read)
 * - GET /api/usage/summary  : ダッシュボード用サマリ (usage:read)
 */
import { Hono } from "hono";
import { PLATFORMS } from "@sns-agent/config";
import type { Platform } from "@sns-agent/config";
import { getUsageReport, getUsageSummary, ValidationError } from "@sns-agent/core";
import type { UsagePeriod, UsageUsecaseDeps } from "@sns-agent/core";
import { DrizzleUsageRepository } from "@sns-agent/db";
import { requirePermission } from "../middleware/rbac.js";
import type { AppVariables } from "../types.js";

const usage = new Hono<{ Variables: AppVariables }>();

const VALID_PERIODS: UsagePeriod[] = ["daily", "weekly", "monthly"];
const VALID_DIMENSIONS = ["platform", "endpoint", "gate"] as const;

function buildDeps(db: AppVariables["db"]): UsageUsecaseDeps {
  return {
    usageRepo: new DrizzleUsageRepository(db),
  };
}

function parseDateOrUndefined(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

// ───────────────────────────────────────────
// GET /api/usage - 期間集計レポート
// ───────────────────────────────────────────
usage.get("/", requirePermission("usage:read"), async (c) => {
  const actor = c.get("actor");
  const db = c.get("db");
  const deps = buildDeps(db);

  const platformQ = c.req.query("platform");
  const endpointQ = c.req.query("endpoint");
  const gateIdQ = c.req.query("gateId");
  const dimensionQ = c.req.query("dimension");
  const periodQ = c.req.query("period");
  const fromQ = c.req.query("from");
  const toQ = c.req.query("to");

  if (platformQ && !PLATFORMS.includes(platformQ as Platform)) {
    throw new ValidationError(
      `Invalid platform: ${platformQ}. Must be one of: ${PLATFORMS.join(", ")}`,
    );
  }
  if (periodQ && !VALID_PERIODS.includes(periodQ as UsagePeriod)) {
    throw new ValidationError(
      `Invalid period: ${periodQ}. Must be one of: ${VALID_PERIODS.join(", ")}`,
    );
  }
  if (dimensionQ && !VALID_DIMENSIONS.includes(dimensionQ as (typeof VALID_DIMENSIONS)[number])) {
    throw new ValidationError(
      `Invalid dimension: ${dimensionQ}. Must be one of: ${VALID_DIMENSIONS.join(", ")}`,
    );
  }
  const from = parseDateOrUndefined(fromQ);
  const to = parseDateOrUndefined(toQ);
  if (fromQ && !from) {
    throw new ValidationError(`Invalid 'from' date: ${fromQ}`);
  }
  if (toQ && !to) {
    throw new ValidationError(`Invalid 'to' date: ${toQ}`);
  }

  const report = await getUsageReport(deps, actor.workspaceId, {
    platform: platformQ,
    endpoint: endpointQ,
    gateId: gateIdQ,
    dimension: dimensionQ as (typeof VALID_DIMENSIONS)[number] | undefined,
    period: periodQ as UsagePeriod | undefined,
    from,
    to,
  });

  return c.json({
    data: report.data.map((entry) => ({
      period: entry.period,
      platform: entry.platform,
      endpoint: entry.endpoint,
      gateId: entry.gateId,
      feature: entry.feature,
      requestCount: entry.requestCount,
      successCount: entry.successCount,
      failureCount: entry.failureCount,
      successRate: entry.successRate,
      estimatedCost: entry.estimatedCost,
    })),
    meta: {
      period: report.period,
      from: report.range.from.toISOString(),
      to: report.range.to.toISOString(),
    },
  });
});

// ───────────────────────────────────────────
// GET /api/usage/summary - 今月サマリ
// ───────────────────────────────────────────
usage.get("/summary", requirePermission("usage:read"), async (c) => {
  const actor = c.get("actor");
  const db = c.get("db");
  const deps = buildDeps(db);

  const summary = await getUsageSummary(deps, actor.workspaceId);

  return c.json({
    data: {
      totalCost: summary.totalCost,
      totalRequests: summary.totalRequests,
      successRate: summary.successRate,
      byPlatform: summary.byPlatform,
      range: {
        from: summary.range.from.toISOString(),
        to: summary.range.to.toISOString(),
      },
    },
  });
});

export { usage };
