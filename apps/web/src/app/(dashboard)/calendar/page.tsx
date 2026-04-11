/**
 * 予約カレンダー画面
 *
 * Task 3007: Web UI - 予約カレンダー画面
 *
 * 機能:
 *  - 月 / 週 ビュー切り替え
 *  - 月ナビゲーション（前月 / 次月 / 今日）
 *  - 予約クリックで詳細モーダル
 *  - 日付クリックで新規予約導線 (`/posts/new?scheduledAt=...`)
 *  - GET /api/schedules から予約一覧取得（from / to 範囲指定）
 *  - PATCH /api/schedules/:id で日時変更
 *  - DELETE /api/schedules/:id でキャンセル
 *  - API 未起動時は空配列 fallback（UI は崩れない）
 *
 * デザイン方針 (frontend-design スキルに基づく):
 *  - 既存 (inbox / approvals) のエディトリアル質感 (warm off-white + Fraunces italic)
 *    を維持し、カレンダーを「紙の予定表・暦」のような佇まいに整える。
 *  - ビュー切替は sidebar の TabBar と同じシークレット・カプセル。
 *  - 新規予約 CTA は 1 つだけ、プライマリ 1 色で強調。
 */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CaretLeft, CaretRight, Plus, ArrowsClockwise, CalendarCheck } from "@phosphor-icons/react";
import { MonthView } from "@/components/calendar/MonthView";
import { WeekView } from "@/components/calendar/WeekView";
import { ScheduleDetailModal } from "@/components/calendar/ScheduleDetailModal";
import { STATUS_STYLES } from "@/components/calendar/statusStyles";
import type {
  CalendarEntry,
  CalendarView,
  PostDto,
  ScheduledJobDto,
} from "@/components/calendar/types";
import {
  addDays,
  addMonths,
  endOfDay,
  formatYearMonth,
  getMonthGrid,
  getWeekDays,
  startOfDay,
  startOfWeekMonday,
  toDatetimeLocalValue,
} from "@/components/calendar/dateUtils";
import { MASTHEAD_TITLES, SECTION_KICKERS } from "@/lib/i18n/labels";

// ───────────────────────────────────────────
// API helpers
// ───────────────────────────────────────────

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

interface ListSchedulesResponse {
  data: ScheduledJobDto[];
  meta: { total: number };
}

interface GetPostResponse {
  data: PostDto;
}

