/**
 * MonthView
 *
 * Task 3007: 予約カレンダー月ビュー
 *
 * 自前の 6 週 × 7 日グリッド実装。fullcalendar 等の重量級ライブラリは使わない。
 *
 * デザイン:
 *  - Fraunces 表示で日付番号を italic 表示（エディトリアルな暦のイメージ）
 *  - 各セルはステータスドット + 先頭 2 件の小チップ + 残数バッジ
 *  - セルクリックで onDateClick（新規予約導線）、チップクリックで onEntryClick
 */
"use client";

import type { CalendarEntry } from "./types";
import { DAYS_OF_WEEK_JA, formatClock, getMonthGrid, isSameDay, isSameMonth } from "./dateUtils";
import { getStatusStyle } from "./statusStyles";
import { PLATFORM_VISUALS } from "@/components/settings/PlatformIcon";

interface Props {
  currentMonth: Date;
  entries: CalendarEntry[];
  onEntryClick: (entry: CalendarEntry) => void;
  onDateClick: (date: Date) => void;
}

export function MonthView({ currentMonth, entries, onEntryClick, onDateClick }: Props) {
  const cells = getMonthGrid(currentMonth);
  const today = new Date();

  // 日付キー (YYYY-MM-DD) -> entries のマップを事前構築
  const byDay = new Map<string, CalendarEntry[]>();
  for (const e of entries) {
    const d = new Date(e.job.scheduledAt);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const arr = byDay.get(key) ?? [];
    arr.push(e);
    byDay.set(key, arr);
  }
  // 各日を時刻順に並べ替え
  for (const arr of byDay.values()) {
    arr.sort(
      (a, b) => new Date(a.job.scheduledAt).getTime() - new Date(b.job.scheduledAt).getTime(),
    );
  }

  return (
    <div className="overflow-hidden rounded-box border border-base-300 bg-base-100">
      {/* 曜日ヘッダ */}
      <div className="grid grid-cols-7 border-b border-base-300 bg-base-200/40">
        {DAYS_OF_WEEK_JA.map((d, i) => (
          <div
            key={d}
            className={`px-3 py-2.5 text-center font-display text-[0.7rem] font-semibold uppercase tracking-[0.2em] ${
              i === 5 ? "text-info/70" : i === 6 ? "text-error/70" : "text-base-content/60"
            }`}
          >
            {d}
          </div>
        ))}
      </div>

      {/* 日付グリッド */}
      <div className="grid grid-cols-7 grid-rows-6 divide-x divide-y divide-base-200">
        {cells.map((cell) => {
          const key = `${cell.getFullYear()}-${cell.getMonth()}-${cell.getDate()}`;
          const dayEntries = byDay.get(key) ?? [];
          const inMonth = isSameMonth(cell, currentMonth);
          const isToday = isSameDay(cell, today);
          const weekday = cell.getDay();
          const dowTint =
            weekday === 0 ? "text-error/70" : weekday === 6 ? "text-info/70" : "text-base-content";

          const visible = dayEntries.slice(0, 2);
          const overflow = dayEntries.length - visible.length;

          return (
            <button
              key={key}
              type="button"
              onClick={() => onDateClick(cell)}
              className={`group relative flex min-h-[7rem] flex-col items-stretch gap-1 px-2 py-2 text-left transition-colors hover:bg-base-200/40 focus:bg-base-200/60 focus:outline-none ${
                inMonth ? "bg-base-100" : "bg-base-200/30"
              }`}
              aria-label={`${cell.getMonth() + 1}月${cell.getDate()}日 ${dayEntries.length}件の予約`}
            >
              {/* 日付 */}
              <div className="flex items-center justify-between">
                <span
                  className={`font-display text-sm italic ${
                    inMonth ? dowTint : "text-base-content/30"
                  } ${isToday ? "" : ""}`}
                >
                  {isToday ? (
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[0.75rem] font-semibold not-italic text-primary-content">
                      {cell.getDate()}
                    </span>
                  ) : (
                    cell.getDate()
                  )}
                </span>
                {dayEntries.length > 0 ? (
                  <span className="text-[0.6rem] text-base-content/40">{dayEntries.length}</span>
                ) : null}
              </div>

              {/* 予約チップ */}
              <div className="flex flex-col gap-1">
                {visible.map((entry) => {
                  const dt = new Date(entry.job.scheduledAt);
                  const status = getStatusStyle(entry.job.status);
                  const platform = entry.post?.platform;
                  const platformBg = platform ? PLATFORM_VISUALS[platform].background : undefined;
                  const text = entry.post?.contentText?.trim() || "(本文なし)";
                  return (
                    <span
                      key={entry.job.id}
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        onEntryClick(entry);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          e.stopPropagation();
                          onEntryClick(entry);
                        }
                      }}
                      className="flex items-center gap-1.5 overflow-hidden rounded-sm border border-base-300 bg-base-100 px-1.5 py-0.5 text-[0.65rem] text-base-content/80 hover:border-base-content/30 hover:bg-base-200/70"
                    >
                      {/* プラットフォーム色の左罫線 */}
                      <span
                        aria-hidden
                        className="h-3 w-0.5 shrink-0 rounded-full"
                        style={{ background: platformBg ?? "var(--color-base-300)" }}
                      />
                      {/* ステータスドット */}
                      <span
                        aria-hidden
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${status.dotClass}`}
                      />
                      <span className="shrink-0 font-sans tabular-nums text-base-content/60">
                        {formatClock(dt)}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{text}</span>
                    </span>
                  );
                })}
                {overflow > 0 ? (
                  <span className="px-1 text-[0.6rem] text-base-content/50">+{overflow} more</span>
                ) : null}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
