/**
 * UsageChart — Task 4005
 *
 * Newsprint-engraving styled recharts composition. Renders period buckets on
 * the x-axis with two y-axes:
 *   - left:  request count (bars, stacked by platform)
 *   - right: estimated cost USD (line)
 *
 * Designed to inherit the broadsheet vibe of the Operations Ledger: thin
 * strokes, no soft drop-shadows, hairline cartesian grid, and small-caps mono
 * tick labels. Tooltip is a paper card with Fraunces numerals.
 *
 * Empty state is handled by the parent — this component assumes
 * `bucketed.length > 0` when mounted.
 */
"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useMemo } from "react";

import { PLATFORM_INK, PLATFORM_LABEL, classifyPlatform } from "./types";
import type { PlatformFilter, UsageViewModel } from "./types";

interface BucketRow {
  /** Bucket key, e.g. `2026-04-09`. */
  period: string;
  /** Pretty axis label derived from the period key. */
  label: string;
  /** Per-platform request count (stacked). */
  x: number;
  line: number;
  instagram: number;
  llm: number;
  /** Per-platform cost (USD). */
  totalCost: number;
}

interface UsageChartProps {
  viewModel: UsageViewModel;
  /** When set, only the matching platform group is rendered (others zeroed). */
  platformFilter: PlatformFilter;
}

const PLATFORM_KEYS: ("x" | "line" | "instagram" | "llm")[] = ["x", "line", "instagram", "llm"];

function formatBucketLabel(key: string, period: string): string {
  // daily: YYYY-MM-DD → MM/DD
  if (period === "daily") {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
    if (m) return `${m[2]}/${m[3]}`;
  }
  // weekly: YYYY-Www → Www
  if (period === "weekly") {
    const m = /^(\d{4})-W(\d{2})$/.exec(key);
    if (m) return `W${m[2]}`;
  }
  // monthly: YYYY-MM → YYYY · MM
  if (period === "monthly") {
    const m = /^(\d{4})-(\d{2})$/.exec(key);
    if (m) return `${m[1].slice(2)}·${m[2]}`;
  }
  return key;
}

function bucket(viewModel: UsageViewModel): BucketRow[] {
  const map = new Map<string, BucketRow>();
  for (const entry of viewModel.entries) {
    let row = map.get(entry.period);
    if (!row) {
      row = {
        period: entry.period,
        label: formatBucketLabel(entry.period, viewModel.period),
        x: 0,
        line: 0,
        instagram: 0,
        llm: 0,
        totalCost: 0,
      };
      map.set(entry.period, row);
    }
    const group = classifyPlatform(entry.platform);
    if (group === "x") row.x += entry.requestCount;
    else if (group === "line") row.line += entry.requestCount;
    else if (group === "instagram") row.instagram += entry.requestCount;
    else if (group === "llm") row.llm += entry.requestCount;
    row.totalCost += entry.estimatedCost ?? 0;
  }
  return Array.from(map.values()).sort((a, b) => a.period.localeCompare(b.period));
}

function applyFilter(rows: BucketRow[], f: PlatformFilter): BucketRow[] {
  if (f === "all") return rows;
  return rows.map((r) => ({
    ...r,
    x: f === "x" ? r.x : 0,
    line: f === "line" ? r.line : 0,
    instagram: f === "instagram" ? r.instagram : 0,
    llm: f === "llm" ? r.llm : 0,
  }));
}

/**
 * Custom tooltip. Types kept loose because recharts v3 changed its generic
 * `TooltipProps` shape; we only touch the three fields we care about.
 */
interface TooltipLikeProps {
  active?: boolean;
  payload?: Array<{
    dataKey?: string | number;
    value?: number | string;
    color?: string;
    name?: string;
  }>;
  label?: string | number;
}

