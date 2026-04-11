/**
 * RecentActivity — Task 3005
 *
 * The "Dispatches" column: a printed tape of the ten most recent operational
 * events across the workspace (post created, published, scheduled, scheduled
 * run succeeded/failed, etc.).
 *
 * Events are passed in pre-normalised; the component never talks to the API
 * directly. Rendering handles the empty-state with a quiet paper-style notice
 * rather than the usual "no data" chip.
 */
import {
  FileText,
  PaperPlaneTilt,
  ClockCountdown,
  CheckCircle,
  XCircle,
  Warning,
  PencilSimple,
  PushPin,
} from "@phosphor-icons/react/dist/ssr";
import type { ComponentType } from "react";

export type ActivityKind =
  | "post.draft"
  | "post.published"
  | "post.failed"
  | "schedule.created"
  | "schedule.succeeded"
  | "schedule.failed";

export type ActivityPlatform = "x" | "line" | "instagram";

export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  timestamp: string; // ISO
  platform: ActivityPlatform;
  title: string; // short sentence
  detail?: string | null; // optional 1-line detail
}

type IconType = ComponentType<{
  size?: number;
  weight?: "thin" | "light" | "regular" | "bold" | "fill" | "duotone";
  className?: string;
}>;

interface ActivityVisual {
  Icon: IconType;
  label: string;
  tone: "neutral" | "success" | "warning" | "error" | "info";
  verb: string;
}

const KIND_VISUALS: Record<ActivityKind, ActivityVisual> = {
  "post.draft": {
    Icon: PencilSimple,
    label: "下書き",
    tone: "neutral",
    verb: "下書き保存",
  },
  "post.published": {
    Icon: PaperPlaneTilt,
    label: "公開",
    tone: "success",
    verb: "公開",
  },
  "post.failed": {
    Icon: XCircle,
    label: "失敗",
    tone: "error",
    verb: "失敗",
  },
  "schedule.created": {
    Icon: ClockCountdown,
    label: "予約",
    tone: "info",
    verb: "予約",
  },
  "schedule.succeeded": {
    Icon: CheckCircle,
    label: "実行完了",
    tone: "success",
    verb: "実行完了",
  },
  "schedule.failed": {
    Icon: Warning,
    label: "実行失敗",
    tone: "error",
    verb: "実行失敗",
  },
};

const PLATFORM_LABEL: Record<ActivityPlatform, string> = {
  x: "X",
  line: "LINE",
  instagram: "Instagram",
};

const TONE_CLS: Record<ActivityVisual["tone"], string> = {
  neutral: "border-base-content/25 bg-base-200/60 text-base-content/70",
  success: "border-primary/40 bg-primary/10 text-primary",
  warning: "border-warning/50 bg-warning/15 text-[#7a4b00]",
  error: "border-error/40 bg-error/10 text-error",
  info: "border-info/40 bg-info/10 text-info",
};

