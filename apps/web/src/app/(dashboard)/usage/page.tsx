/**
 * Usage page (Treasury Bulletin) — Task 4005
 *
 * Server Component. Aggregates `/api/usage`, `/api/usage/summary`, and
 * `/api/budget/status` through the safe fetchers in `@/lib/api`. The period
 * is read from `?period=daily|weekly|monthly` (default: daily). The platform
 * filter is purely client-side and does not affect the fetch.
 *
 * Failure mode: if any sub-fetch fails (e.g. the API process is not up), the
 * page still renders with zeroed payloads + a wire-offline banner.
 *
 * spec.md AC-14: SNS API / LLM API の使用量と推定コストがグラフ表示される。
 */
import { fetchUsageReportSafe, fetchBudgetStatusSafe } from "@/lib/api";
import type { UsagePeriod } from "@/lib/api";
import { SECTION_KICKERS } from "@/lib/i18n/labels";

import { UsageMasthead } from "@/components/usage/UsageMasthead";
import { UsagePageView } from "@/components/usage/UsagePageView";
import type { UsageViewModel } from "@/components/usage/types";

const VALID_PERIODS: UsagePeriod[] = ["daily", "weekly", "monthly"];

function parsePeriod(raw: string | string[] | undefined): UsagePeriod {
  if (Array.isArray(raw)) raw = raw[0];
  if (raw && (VALID_PERIODS as string[]).includes(raw)) return raw as UsagePeriod;
  return "daily";
}

/** Build the contiguous "previous comparable range" for a given period. */
function previousRange(period: UsagePeriod, now: Date): { from: Date; to: Date } {
  const to = new Date(now);
  const from = new Date(now);
  if (period === "daily") {
    to.setUTCDate(to.getUTCDate() - 7);
    from.setUTCDate(from.getUTCDate() - 14);
  } else if (period === "weekly") {
    to.setUTCDate(to.getUTCDate() - 28);
    from.setUTCDate(from.getUTCDate() - 56);
  } else {
    to.setUTCMonth(to.getUTCMonth() - 6);
    from.setUTCMonth(from.getUTCMonth() - 12);
  }
  return { from, to };
}

export const dynamic = "force-dynamic";

interface UsagePageProps {
  // Next.js 15: searchParams is async on app router pages.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function UsagePage({ searchParams }: UsagePageProps) {
  const sp = await searchParams;
  const period = parsePeriod(sp.period);

  // Current range (server-resolved by API).
  const reportRes = await fetchUsageReportSafe({ period });
  const endpointRes = await fetchUsageReportSafe({ period, platform: "x", dimension: "endpoint" });
  const gateRes = await fetchUsageReportSafe({ period, platform: "x", dimension: "gate" });

  // Previous range for delta cards.
  const now = new Date();
  const prevRange = previousRange(period, now);
  const prevRes = await fetchUsageReportSafe({
    period,
    from: prevRange.from.toISOString(),
    to: prevRange.to.toISOString(),
  });

  // Budget status (independent fetch).
  const budgetRes = await fetchBudgetStatusSafe();

  // Compute current totals from entries.
  const totals = {
    requestCount: 0,
    successCount: 0,
    failureCount: 0,
    estimatedCost: 0,
    successRate: 0,
  };
  for (const e of reportRes.data.entries) {
    totals.requestCount += e.requestCount;
    totals.successCount += e.successCount;
    totals.failureCount += e.failureCount;
    totals.estimatedCost += e.estimatedCost ?? 0;
  }
  totals.successRate = totals.requestCount > 0 ? totals.successCount / totals.requestCount : 0;

  const prevTotals = {
    requestCount: 0,
    estimatedCost: 0,
  };
  for (const e of prevRes.data.entries) {
    prevTotals.requestCount += e.requestCount;
    prevTotals.estimatedCost += e.estimatedCost ?? 0;
  }

  const meta = reportRes.data.meta;
  const range = {
    from: meta?.from ?? new Date().toISOString(),
    to: meta?.to ?? new Date().toISOString(),
  };

  const viewModel: UsageViewModel = {
    period,
    platformFilter: "all",
    entries: reportRes.data.entries,
    endpointEntries: endpointRes.data.entries,
    gateEntries: gateRes.data.entries,
    totals,
    previousTotals: prevTotals,
    range,
    isFallback:
      reportRes.isFallback || prevRes.isFallback || endpointRes.isFallback || gateRes.isFallback,
    errorMessage:
      reportRes.errorMessage ??
      prevRes.errorMessage ??
      endpointRes.errorMessage ??
      gateRes.errorMessage,
    endpointErrorMessage: endpointRes.errorMessage,
    gateErrorMessage: gateRes.errorMessage,
  };

  const degraded = viewModel.isFallback || budgetRes.isFallback;
  const errorLines = [
    reportRes.errorMessage && `使用量レポート: ${reportRes.errorMessage}`,
    endpointRes.errorMessage && `エンドポイント別使用量: ${endpointRes.errorMessage}`,
    gateRes.errorMessage && `ゲート別使用量: ${gateRes.errorMessage}`,
    prevRes.errorMessage && `前期間: ${prevRes.errorMessage}`,
    budgetRes.errorMessage && `予算状況: ${budgetRes.errorMessage}`,
  ].filter(Boolean) as string[];

  return (
    <div className="mx-auto max-w-[1440px] space-y-7">
      <UsageMasthead
        now={now}
        rangeFrom={range.from}
        rangeTo={range.to}
        degraded={degraded}
        errorLines={errorLines}
      />

      <UsagePageView
        viewModel={viewModel}
        budgetStatuses={budgetRes.data}
        budgetIsFallback={budgetRes.isFallback}
      />

      <footer className="border-t border-dashed border-base-content/20 pt-3 font-mono text-[9px] uppercase tracking-[0.22em] text-base-content/35">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>sns agent · {SECTION_KICKERS.usage.toLowerCase()}</span>
          <span>set in fraunces &amp; dm sans · period · {period}</span>
          <span>— printed server-side —</span>
        </div>
      </footer>
    </div>
  );
}
