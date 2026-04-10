/**
 * SummaryCards — Task 3005
 *
 * The four "headline numbers" of the dashboard, presented as column-ruled
 * ledger entries in the Operations Ledger / Morning Edition aesthetic.
 *
 * - Total posts (all platforms, all statuses, this month)
 * - Scheduled (pending jobs awaiting execution)
 * - Estimated cost (MTD, USD)
 * - Connected accounts (active only)
 *
 * Props are plain numbers so the component is trivially testable and can be
 * driven by the server-side aggregation in `app/(dashboard)/page.tsx`.
 */
import {
  Newspaper,
  ClockCountdown,
  CurrencyDollar,
  PlugsConnected,
  Warning,
} from "@phosphor-icons/react/dist/ssr";
import type { ComponentType } from "react";

type IconType = ComponentType<{
  size?: number;
  weight?: "thin" | "light" | "regular" | "bold" | "fill" | "duotone";
  className?: string;
}>;

export interface SummaryCardsProps {
  totalPosts: number;
  scheduledPending: number;
  estimatedCostUsd: number;
  connectedAccounts: number;
  /** If any sub-fetch failed and the card is showing zero, set this to true to
   *  render a discrete "offline" marker instead of implying real zero counts. */
  degraded?: boolean;
}

interface CardDef {
  eyebrow: string;
  label: string;
  value: string;
  unit?: string;
  footnote: string;
  Icon: IconType;
  roman: string;
}

function formatInteger(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  return n.toLocaleString("en-US");
}

function formatUsd(n: number): { value: string; unit: string } {
  if (!Number.isFinite(n) || n < 0) return { value: "—", unit: "" };
  if (n === 0) return { value: "0.00", unit: "usd" };
  if (n < 100) return { value: n.toFixed(2), unit: "usd" };
  if (n < 10_000) return { value: n.toFixed(0), unit: "usd" };
  return { value: `${(n / 1000).toFixed(1)}k`, unit: "usd" };
}

export function SummaryCards({
  totalPosts,
  scheduledPending,
  estimatedCostUsd,
  connectedAccounts,
  degraded = false,
}: SummaryCardsProps) {
  const cost = formatUsd(estimatedCostUsd);

  const cards: CardDef[] = [
    {
      eyebrow: "column i",
      label: "total posts",
      value: formatInteger(totalPosts),
      unit: "all platforms",
      footnote: "drafts, scheduled & published",
      Icon: Newspaper,
      roman: "I",
    },
    {
      eyebrow: "column ii",
      label: "scheduled",
      value: formatInteger(scheduledPending),
      unit: "awaiting run",
      footnote: "pending jobs in the queue",
      Icon: ClockCountdown,
      roman: "II",
    },
    {
      eyebrow: "column iii",
      label: "est. cost",
      value: cost.value,
      unit: cost.unit,
      footnote: "month-to-date, all providers",
      Icon: CurrencyDollar,
      roman: "III",
    },
    {
      eyebrow: "column iv",
      label: "accounts",
      value: formatInteger(connectedAccounts),
      unit: "connected",
      footnote: "x · line · instagram",
      Icon: PlugsConnected,
      roman: "IV",
    },
  ];

  return (
    <section
      aria-label="Summary metrics"
      className="relative grid gap-0 overflow-hidden rounded-box border border-base-300 bg-base-100 sm:grid-cols-2 xl:grid-cols-4"
    >
      {/* top paper rule */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 border-t border-base-content/15"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-[3px] border-t border-base-content/10"
      />

      {cards.map((card, idx) => {
        const Icon = card.Icon;
        return (
          <article
            key={card.label}
            className="group relative flex flex-col gap-4 px-6 py-6 [&:not(:last-child)]:border-b [&:not(:last-child)]:border-dashed [&:not(:last-child)]:border-base-300 sm:[&:not(:last-child)]:border-b-0 sm:[&:nth-child(odd)]:border-r sm:[&:nth-child(odd)]:border-dashed sm:[&:nth-child(odd)]:border-base-300 sm:[&:nth-child(1)]:border-b sm:[&:nth-child(2)]:border-b xl:[&:not(:last-child)]:border-r xl:[&:not(:last-child)]:border-dashed xl:[&:not(:last-child)]:border-base-300 xl:[&:nth-child(1)]:border-b-0 xl:[&:nth-child(2)]:border-b-0"
            style={{
              animation: `ledgerFadeIn 0.5s ease-out ${idx * 60}ms backwards`,
            }}
          >
            {/* Top row: eyebrow + roman numeral */}
            <div className="flex items-start justify-between gap-3">
              <div className="font-mono text-[10px] uppercase leading-none tracking-[0.22em] text-base-content/45">
                {card.eyebrow}
              </div>
              <span
                className="font-display text-sm leading-none text-base-content/25"
                style={{ fontFamily: "'Fraunces', serif", fontStyle: "italic" }}
                aria-hidden
              >
                №&nbsp;{card.roman}
              </span>
            </div>

            {/* Label */}
            <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-base-content/65">
              <Icon size={14} weight="bold" className="shrink-0" />
              {card.label}
            </div>

            {/* Value */}
            <div className="flex items-baseline gap-2">
              <span
                className="font-display text-[56px] font-semibold leading-none tracking-tight text-base-content tabular-nums"
                style={{ fontFamily: "'Fraunces', serif" }}
              >
                {card.value}
              </span>
              {card.unit && (
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-base-content/45">
                  {card.unit}
                </span>
              )}
            </div>

            {/* Footnote rule */}
            <div className="relative mt-auto border-t border-dotted border-base-content/20 pt-2">
              <div className="flex items-center justify-between gap-2 font-mono text-[9px] uppercase tracking-[0.15em] text-base-content/40">
                <span>{card.footnote}</span>
                {degraded && (
                  <span className="inline-flex items-center gap-1 text-warning">
                    <Warning size={9} weight="bold" />
                    offline
                  </span>
                )}
              </div>
            </div>
          </article>
        );
      })}

      <style>{`
        @keyframes ledgerFadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </section>
  );
}
