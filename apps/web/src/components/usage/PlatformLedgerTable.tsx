/**
 * PlatformLedgerTable — Task 4005
 *
 * Classified-ads style table summarising request / success / failure / cost
 * per platform. Hairline rules, tabular numerals, mono captions. The
 * platform key column shows a small ink swatch matching `PLATFORM_INK`.
 */
import { PLATFORM_INK, PLATFORM_LABEL, classifyPlatform } from "./types";
import type { PlatformFilter, UsageViewModel } from "./types";

interface Row {
  key: PlatformFilter;
  label: string;
  requests: number;
  successes: number;
  failures: number;
  cost: number;
  successRate: number;
}

interface PlatformLedgerTableProps {
  viewModel: UsageViewModel;
  platformFilter: PlatformFilter;
}

const ROW_KEYS: PlatformFilter[] = ["x", "line", "instagram", "llm"];

export function PlatformLedgerTable({ viewModel, platformFilter }: PlatformLedgerTableProps) {
  const buckets = new Map<PlatformFilter, Row>();
  for (const key of ROW_KEYS) {
    buckets.set(key, {
      key,
      label: PLATFORM_LABEL[key],
      requests: 0,
      successes: 0,
      failures: 0,
      cost: 0,
      successRate: 0,
    });
  }

  for (const e of viewModel.entries) {
    const group = classifyPlatform(e.platform);
    const row = buckets.get(group);
    if (!row) continue;
    row.requests += e.requestCount;
    row.successes += e.successCount;
    row.failures += e.failureCount;
    row.cost += e.estimatedCost ?? 0;
  }
  for (const r of buckets.values()) {
    r.successRate = r.requests > 0 ? r.successes / r.requests : 0;
  }

  const rows: Row[] =
    platformFilter === "all"
      ? Array.from(buckets.values())
      : ([buckets.get(platformFilter)].filter(Boolean) as Row[]);

  const totals = rows.reduce(
    (acc, r) => ({
      requests: acc.requests + r.requests,
      successes: acc.successes + r.successes,
      failures: acc.failures + r.failures,
      cost: acc.cost + r.cost,
    }),
    { requests: 0, successes: 0, failures: 0, cost: 0 },
  );
  const totalsRate = totals.requests > 0 ? totals.successes / totals.requests : 0;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-base-content/35 font-mono text-[9px] uppercase tracking-[0.18em] text-base-content/55">
            <th className="py-2 pr-3 text-left font-medium">platform</th>
            <th className="py-2 pr-3 text-right font-medium tabular-nums">requests</th>
            <th className="py-2 pr-3 text-right font-medium tabular-nums">success</th>
            <th className="py-2 pr-3 text-right font-medium tabular-nums">failure</th>
            <th className="py-2 pr-3 text-right font-medium tabular-nums">rate</th>
            <th className="py-2 pr-3 text-right font-medium tabular-nums">cost (usd)</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td
                colSpan={6}
                className="py-8 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-base-content/45"
              >
                no entries on file for this filter
              </td>
            </tr>
          )}
          {rows.map((r) => (
            <tr
              key={r.key}
              className="border-b border-dashed border-base-content/15 transition-colors hover:bg-accent/[0.03]"
            >
              <td className="py-2.5 pr-3">
                <span className="inline-flex items-center gap-2.5">
                  <span
                    aria-hidden
                    className="inline-block h-2.5 w-2.5 rounded-[1px]"
                    style={{ backgroundColor: PLATFORM_INK[r.key] }}
                  />
                  <span
                    className="font-display text-base font-medium text-base-content"
                    style={{ fontFamily: "'Fraunces', serif" }}
                  >
                    {r.label}
                  </span>
                </span>
              </td>
              <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-base-content/85">
                {r.requests.toLocaleString()}
              </td>
              <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-success/80">
                {r.successes.toLocaleString()}
              </td>
              <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-error/80">
                {r.failures.toLocaleString()}
              </td>
              <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-base-content/75">
                {(r.successRate * 100).toFixed(1)}%
              </td>
              <td className="py-2.5 pr-3 text-right">
                <span
                  className="font-display text-base font-semibold tabular-nums text-base-content"
                  style={{ fontFamily: "'Fraunces', serif" }}
                >
                  ${r.cost.toFixed(4)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
        {rows.length > 1 && (
          <tfoot>
            <tr className="border-t border-base-content/35">
              <td className="py-2.5 pr-3 font-mono text-[10px] uppercase tracking-[0.2em] text-base-content/55">
                total
              </td>
              <td className="py-2.5 pr-3 text-right font-mono tabular-nums font-semibold text-base-content">
                {totals.requests.toLocaleString()}
              </td>
              <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-success/85">
                {totals.successes.toLocaleString()}
              </td>
              <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-error/85">
                {totals.failures.toLocaleString()}
              </td>
              <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-base-content/85">
                {(totalsRate * 100).toFixed(1)}%
              </td>
              <td className="py-2.5 pr-3 text-right">
                <span
                  className="font-display text-lg font-semibold tabular-nums text-base-content"
                  style={{ fontFamily: "'Fraunces', serif" }}
                >
                  ${totals.cost.toFixed(4)}
                </span>
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
