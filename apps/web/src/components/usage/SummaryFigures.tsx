/**
 * SummaryFigures — Task 4005
 *
 * Four headline figures for the usage page, modelled on the dashboard's
 * "headline numbers" cards but tightened for the treasury bulletin tone.
 *
 * - 合計コスト (USD)
 * - リクエスト数
 * - 成功率
 * - 前期比 (cost delta vs previous comparable range)
 */
import {
  CurrencyDollar,
  PaperPlaneRight,
  CheckCircle,
  TrendUp,
  TrendDown,
  Minus,
} from "@phosphor-icons/react/dist/ssr";
import type { ComponentType } from "react";

type IconType = ComponentType<{
  size?: number;
  weight?: "thin" | "light" | "regular" | "bold" | "fill" | "duotone";
  className?: string;
}>;

export interface SummaryFiguresProps {
  totalCostUsd: number;
  totalRequests: number;
  successRate: number;
  previousCostUsd: number;
  degraded?: boolean;
}

interface FigureDef {
  caption: string;
  value: string;
  unit?: string;
  trailing?: React.ReactNode;
  Icon: IconType;
}

function formatCurrency(v: number): string {
  if (v >= 1000) return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (v >= 1) return v.toFixed(2);
  return v.toFixed(4);
}

function formatPct(v: number): string {
  return `${(v * 100).toFixed(1)}`;
}

function formatDelta(
  current: number,
  previous: number,
): {
  text: string;
  trend: "up" | "down" | "flat";
} {
  if (previous <= 0) {
    if (current === 0) return { text: "—", trend: "flat" };
    return { text: "new", trend: "up" };
  }
  const ratio = (current - previous) / previous;
  if (Math.abs(ratio) < 0.001) return { text: "0.0%", trend: "flat" };
  const pct = ratio * 100;
  const sign = pct > 0 ? "+" : "";
  return {
    text: `${sign}${pct.toFixed(1)}%`,
    trend: pct > 0 ? "up" : "down",
  };
}

export function SummaryFigures({
  totalCostUsd,
  totalRequests,
  successRate,
  previousCostUsd,
  degraded,
}: SummaryFiguresProps) {
  const delta = formatDelta(totalCostUsd, previousCostUsd);
  const TrendIcon = delta.trend === "up" ? TrendUp : delta.trend === "down" ? TrendDown : Minus;

  const figures: FigureDef[] = [
    {
      caption: "合計コスト",
      value: formatCurrency(totalCostUsd),
      unit: "USD",
      Icon: CurrencyDollar,
    },
    {
      caption: "リクエスト数",
      value: totalRequests.toLocaleString("en-US"),
      unit: "req",
      Icon: PaperPlaneRight,
    },
    {
      caption: "成功率",
      value: formatPct(successRate),
      unit: "%",
      Icon: CheckCircle,
    },
    {
      caption: "前期比 (cost)",
      value: delta.text,
      unit: "vs prev",
      Icon: TrendIcon,
      trailing: (
        <span
          className={
            "font-mono text-[9px] uppercase tracking-[0.18em] " +
            (delta.trend === "up"
              ? "text-error/85"
              : delta.trend === "down"
                ? "text-success/85"
                : "text-base-content/45")
          }
        >
          {delta.trend === "up" ? "rising" : delta.trend === "down" ? "easing" : "steady"}
        </span>
      ),
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-0 sm:grid-cols-2 lg:grid-cols-4">
      {figures.map((f, idx) => {
        const Icon = f.Icon;
        return (
          <div
            key={f.caption}
            className={
              "relative flex flex-col gap-2 px-5 py-4 " +
              (idx === 0 ? "border-t border-base-content/25" : "border-t border-base-content/25") +
              " " +
              (idx % 2 === 1 ? "" : "") +
              " sm:border-t-0 sm:[&:nth-child(n+3)]:border-t sm:[&:nth-child(n+3)]:border-base-content/25" +
              " lg:[&:nth-child(n+3)]:border-t-0" +
              " lg:border-l-0 lg:[&:nth-child(n+2)]:border-l lg:[&:nth-child(n+2)]:border-dashed lg:[&:nth-child(n+2)]:border-base-content/20" +
              " sm:[&:nth-child(2n)]:border-l sm:[&:nth-child(2n)]:border-dashed sm:[&:nth-child(2n)]:border-base-content/20" +
              " lg:border-t lg:border-base-content/25"
            }
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-base-content/45">
                {f.caption}
              </span>
              <Icon size={13} weight="regular" className="text-base-content/35" />
            </div>
            <div className="flex items-baseline gap-1.5">
              <span
                className="font-display text-[40px] font-semibold leading-none tracking-tight tabular-nums text-base-content"
                style={{ fontFamily: "'Fraunces', serif", fontFeatureSettings: "'ss01'" }}
              >
                {f.value}
              </span>
              {f.unit && (
                <span className="font-mono text-[10px] uppercase tracking-wider text-base-content/50">
                  {f.unit}
                </span>
              )}
            </div>
            {f.trailing && <div className="mt-0.5">{f.trailing}</div>}
            {degraded && (
              <span className="absolute right-3 top-3 inline-block h-1.5 w-1.5 rounded-full bg-warning/80" />
            )}
          </div>
        );
      })}
      {/* Closing rule below the grid */}
      <div
        aria-hidden
        className="col-span-1 border-t border-base-content/25 sm:col-span-2 lg:col-span-4"
      />
    </div>
  );
}
