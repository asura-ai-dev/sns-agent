/**
 * PlatformOverview — Task 3005
 *
 * Three "bureau correspondent" cards (X / LINE / Instagram) reporting in from
 * their respective networks. Each card shows:
 *   - Connected account count
 *   - Most recent published post datetime
 *   - Success rate meter (success / total attempts)
 *   - Empty state with a prompt to connect when no accounts exist
 *
 * The shape of the input is intentionally pre-aggregated by the page so this
 * component stays dumb and easy to test.
 */
import Link from "next/link";
import {
  XLogo,
  InstagramLogo,
  ChatCircleDots,
  Link as LinkIcon,
  ArrowRight,
  CircleDashed,
} from "@phosphor-icons/react/dist/ssr";
import type { ComponentType } from "react";

export type Platform = "x" | "line" | "instagram";

type IconType = ComponentType<{
  size?: number;
  weight?: "thin" | "light" | "regular" | "bold" | "fill" | "duotone";
  className?: string;
}>;

export interface PlatformStats {
  platform: Platform;
  accountCount: number;
  latestPostAt: string | null; // ISO timestamp or null
  successRate: number | null; // 0..1 or null if unknown
  totalAttempts: number;
}

export interface PlatformOverviewProps {
  stats: PlatformStats[];
}

// ───────────────────────────────────────────
// Visual tokens per platform
// ───────────────────────────────────────────

interface PlatformVisual {
  label: string;
  bureau: string;
  Icon: IconType;
  accent: string; // rgb/hex
  background: string;
  foreground: string;
  meterColor: string;
}

const VISUALS: Record<Platform, PlatformVisual> = {
  x: {
    label: "X",
    bureau: "the x bureau",
    Icon: XLogo,
    accent: "#111111",
    background: "linear-gradient(135deg, #111111 0%, #2a2a2a 100%)",
    foreground: "#ffffff",
    meterColor: "#111111",
  },
  line: {
    label: "LINE",
    bureau: "the line desk",
    Icon: ChatCircleDots,
    accent: "#06C755",
    background: "linear-gradient(135deg, #06C755 0%, #04a446 100%)",
    foreground: "#ffffff",
    meterColor: "#06C755",
  },
  instagram: {
    label: "Instagram",
    bureau: "the gram dispatch",
    Icon: InstagramLogo,
    accent: "#DD2A7B",
    background: "linear-gradient(135deg, #F58529 0%, #DD2A7B 40%, #8134AF 75%, #515BD4 100%)",
    foreground: "#ffffff",
    meterColor: "#DD2A7B",
  },
};

// ───────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────

function formatRelative(iso: string | null): string {
  if (!iso) return "no dispatches yet";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  const wk = Math.floor(day / 7);
  if (wk < 4) return `${wk}w ago`;
  return new Date(iso).toISOString().slice(0, 10);
}

function formatAbsolute(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatRate(rate: number | null): string {
  if (rate === null || Number.isNaN(rate)) return "—";
  return `${Math.round(rate * 100)}%`;
}

// ───────────────────────────────────────────
// Sub-component: success meter
// ───────────────────────────────────────────

function SuccessMeter({
  rate,
  color,
  total,
}: {
  rate: number | null;
  color: string;
  total: number;
}) {
  if (rate === null || total === 0) {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.18em] text-base-content/40">
          <span>success rate</span>
          <span>n/a</span>
        </div>
        <div className="relative h-[6px] overflow-hidden rounded-sm border border-dashed border-base-content/20 bg-base-200/40" />
      </div>
    );
  }

  const pct = Math.max(0, Math.min(1, rate)) * 100;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.18em] text-base-content/55">
        <span>success rate</span>
        <span className="tabular-nums text-base-content/80">
          {formatRate(rate)} · {total.toLocaleString()} runs
        </span>
      </div>
      <div
        className="relative h-[6px] overflow-hidden rounded-sm border border-base-content/15 bg-base-200/40"
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        {/* Printed tick marks behind the bar */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            backgroundImage:
              "repeating-linear-gradient(90deg, transparent 0, transparent 9%, rgba(0,0,0,0.12) 9%, rgba(0,0,0,0.12) calc(9% + 1px))",
          }}
        />
        <div
          className="absolute inset-y-0 left-0"
          style={{
            width: `${pct}%`,
            background: color,
            transition: "width 0.6s cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        />
      </div>
    </div>
  );
}

// ───────────────────────────────────────────
// Platform card
// ───────────────────────────────────────────

