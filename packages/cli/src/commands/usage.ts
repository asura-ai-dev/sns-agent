/**
 * sns usage コマンド
 *
 * - sns usage report [--platform <p>] [--range <daily|weekly|monthly>] [--json]
 * - sns usage summary [--json]
 *
 * SDK の SnsAgentClient.usage リソース経由で API を呼ぶ。
 * usage API (Phase 4) が未実装でも SDK 呼び出しの骨格として機能し、
 * 404 等のエラーは errors.ts 経由で整形されて表示される。
 */

import { Command } from "commander";
import type { UsageRecord, UsageReportParams } from "@sns-agent/sdk";
import { runCommand, type GlobalOptions } from "../context.js";

/** report サブコマンドの列定義 */
const REPORT_COLUMNS: Array<[string, string]> = [
  ["ID", "id"],
  ["PLATFORM", "platform"],
  ["ENDPOINT", "endpoint"],
  ["REQUESTS", "requestCount"],
  ["SUCCESSES", "successCount"],
  ["FAILURES", "failureCount"],
  ["COST_USD", "estimatedCostUsd"],
  ["PERIOD", "periodStart"],
];

/** summary サブコマンドの列定義 */
const SUMMARY_COLUMNS: Array<[string, string]> = [
  ["METRIC", "metric"],
  ["VALUE", "value"],
];

/** 親コマンドからグローバルオプションを拾う */
function getGlobalOpts(cmd: Command): GlobalOptions {
  let current: Command | null = cmd;
  while (current) {
    const opts = current.opts() as GlobalOptions;
    if (opts && (opts.json !== undefined || opts.apiUrl || opts.apiKey)) {
      return opts;
    }
    current = current.parent;
  }
  return {};
}

/** range 指定を UsageReportParams.period に正規化する */
function normalizeRange(range: string | undefined): "daily" | "weekly" | "monthly" {
  const r = (range ?? "monthly").toLowerCase();
  if (r === "daily" || r === "weekly" || r === "monthly") {
    return r;
  }
  throw Object.assign(
    new Error(`Invalid --range '${range}'. Expected one of: daily, weekly, monthly.`),
    { code: "VALID_RANGE" },
  );
}

export function registerUsageCommand(program: Command): void {
  const usage = program.command("usage").description("View API usage and cost");

  // ---- report ----
  usage
    .command("report")
    .description("Show API usage report (counts, cost per platform / endpoint)")
    .option("--platform <platform>", "Filter by platform (x | line | instagram)")
    .option("--range <range>", "Aggregation period: daily | weekly | monthly (default: monthly)")
    .action(async (subOpts: { platform?: string; range?: string }, cmd: Command) => {
      const globals = getGlobalOpts(cmd);
      await runCommand(globals, async (ctx) => {
        const period = normalizeRange(subOpts.range);
        const params: UsageReportParams = { period };
        if (subOpts.platform) params.platform = subOpts.platform;
        const res = await ctx.client.usage.report(params);
        const items: UsageRecord[] = res.data;
        ctx.formatter.data(items, {
          title: `Usage report (${period}${subOpts.platform ? `, ${subOpts.platform}` : ""}) - ${items.length} record(s)`,
          columns: REPORT_COLUMNS,
          emptyMessage: "No usage records found for this period.",
        });
      });
    });

  // ---- summary ----
  usage
    .command("summary")
    .description("Show aggregated usage summary across all platforms")
    .action(async (_subOpts: Record<string, unknown>, cmd: Command) => {
      const globals = getGlobalOpts(cmd);
      await runCommand(globals, async (ctx) => {
        const res = await ctx.client.usage.summary();
        if (ctx.json) {
          // JSON モードでは summary オブジェクトをそのまま出力する
          ctx.formatter.data(res.data, { title: "Usage summary" });
          return;
        }
        // 人間可読モードでは metric/value のテーブルに整形する
        const s = res.data;
        const rows = [
          { metric: "totalRequests", value: s.totalRequests },
          { metric: "totalSuccesses", value: s.totalSuccesses },
          { metric: "totalFailures", value: s.totalFailures },
          { metric: "estimatedCostUsd", value: s.estimatedCostUsd },
        ];
        ctx.formatter.data(rows, {
          title: "Usage summary",
          columns: SUMMARY_COLUMNS,
        });
      });
    });
}