function CustomTooltip({ active, payload, label }: TooltipLikeProps) {
  if (!active || !payload || payload.length === 0) return null;

  // Aggregate cost from the line entry; bars carry per-platform request counts.
  const costEntry = payload.find((p) => p.dataKey === "totalCost");
  const cost = typeof costEntry?.value === "number" ? costEntry.value : 0;

  const platformRows = payload
    .filter((p) => p.dataKey !== "totalCost")
    .map((p) => ({
      key: String(p.dataKey) as PlatformFilter,
      value: typeof p.value === "number" ? p.value : 0,
      color: typeof p.color === "string" ? p.color : "#1F2937",
    }))
    .filter((r) => r.value > 0);

  return (
    <div
      className="rounded-sm border border-base-content/20 bg-base-100 px-3 py-2 shadow-[2px_2px_0_rgba(0,0,0,0.08)]"
      style={{ minWidth: 180 }}
    >
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-base-content/55">
        {label}
      </div>
      <div className="mt-1 flex items-baseline justify-between gap-3">
        <span className="font-mono text-[10px] uppercase tracking-wider text-base-content/45">
          cost
        </span>
        <span
          className="font-display text-lg font-semibold tabular-nums text-base-content"
          style={{ fontFamily: "'Fraunces', serif" }}
        >
          ${cost.toFixed(4)}
        </span>
      </div>
      {platformRows.length > 0 && (
        <div className="mt-2 space-y-0.5 border-t border-dashed border-base-content/15 pt-2">
          {platformRows.map((r) => (
            <div key={r.key} className="flex items-center justify-between gap-3 text-[11px]">
              <span className="flex items-center gap-2 text-base-content/65">
                <span
                  aria-hidden
                  className="inline-block h-2 w-2 rounded-[1px]"
                  style={{ backgroundColor: r.color }}
                />
                {PLATFORM_LABEL[r.key] ?? r.key}
              </span>
              <span className="font-mono tabular-nums text-base-content/85">
                {r.value.toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const TICK_STYLE = {
  fontFamily: "'JetBrains Mono', 'DM Mono', ui-monospace, monospace",
  fontSize: 10,
  letterSpacing: "0.08em",
  textTransform: "uppercase" as const,
  fill: "#6B7280",
};

export function UsageChart({ viewModel, platformFilter }: UsageChartProps) {
  const rows = useMemo(
    () => applyFilter(bucket(viewModel), platformFilter),
    [viewModel, platformFilter],
  );

  if (rows.length === 0) {
    return (
      <div className="flex h-72 items-center justify-center rounded-sm border border-dashed border-base-content/25 bg-base-200/30 text-center">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-base-content/45">
            no entries on file
          </div>
          <div
            className="mt-2 font-display text-lg italic text-base-content/55"
            style={{ fontFamily: "'Fraunces', serif" }}
          >
            the wires are quiet today
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 18, right: 18, left: 4, bottom: 28 }}>
          <CartesianGrid
            yAxisId="left"
            stroke="#1F2937"
            strokeOpacity={0.18}
            strokeDasharray="1 3"
            vertical={false}
          />
          <XAxis
            dataKey="label"
            tick={TICK_STYLE}
            tickLine={{ stroke: "#1F2937", strokeOpacity: 0.2 }}
            axisLine={{ stroke: "#1F2937", strokeOpacity: 0.4 }}
          />
          <YAxis
            yAxisId="left"
            orientation="left"
            tick={TICK_STYLE}
            tickLine={{ stroke: "#1F2937", strokeOpacity: 0.2 }}
            axisLine={{ stroke: "#1F2937", strokeOpacity: 0.4 }}
            label={{
              value: "REQ.",
              position: "insideTopLeft",
              offset: -2,
              style: { ...TICK_STYLE, fontSize: 9 },
            }}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            tick={TICK_STYLE}
            tickLine={{ stroke: "#1F2937", strokeOpacity: 0.2 }}
            axisLine={{ stroke: "#1F2937", strokeOpacity: 0.4 }}
            tickFormatter={(v: number) => `$${v.toFixed(2)}`}
            label={{
              value: "USD",
              position: "insideTopRight",
              offset: -2,
              style: { ...TICK_STYLE, fontSize: 9 },
            }}
          />
          <Tooltip
            content={<CustomTooltip />}
            cursor={{ fill: "rgba(31,41,55,0.05)" }}
            wrapperStyle={{ outline: "none" }}
          />
          <Legend
            verticalAlign="bottom"
            align="center"
            height={28}
            iconType="rect"
            iconSize={10}
            wrapperStyle={{
              fontFamily: "'JetBrains Mono', 'DM Mono', ui-monospace, monospace",
              fontSize: 9.5,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "#4B5563",
              bottom: -2,
              lineHeight: "1.4",
            }}
          />
          {PLATFORM_KEYS.map((k) => (
            <Bar
              key={k}
              yAxisId="left"
              dataKey={k}
              stackId="req"
              name={PLATFORM_LABEL[k]}
              fill={PLATFORM_INK[k]}
              fillOpacity={0.85}
              maxBarSize={28}
              isAnimationActive={false}
            />
          ))}
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="totalCost"
            name="SPEND"
            stroke="#B5451F"
            strokeWidth={1.75}
            strokeDasharray="0"
            dot={{ r: 2.75, stroke: "#B5451F", fill: "#FFFDF8", strokeWidth: 1.25 }}
            activeDot={{ r: 4.5, stroke: "#B5451F", fill: "#FFFDF8", strokeWidth: 1.5 }}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// Re-exports so callers can verify the recharts primitives are bundled.
export { ResponsiveContainer, BarChart, XAxis, YAxis, Tooltip, Legend };