function PlatformCard({ stat, index }: { stat: PlatformStats; index: number }) {
  const visual = VISUALS[stat.platform];
  const Icon = visual.Icon;
  const isDisconnected = stat.accountCount === 0;

  return (
    <article
      className="group relative flex flex-col overflow-hidden rounded-box border border-base-300 bg-base-100"
      style={{
        animation: `bureauFadeIn 0.55s ease-out ${index * 90}ms backwards`,
      }}
    >
      {/* top ledger rule */}
      <div aria-hidden className="border-t border-base-content/10" />

      {/* header band */}
      <header className="relative flex items-start gap-4 px-5 pb-4 pt-5">
        <span
          aria-hidden
          className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-sm"
          style={{
            background: visual.background,
            color: visual.foreground,
            boxShadow: `0 0 0 1px ${visual.accent}33, 0 6px 16px -8px ${visual.accent}66`,
          }}
        >
          <Icon size={26} weight="bold" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-base-content/45">
            {visual.bureau}
          </div>
          <h3
            className="mt-0.5 font-display text-2xl font-semibold leading-tight text-base-content"
            style={{ fontFamily: "'Fraunces', serif" }}
          >
            {visual.label}
          </h3>
        </div>
        {/* issue number */}
        <div className="text-right font-mono text-[9px] uppercase leading-tight tracking-[0.18em] text-base-content/35">
          <div>vol · 01</div>
          <div>edition · apr</div>
        </div>
      </header>

      <div aria-hidden className="mx-5 border-t border-dashed border-base-content/20" />

      {/* body: accounts + latest post */}
      <div className="grid grid-cols-[auto_1px_1fr] gap-5 px-5 py-5">
        <div>
          <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-base-content/45">
            accounts
          </div>
          <div
            className="mt-1 font-display text-4xl font-semibold leading-none tabular-nums text-base-content"
            style={{ fontFamily: "'Fraunces', serif" }}
          >
            {stat.accountCount}
          </div>
          <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.15em] text-base-content/40">
            {stat.accountCount === 0
              ? "none connected"
              : stat.accountCount === 1
                ? "one active"
                : `${stat.accountCount} active`}
          </div>
        </div>

        <div aria-hidden className="bg-base-300/80" />

        <div className="min-w-0">
          <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-base-content/45">
            latest dispatch
          </div>
          <div
            className="mt-1 truncate font-display text-base font-medium leading-tight text-base-content"
            style={{ fontFamily: "'Fraunces', serif" }}
            title={formatAbsolute(stat.latestPostAt)}
          >
            {formatRelative(stat.latestPostAt)}
          </div>
          <div className="mt-1 truncate font-mono text-[9px] uppercase tracking-[0.15em] text-base-content/40">
            {stat.latestPostAt ? formatAbsolute(stat.latestPostAt) : "awaiting first post"}
          </div>
        </div>
      </div>

      {/* footer: success meter or connect CTA */}
      <footer className="relative mt-auto border-t border-dashed border-base-content/20 px-5 py-4">
        {isDisconnected ? (
          <Link
            href="/settings/accounts"
            className="group/link flex items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-base-content/55 transition-colors hover:text-primary"
          >
            <span className="inline-flex items-center gap-1.5">
              <LinkIcon size={11} weight="bold" />
              connect {visual.label.toLowerCase()} account
            </span>
            <ArrowRight
              size={12}
              weight="bold"
              className="transition-transform group-hover/link:translate-x-0.5"
            />
          </Link>
        ) : (
          <SuccessMeter
            rate={stat.successRate}
            color={visual.meterColor}
            total={stat.totalAttempts}
          />
        )}
      </footer>

      {/* corner crop marks */}
      <CropMark position="tl" />
      <CropMark position="tr" />
      <CropMark position="bl" />
      <CropMark position="br" />
    </article>
  );
}

function CropMark({ position }: { position: "tl" | "tr" | "bl" | "br" }) {
  const cls: Record<typeof position, string> = {
    tl: "top-1.5 left-1.5 border-t border-l",
    tr: "top-1.5 right-1.5 border-t border-r",
    bl: "bottom-1.5 left-1.5 border-b border-l",
    br: "bottom-1.5 right-1.5 border-b border-r",
  };
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute h-2 w-2 border-base-content/25 ${cls[position]}`}
    />
  );
}

// ───────────────────────────────────────────
// Main component
// ───────────────────────────────────────────

export function PlatformOverview({ stats }: PlatformOverviewProps) {
  // Ensure stable order: x, line, instagram regardless of input order
  const ordered: PlatformStats[] = (["x", "line", "instagram"] as Platform[]).map(
    (p) =>
      stats.find((s) => s.platform === p) ?? {
        platform: p,
        accountCount: 0,
        latestPostAt: null,
        successRate: null,
        totalAttempts: 0,
      },
  );

  return (
    <section aria-label="Platform overview" className="space-y-3">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-base-content/45">
            section ii · platforms
          </div>
          <h2
            className="mt-0.5 font-display text-xl font-semibold leading-tight text-base-content"
            style={{ fontFamily: "'Fraunces', serif" }}
          >
            Bureau Reports
          </h2>
        </div>
        <div className="hidden items-center gap-2 font-mono text-[9px] uppercase tracking-[0.18em] text-base-content/40 sm:flex">
          <CircleDashed size={11} weight="bold" />
          <span>three correspondents</span>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        {ordered.map((stat, i) => (
          <PlatformCard key={stat.platform} stat={stat} index={i} />
        ))}
      </div>

      <style>{`
        @keyframes bureauFadeIn {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </section>
  );
}
