/**
 * BudgetConsumptionRows — Task 4005
 *
 * Renders each active BudgetPolicyStatus as a horizontal "ledger entry":
 *   ┌ scope label · period · action ────────────────── consumed / limit ┐
 *   │ ▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░  62.4%                 │
 *   └────────────────────────────────────────────────────────────────────┘
 *
 * - 80%超: warning カラー（ochre）
 * - 100%超: error カラー（vermillion）
 * - rest: primary（jade）
 *
 * Pure presentational — accepts the API DTO directly.
 */
import { Coins, Warning, ShieldWarning } from "@phosphor-icons/react/dist/ssr";

import type { BudgetStatusDto } from "@sns-agent/sdk";

interface BudgetConsumptionRowsProps {
  statuses: BudgetStatusDto[];
}

const PERIOD_LABEL: Record<string, string> = {
  daily: "daily",
  weekly: "weekly",
  monthly: "monthly",
};

const ACTION_LABEL: Record<string, string> = {
  warn: "warn",
  "require-approval": "require approval",
  block: "block",
};

function describeScope(s: BudgetStatusDto): string {
  const t = s.policy.scopeType;
  const v = s.policy.scopeValue;
  if (t === "workspace") return "workspace · all";
  if (t === "platform") return `platform · ${v ?? "—"}`;
  if (t === "endpoint") return `endpoint · ${v ?? "—"}`;
  return t;
}

function tone(s: BudgetStatusDto): {
  fillClass: string;
  trackClass: string;
  textClass: string;
  icon: typeof Warning | null;
  label: string;
} {
  if (s.exceeded) {
    return {
      fillClass: "bg-error",
      trackClass: "bg-error/15",
      textClass: "text-error",
      icon: ShieldWarning,
      label: "exceeded",
    };
  }
  if (s.warning) {
    return {
      fillClass: "bg-warning",
      trackClass: "bg-warning/20",
      textClass: "text-[#7a4b00]",
      icon: Warning,
      label: "warning",
    };
  }
  return {
    fillClass: "bg-primary",
    trackClass: "bg-primary/15",
    textClass: "text-base-content/70",
    icon: null,
    label: "within limit",
  };
}

export function BudgetConsumptionRows({ statuses }: BudgetConsumptionRowsProps) {
  if (statuses.length === 0) {
    return (
      <div className="rounded-sm border border-dashed border-base-content/25 bg-base-200/30 px-5 py-6 text-center">
        <Coins
          size={20}
          weight="regular"
          className="mx-auto mb-2 text-base-content/35"
          aria-hidden
        />
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-base-content/45">
          no budget policies on file
        </p>
        <p className="mt-1 text-xs text-base-content/55">設定 → 予算ポリシー から作成できます。</p>
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {statuses.map((s) => {
        const t = tone(s);
        const pct = Math.min(s.percentage, 1);
        const width = `${(pct * 100).toFixed(1)}%`;
        const Icon = t.icon;

        return (
          <li
            key={s.policy.id}
            className="rounded-sm border border-base-content/15 bg-base-100 px-4 py-3"
          >
            {/* Header line */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-base-content/45">
                  {describeScope(s)}
                </span>
                <span className="text-base-content/20">·</span>
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-base-content/45">
                  {PERIOD_LABEL[s.policy.period] ?? s.policy.period}
                </span>
                <span className="text-base-content/20">·</span>
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-base-content/45">
                  {ACTION_LABEL[s.policy.actionOnExceed] ?? s.policy.actionOnExceed}
                </span>
              </div>
              <div className="flex items-baseline gap-1.5">
                <span
                  className="font-display text-lg font-semibold tabular-nums text-base-content"
                  style={{ fontFamily: "'Fraunces', serif" }}
                >
                  ${s.consumed.toFixed(2)}
                </span>
                <span className="font-mono text-[10px] text-base-content/45">/</span>
                <span className="font-mono text-xs tabular-nums text-base-content/55">
                  ${s.limit.toFixed(2)}
                </span>
              </div>
            </div>

            {/* Bar with 80% / 100% tick marks */}
            <div className="relative mt-[22px] h-2 w-full">
              <div className={`absolute inset-0 overflow-hidden rounded-[2px] ${t.trackClass}`}>
                <div
                  className={`h-full ${t.fillClass} transition-[width] duration-500 ease-out`}
                  style={{ width }}
                  role="progressbar"
                  aria-valuenow={Math.round(s.percentage * 100)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${describeScope(s)} ${(s.percentage * 100).toFixed(1)}%`}
                />
              </div>
              <span
                aria-hidden
                className="pointer-events-none absolute -top-[4px] -bottom-[4px] w-[2px] bg-base-content/70"
                style={{ left: "calc(80% - 1px)" }}
                title="80% threshold"
              />
              <span
                aria-hidden
                className="pointer-events-none absolute -top-[4px] -bottom-[4px] w-[2px] bg-base-content"
                style={{ left: "calc(100% - 1px)" }}
                title="100% threshold"
              />
              <span
                aria-hidden
                className="pointer-events-none absolute -top-[10px] font-mono text-[8px] font-semibold uppercase tracking-[0.12em] text-base-content/60"
                style={{ left: "calc(80% - 6px)" }}
              >
                80
              </span>
              <span
                aria-hidden
                className="pointer-events-none absolute -top-[10px] font-mono text-[8px] font-semibold uppercase tracking-[0.12em] text-base-content/85"
                style={{ left: "calc(100% - 8px)" }}
              >
                100
              </span>
            </div>

            {/* Footer line */}
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <span className={`font-mono tabular-nums ${t.textClass}`}>
                {(s.percentage * 100).toFixed(1)}% consumed
              </span>
              <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em]">
                {Icon && <Icon size={11} weight="fill" className={t.textClass} aria-hidden />}
                <span className={t.textClass}>{t.label}</span>
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
