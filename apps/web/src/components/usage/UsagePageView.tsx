/**
 * UsagePageView — Task 4005
 *
 * Client component that owns the period & platform filter state and routes
 * navigation back to the server when the period changes (server re-fetches
 * the appropriate aggregation). The platform filter is purely client-side —
 * it slices the already-fetched view model.
 *
 * Layout (broadsheet treasury bulletin):
 *   ┌─ filters row ───────────────────────────────────────────┐
 *   ├─ summary figures ────────────────────────────────────────┤
 *   ├─ headline chart ────────────────────────────────────────┤
 *   ├─ ledger table ──────────────────────────────────────────┤
 *   └─ allowances (budget bars) ──────────────────────────────┘
 */
"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Funnel, ArrowSquareOut } from "@phosphor-icons/react";

import type { BudgetStatusDto, UsagePeriod } from "@sns-agent/sdk";

import { UsageChart } from "./UsageChart";
import { SummaryFigures } from "./SummaryFigures";
import { PlatformLedgerTable } from "./PlatformLedgerTable";
import { BudgetConsumptionRows } from "./BudgetConsumptionRows";
import { PLATFORM_INK, PLATFORM_LABEL } from "./types";
import type { PlatformFilter, UsageViewModel } from "./types";

interface UsagePageViewProps {
  viewModel: UsageViewModel;
  budgetStatuses: BudgetStatusDto[];
  budgetIsFallback: boolean;
}

const PERIODS: { key: UsagePeriod; label: string; sub: string }[] = [
  { key: "daily", label: "日次", sub: "1日単位" },
  { key: "weekly", label: "週次", sub: "1週単位" },
  { key: "monthly", label: "月次", sub: "1か月単位" },
];

const PLATFORM_FILTERS: PlatformFilter[] = ["all", "x", "line", "instagram", "llm"];