function formatFilingTime(iso: string): {
  time: string;
  date: string;
  relative: string;
} {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return { time: "—", date: "—", relative: "—" };
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const date = `${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
  const diff = Date.now() - d.getTime();
  let relative: string;
  if (diff < 0) {
    // future (e.g. scheduled)
    const sec = Math.floor(-diff / 1000);
    if (sec < 60) relative = `${sec}秒後`;
    else if (sec < 3600) relative = `${Math.floor(sec / 60)}分後`;
    else if (sec < 86400) relative = `${Math.floor(sec / 3600)}時間後`;
    else relative = `${Math.floor(sec / 86400)}日後`;
  } else {
    const sec = Math.floor(diff / 1000);
    if (sec < 60) relative = `${sec}秒前`;
    else if (sec < 3600) relative = `${Math.floor(sec / 60)}分前`;
    else if (sec < 86400) relative = `${Math.floor(sec / 3600)}時間前`;
    else relative = `${Math.floor(sec / 86400)}日前`;
  }
  return { time, date, relative };
}

export interface RecentActivityProps {
  items: ActivityItem[];
  /** Optional total count when items is a capped slice (for the column rule footer). */
  totalCount?: number;
}

export function RecentActivity({ items, totalCount }: RecentActivityProps) {
  const visible = items.slice(0, 10);
  const displayedTotal = totalCount ?? visible.length;

  return (
    <section aria-label="Recent activity" className="flex h-full flex-col">
      <header className="flex items-baseline justify-between gap-4 pb-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-base-content/45">
            section iii · dispatches
          </div>
          <h2
            className="mt-0.5 font-display text-xl font-semibold leading-tight text-base-content"
            style={{ fontFamily: "'Fraunces', serif" }}
          >
            Recent Activity
          </h2>
        </div>
        <div className="hidden items-center gap-2 font-mono text-[9px] uppercase tracking-[0.18em] text-base-content/40 sm:flex">
          <PushPin size={11} weight="bold" />
          <span>latest {visible.length}</span>
          {displayedTotal > visible.length && (
            <span className="text-base-content/30">/ {displayedTotal}</span>
          )}
        </div>
      </header>

      <div className="relative flex-1 overflow-hidden rounded-box border border-base-300 bg-base-100">
        {/* double top rule — broadsheet convention */}
        <div aria-hidden className="absolute inset-x-0 top-0 border-t border-base-content/20" />
        <div aria-hidden className="absolute inset-x-0 top-[3px] border-t border-base-content/10" />

        {visible.length === 0 ? (
          <EmptyState />
        ) : (
          <ol className="relative divide-y divide-dashed divide-base-content/15">
            {visible.map((item, idx) => (
              <ActivityRow key={item.id} item={item} index={idx} />
            ))}
          </ol>
        )}

        {/* bottom rule */}
        <div aria-hidden className="border-t border-dashed border-base-content/15" />
        <footer className="flex items-center justify-between px-5 py-2 font-mono text-[9px] uppercase tracking-[0.18em] text-base-content/35">
          <span>— end of column —</span>
          <span>filed · most recent first</span>
        </footer>
      </div>

      <style>{`
        @keyframes dispatchIn {
          from { opacity: 0; transform: translateY(3px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </section>
  );
}

// ───────────────────────────────────────────
// Row
// ───────────────────────────────────────────

function ActivityRow({ item, index }: { item: ActivityItem; index: number }) {
  const visual = KIND_VISUALS[item.kind];
  const Icon = visual.Icon;
  const time = formatFilingTime(item.timestamp);

  return (
    <li
      className="grid grid-cols-[auto_1fr_auto] items-start gap-4 px-5 py-3"
      style={{
        animation: `dispatchIn 0.4s ease-out ${Math.min(index * 35, 400)}ms backwards`,
      }}
    >
      {/* Filing time: tabular, monospaced, right-aligned — feels like a filed cable */}
      <div className="pt-0.5 text-right font-mono leading-tight tabular-nums text-base-content/70">
        <div className="text-[11px] font-semibold">{time.time}</div>
        <div className="text-[9px] uppercase tracking-wider text-base-content/40">{time.date}</div>
      </div>

      {/* Body */}
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex h-5 items-center gap-1 rounded-sm border px-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.15em] ${TONE_CLS[visual.tone]}`}
          >
            <Icon size={10} weight="bold" />
            {visual.label}
          </span>
          <span className="font-mono text-[9px] uppercase tracking-[0.15em] text-base-content/45">
            {PLATFORM_LABEL[item.platform]}
          </span>
        </div>
        <p
          className="mt-1 truncate font-display text-[15px] leading-snug text-base-content"
          style={{ fontFamily: "'Fraunces', serif" }}
        >
          {item.title}
        </p>
        {item.detail && (
          <p className="mt-0.5 truncate font-sans text-[11px] text-base-content/55">
            {item.detail}
          </p>
        )}
      </div>

      {/* Relative time gutter */}
      <div className="pt-1 text-right font-mono text-[9px] uppercase tracking-[0.15em] text-base-content/40">
        {time.relative}
      </div>
    </li>
  );
}

// ───────────────────────────────────────────
// Empty state
// ───────────────────────────────────────────

function EmptyState() {
  return (
    <div className="relative flex min-h-[260px] flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-8 top-10 border-t border-dashed border-base-content/15"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-8 bottom-10 border-t border-dashed border-base-content/15"
      />
      <FileText size={34} weight="duotone" className="text-base-content/30" />
      <div
        className="font-display text-lg italic text-base-content/50"
        style={{ fontFamily: "'Fraunces', serif", fontStyle: "italic" }}
      >
        まだアクティビティはありません。
      </div>
      <p className="max-w-sm font-sans text-xs text-base-content/45">
        アクティビティがまだ記録されていません。投稿を作成したり、アカウントを接続すると、ここに日次ログが流れ始めます。
      </p>
      <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.2em] text-base-content/30">
        最初の記録を待機中
      </div>
    </div>
  );
}

// Animation keyframes are injected via the <style> block in the main return.