async function fetchSchedules(from: Date, to: Date): Promise<ScheduledJobDto[]> {
  const qs = new URLSearchParams({
    from: from.toISOString(),
    to: to.toISOString(),
  });
  const res = await fetch(`${API_BASE}/api/schedules?${qs.toString()}`, {
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(`failed to fetch schedules (${res.status})`);
  }
  const body = (await res.json()) as ListSchedulesResponse;
  return body.data ?? [];
}

async function fetchPost(id: string): Promise<PostDto | null> {
  try {
    const res = await fetch(`${API_BASE}/api/posts/${encodeURIComponent(id)}`, {
      credentials: "include",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as GetPostResponse;
    return body.data ?? null;
  } catch {
    return null;
  }
}

async function patchSchedule(id: string, scheduledAt: Date): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/schedules/${encodeURIComponent(id)}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scheduledAt: scheduledAt.toISOString() }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function deleteSchedule(id: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/schedules/${encodeURIComponent(id)}`, {
      method: "DELETE",
      credentials: "include",
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ───────────────────────────────────────────
// Page
// ───────────────────────────────────────────

export default function CalendarPage() {
  const router = useRouter();
  const [view, setView] = useState<CalendarView>("month");
  const [cursor, setCursor] = useState<Date>(() => new Date());
  const [entries, setEntries] = useState<CalendarEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<CalendarEntry | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  // 表示範囲の from / to を導出
  const range = useMemo(() => {
    if (view === "month") {
      const grid = getMonthGrid(cursor);
      return { from: startOfDay(grid[0]), to: endOfDay(grid[grid.length - 1]) };
    }
    const days = getWeekDays(cursor);
    return { from: startOfDay(days[0]), to: endOfDay(days[6]) };
  }, [view, cursor]);

  // ───────── Load schedules ─────────
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const jobs = await fetchSchedules(range.from, range.to);
      // 各 job に対応する post を並列取得。未取得は null 許容。
      const posts = await Promise.all(jobs.map((j) => fetchPost(j.postId)));
      const merged: CalendarEntry[] = jobs.map((job, i) => ({ job, post: posts[i] }));
      setEntries(merged);
    } catch (err) {
      // API 未起動・未認証等は fallback として空配列を表示し、UI を維持する
      setEntries([]);
      setError(err instanceof Error ? err.message : "予約の取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to]);

  useEffect(() => {
    void load();
  }, [load]);

  // ───────── Navigation ─────────
  const handlePrev = () => {
    setCursor((c) => (view === "month" ? addMonths(c, -1) : addDays(startOfWeekMonday(c), -7)));
  };
  const handleNext = () => {
    setCursor((c) => (view === "month" ? addMonths(c, 1) : addDays(startOfWeekMonday(c), 7)));
  };
  const handleToday = () => setCursor(new Date());

  // ───────── Entry interactions ─────────
  const handleEntryClick = (entry: CalendarEntry) => {
    setSelected(entry);
    setModalOpen(true);
  };
  const handleCloseModal = () => {
    setModalOpen(false);
    setSelected(null);
  };
  const handleReschedule = async (entry: CalendarEntry, next: Date): Promise<boolean> => {
    const ok = await patchSchedule(entry.job.id, next);
    if (ok) {
      await load();
    }
    return ok;
  };
  const handleCancel = async (entry: CalendarEntry): Promise<boolean> => {
    const ok = await deleteSchedule(entry.job.id);
    if (ok) {
      await load();
    }
    return ok;
  };

  const handleDateClick = (date: Date) => {
    // 新規予約導線: /posts/new?scheduledAt=...
    // 月ビューで時刻未指定時は 09:00 にデフォルト
    const slot = new Date(date);
    if (view === "month") {
      slot.setHours(9, 0, 0, 0);
    }
    const qs = new URLSearchParams({ scheduledAt: toDatetimeLocalValue(slot) });
    router.push(`/posts/new?${qs.toString()}`);
  };

  const handleNewSchedule = () => {
    const now = new Date();
    now.setMinutes(0, 0, 0);
    now.setHours(now.getHours() + 1);
    const qs = new URLSearchParams({ scheduledAt: toDatetimeLocalValue(now) });
    router.push(`/posts/new?${qs.toString()}`);
  };

  // ───────── Header title ─────────
  const titleText = useMemo(() => {
    if (view === "month") return formatYearMonth(cursor);
    const days = getWeekDays(cursor);
    const start = days[0];
    const end = days[6];
    const sameMonth = start.getMonth() === end.getMonth();
    if (sameMonth) {
      return `${start.getFullYear()}年 ${start.getMonth() + 1}月 ${start.getDate()}–${end.getDate()}日`;
    }
    return `${start.getFullYear()}年 ${start.getMonth() + 1}月${start.getDate()}日 – ${end.getMonth() + 1}月${end.getDate()}日`;
  }, [view, cursor]);

  return (
    <div className="relative flex flex-col gap-6">
      {/* ── Header ─────────────────────────────── */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[0.7rem] font-medium uppercase tracking-[0.18em] text-base-content/50">
            {SECTION_KICKERS.calendar}
          </p>
          <h1 className="mt-1 font-display text-3xl font-semibold leading-tight tracking-tight text-base-content">
            {MASTHEAD_TITLES.calendar}
          </h1>
          <p className="mt-1 text-sm text-base-content/60">
            {titleText}
            {loading ? (
              <span className="ml-2 inline-flex items-center gap-1 text-xs text-base-content/40">
                <ArrowsClockwise size={11} className="animate-spin" /> 読み込み中
              </span>
            ) : null}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-2 rounded-field border border-base-300 bg-base-100 px-3 py-2 text-xs font-medium text-base-content/70 transition-colors hover:border-base-content/30 hover:text-base-content"
            aria-label="更新"
          >
            <ArrowsClockwise size={14} weight="bold" />
            更新
          </button>
          <button
            type="button"
            onClick={handleNewSchedule}
            className="inline-flex items-center gap-2 rounded-field bg-primary px-3.5 py-2 text-xs font-semibold text-primary-content shadow-sm transition-opacity hover:opacity-90"
          >
            <Plus size={14} weight="bold" />
            新規予約
          </button>
        </div>
      </header>

      {/* ── Toolbar: view switch + month nav ─────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* ビュー切替 */}
        <nav
          aria-label="ビュー切替"
          className="inline-flex items-center gap-1 rounded-box border border-base-300 bg-base-100 p-1"
        >
          {(["month", "week"] as const).map((v) => {
            const active = view === v;
            return (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={`relative min-w-[4.5rem] rounded-field px-3.5 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? "bg-secondary text-secondary-content shadow-sm"
                    : "text-base-content/60 hover:text-base-content"
                }`}
                aria-pressed={active}
              >
                {v === "month" ? "月" : "週"}
              </button>
            );
          })}
        </nav>

        {/* 月ナビ */}
        <div className="inline-flex items-center gap-1 rounded-box border border-base-300 bg-base-100 p-1">
          <button
            type="button"
            onClick={handlePrev}
            className="inline-flex h-8 w-8 items-center justify-center rounded-field text-base-content/60 hover:bg-base-200 hover:text-base-content"
            aria-label={view === "month" ? "前月" : "前週"}
          >
            <CaretLeft size={14} weight="bold" />
          </button>
          <button
            type="button"
            onClick={handleToday}
            className="inline-flex items-center gap-1.5 rounded-field px-3 py-1.5 text-xs font-medium text-base-content/70 hover:bg-base-200 hover:text-base-content"
          >
            <CalendarCheck size={13} weight="duotone" />
            今日
          </button>
          <button
            type="button"
            onClick={handleNext}
            className="inline-flex h-8 w-8 items-center justify-center rounded-field text-base-content/60 hover:bg-base-200 hover:text-base-content"
            aria-label={view === "month" ? "次月" : "次週"}
          >
            <CaretRight size={14} weight="bold" />
          </button>
        </div>
      </div>

      {/* ── Error banner ─────────────────────────── */}
      {error ? (
        <div className="rounded-field border border-warning/40 bg-warning/5 px-4 py-3 text-xs text-base-content/75">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-warning">
            almanac wire offline · using local fallback
          </p>
          <p className="mt-1 text-xs text-base-content/70">
            {error} <span className="text-base-content/45">・ API オフラインの場合は予約一覧は空のまま表示されます</span>
          </p>
        </div>
      ) : null}

      {/* ── Body: Month or Week ──────────────────── */}
      {view === "month" ? (
        <MonthView
          currentMonth={cursor}
          entries={entries}
          onEntryClick={handleEntryClick}
          onDateClick={handleDateClick}
        />
      ) : (
        <WeekView
          currentWeek={cursor}
          entries={entries}
          onEntryClick={handleEntryClick}
          onSlotClick={handleDateClick}
        />
      )}

      {/* ── Legend ───────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 rounded-box border border-base-300 bg-base-100/60 px-4 py-2 text-[0.7rem] text-base-content/60">
        <span className="font-display text-[0.65rem] uppercase tracking-[0.2em] text-base-content/40">
          Legend
        </span>
        {(Object.keys(STATUS_STYLES) as Array<keyof typeof STATUS_STYLES>).map((k) => {
          const s = STATUS_STYLES[k];
          return (
            <span key={k} className="inline-flex items-center gap-1.5">
              <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${s.dotClass}`} />
              {s.label}
            </span>
          );
        })}
      </div>

      {/* ── Modal ────────────────────────────────── */}
      <ScheduleDetailModal
        entry={selected}
        open={modalOpen}
        onClose={handleCloseModal}
        onReschedule={handleReschedule}
        onCancel={handleCancel}
      />
    </div>
  );
}