export function UsagePageView({ viewModel, budgetStatuses, budgetIsFallback }: UsagePageViewProps) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [pending, startTransition] = useTransition();

  const [platformFilter, setPlatformFilter] = useState<PlatformFilter>(viewModel.platformFilter);

  function selectPeriod(p: UsagePeriod) {
    if (p === viewModel.period) return;
    const params = new URLSearchParams(search.toString());
    params.set("period", p);
    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`);
    });
  }

  // Sliced totals so summary cards reflect the platform filter too.
  const filteredTotals = useMemo(() => {
    if (platformFilter === "all") {
      return viewModel.totals;
    }
    let req = 0;
    let suc = 0;
    let fail = 0;
    let cost = 0;
    for (const e of viewModel.entries) {
      // Match using same classifier as the chart.
      const group =
        e.platform === "x" || e.platform === "line" || e.platform === "instagram"
          ? e.platform
          : "llm";
      if (group !== platformFilter) continue;
      req += e.requestCount;
      suc += e.successCount;
      fail += e.failureCount;
      cost += e.estimatedCost ?? 0;
    }
    return {
      requestCount: req,
      successCount: suc,
      failureCount: fail,
      estimatedCost: cost,
      successRate: req > 0 ? suc / req : 0,
    };
  }, [platformFilter, viewModel]);

  // Naive previous-period delta: use the legacy sample (server-provided).
  // Filtered platform always falls back to the global delta (UI conv.)
  const previousCost =
    platformFilter === "all"
      ? viewModel.previousTotals.estimatedCost
      : viewModel.previousTotals.estimatedCost;

  return (
    <section className="space-y-6">
      {/* ─────────────── Filters ─────────────── */}
      <div className="flex flex-col gap-3 border-y border-base-content/25 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-4">
        {/* Period tabs */}
        <div
          role="tablist"
          aria-label="集計期間"
          className="flex items-center gap-0 font-mono text-[11px] uppercase tracking-[0.18em]"
        >
          {PERIODS.map((p, idx) => {
            const active = p.key === viewModel.period;
            return (
              <button
                key={p.key}
                role="tab"
                aria-selected={active}
                disabled={pending}
                onClick={() => selectPeriod(p.key)}
                className={
                  "group relative px-4 py-1.5 transition-colors " +
                  (idx > 0 ? "border-l border-base-content/15 " : "") +
                  (active ? "text-base-content" : "text-base-content/40 hover:text-base-content/75")
                }
              >
                <span className="block leading-none">{p.label}</span>
                <span className="mt-0.5 block text-[8.5px] tracking-[0.22em] text-base-content/40">
                  {p.sub}
                </span>
                {active && (
                  <span
                    aria-hidden
                    className="absolute inset-x-2 -bottom-[7px] h-[2px] bg-primary"
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Platform filter chips */}
        <div className="-mx-2 flex items-center gap-1.5 overflow-x-auto px-2 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
          <Funnel size={12} weight="bold" className="text-base-content/40" aria-hidden />
          <span className="mr-1 font-mono text-[9px] uppercase tracking-[0.18em] text-base-content/45">
            wires
          </span>
          {PLATFORM_FILTERS.map((f) => {
            const active = f === platformFilter;
            return (
              <button
                key={f}
                onClick={() => setPlatformFilter(f)}
                aria-pressed={active}
                className={
                  "group inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[2px] border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.15em] transition-colors " +
                  (active
                    ? "border-base-content bg-base-content text-base-100"
                    : "border-base-content/25 text-base-content/55 hover:border-base-content/55 hover:text-base-content")
                }
              >
                {f !== "all" && (
                  <span
                    aria-hidden
                    className="inline-block h-1.5 w-1.5 rounded-[1px]"
                    style={{ backgroundColor: PLATFORM_INK[f] }}
                  />
                )}
                {PLATFORM_LABEL[f]}
              </button>
            );
          })}
        </div>
      </div>

      {/* ─────────────── Summary figures ─────────────── */}
      <div>
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-base-content/45">
              section i · figures
            </div>
            <h2
              className="mt-0.5 font-display text-xl font-semibold leading-tight text-base-content"
              style={{ fontFamily: "'Fraunces', serif" }}
            >
              Treasury Figures
            </h2>
          </div>
          <span className="hidden font-mono text-[9px] uppercase tracking-[0.18em] text-base-content/40 sm:inline">
            {viewModel.range.from.slice(0, 10)} — {viewModel.range.to.slice(0, 10)}
          </span>
        </div>
        <SummaryFigures
          totalCostUsd={filteredTotals.estimatedCost}
          totalRequests={filteredTotals.requestCount}
          successRate={filteredTotals.successRate}
          previousCostUsd={previousCost}
          degraded={viewModel.isFallback}
        />
      </div>

      {/* ─────────────── Chart ─────────────── */}
      <div className="rounded-sm border border-base-content/15 bg-base-100 px-4 pb-3 pt-4">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-base-content/45">
              section ii · the engraving
            </div>
            <h3
              className="mt-0.5 font-display text-base font-semibold text-base-content"
              style={{ fontFamily: "'Fraunces', serif" }}
            >
              Volume &amp; Spend, by Bucket
            </h3>
          </div>
        </div>
        <UsageChart viewModel={viewModel} platformFilter={platformFilter} />
      </div>

      {/* ─────────────── Table ─────────────── */}
      <div className="rounded-sm border border-base-content/15 bg-base-100 px-4 py-3">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-base-content/45">
              section iii · classifieds
            </div>
            <h3
              className="mt-0.5 font-display text-base font-semibold text-base-content"
              style={{ fontFamily: "'Fraunces', serif" }}
            >
              Per-Bureau Detail
            </h3>
          </div>
        </div>
        <PlatformLedgerTable viewModel={viewModel} platformFilter={platformFilter} />
      </div>

      {/* ─────────────── Allowances (budget) ─────────────── */}
      <div>
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-base-content/45">
              section iv · allowances
            </div>
            <h3
              className="mt-0.5 font-display text-xl font-semibold text-base-content"
              style={{ fontFamily: "'Fraunces', serif" }}
            >
              Budget Consumption
            </h3>
          </div>
          <a
            href="/settings/budget"
            className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.18em] text-base-content/55 underline-offset-4 hover:text-base-content hover:underline"
          >
            予算設定を開く
            <ArrowSquareOut size={11} weight="bold" />
          </a>
        </div>
        {budgetIsFallback && (
          <p className="mb-2 font-mono text-[9px] uppercase tracking-[0.18em] text-warning-content/70">
            回線オフライン · 予算表示をゼロで代替しています
          </p>
        )}
        <BudgetConsumptionRows statuses={budgetStatuses} />
      </div>
    </section>
  );
}
