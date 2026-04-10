/**
 * WeekView
 *
 * Task 3007: 予約カレンダー週ビュー
 *
 * 月曜始まりの 7 日間を縦タイムライン（0-24 時）で並べる自前実装。
 *
 * 実装メモ:
 *  - 1 時間 = 48px。0:00 から 23:00 まで 24 行のガイドライン。
 *  - 予約は scheduledAt の時刻で top を決定、高さは固定（48px = 1h 想定）。
 *  - 同時間帯の重なりは単純に縦方向で許容（v1 はオーバーラップ厳密処理を行わない）。
 */
"use client";

import type { CalendarEntry } from "./types";
import { DAYS_OF_WEEK_JA, formatClock, getWeekDays, isSameDay } from "./dateUtils";
import { getStatusStyle } from "./statusStyles";
import { PLATFORM_VISUALS } from "@/components/settings/PlatformIcon";

interface Props {
  currentWeek: Date;
  entries: CalendarEntry[];
  onEntryClick: (entry: CalendarEntry) => void;
  onSlotClick: (date: Date) => void;
}

const HOUR_HEIGHT = 48; // px
const HOURS = Array.from({ length: 24 }, (_, i) => i);

export function WeekView({ currentWeek, entries, onEntryClick, onSlotClick }: Props) {
  const days = getWeekDays(currentWeek);
  const today = new Date();

  return (
    <div className="overflow-hidden rounded-box border border-base-300 bg-base-100">
      {/* ヘッダ (曜日 + 日付) */}
      <div
        className="grid border-b border-base-300 bg-base-200/40"
        style={{ gridTemplateColumns: "4rem repeat(7, minmax(0, 1fr))" }}
      >
        <div className="px-2 py-3 text-center font-display text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-base-content/40">
          JST
        </div>
        {days.map((d, i) => {
          const isToday = isSameDay(d, today);
          const dowTint =
            i === 5 ? "text-info/80" : i === 6 ? "text-error/80" : "text-base-content";
          return (
            <div key={d.toISOString()} className="border-l border-base-300 px-3 py-2 text-center">
              <p
                className={`font-display text-[0.65rem] font-semibold uppercase tracking-[0.2em] ${dowTint}/70`}
              >
                {DAYS_OF_WEEK_JA[i]}
              </p>
              <p
                className={`mt-1 font-display text-lg italic ${
                  isToday ? "text-primary" : "text-base-content/80"
                }`}
              >
                {isToday ? (
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary text-sm font-semibold not-italic text-primary-content">
                    {d.getDate()}
                  </span>
                ) : (
                  d.getDate()
                )}
              </p>
            </div>
          );
        })}
      </div>

      {/* タイムライン本体 */}
      <div className="max-h-[calc(100vh-20rem)] overflow-y-auto">
        <div
          className="relative grid"
          style={{ gridTemplateColumns: "4rem repeat(7, minmax(0, 1fr))" }}
        >
          {/* 時刻ラベル列 */}
          <div className="relative border-r border-base-300 bg-base-100">
            {HOURS.map((h) => (
              <div
                key={h}
                className="flex items-start justify-end pr-2 pt-1 font-sans text-[0.65rem] tabular-nums text-base-content/40"
                style={{ height: `${HOUR_HEIGHT}px` }}
              >
                {h.toString().padStart(2, "0")}:00
              </div>
            ))}
          </div>

          {/* 各日の列 */}
          {days.map((day) => {
            const dayEntries = entries
              .filter((e) => isSameDay(new Date(e.job.scheduledAt), day))
              .sort(
                (a, b) =>
                  new Date(a.job.scheduledAt).getTime() - new Date(b.job.scheduledAt).getTime(),
              );

            return (
              <div
                key={day.toISOString()}
                className="relative border-l border-base-300"
                style={{ height: `${HOUR_HEIGHT * 24}px` }}
              >
                {/* 時刻ガイド */}
                {HOURS.map((h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => {
                      const slot = new Date(day);
                      slot.setHours(h, 0, 0, 0);
                      onSlotClick(slot);
                    }}
                    className="block w-full border-b border-dashed border-base-200 transition-colors hover:bg-base-200/40"
                    style={{ height: `${HOUR_HEIGHT}px` }}
                    aria-label={`${day.getMonth() + 1}月${day.getDate()}日 ${h}時のスロット`}
                  />
                ))}

                {/* 予約カード */}
                {dayEntries.map((entry) => {
                  const dt = new Date(entry.job.scheduledAt);
                  const minutes = dt.getHours() * 60 + dt.getMinutes();
                  const top = (minutes / 60) * HOUR_HEIGHT;
                  const status = getStatusStyle(entry.job.status);
                  const platform = entry.post?.platform;
                  const platformBg = platform ? PLATFORM_VISUALS[platform].background : undefined;
                  const text = entry.post?.contentText?.trim() || "(本文なし)";
                  return (
                    <button
                      key={entry.job.id}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onEntryClick(entry);
                      }}
                      className="absolute left-1 right-1 flex flex-col items-start gap-0.5 overflow-hidden rounded-sm border border-base-300 bg-base-100 px-1.5 py-1 text-left text-[0.7rem] shadow-[0_1px_0_rgba(0,0,0,0.02),0_4px_12px_-6px_rgba(0,0,0,0.08)] hover:border-base-content/30"
                      style={{
                        top: `${top}px`,
                        height: `${HOUR_HEIGHT - 2}px`,
                      }}
                    >
                      <div className="flex w-full items-center gap-1.5">
                        <span
                          aria-hidden
                          className="h-3 w-0.5 shrink-0 rounded-full"
                          style={{ background: platformBg ?? "var(--color-base-300)" }}
                        />
                        <span
                          aria-hidden
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${status.dotClass}`}
                        />
                        <span className="shrink-0 font-sans tabular-nums text-base-content/60">
                          {formatClock(dt)}
                        </span>
                      </div>
                      <span className="w-full truncate text-base-content/80">{text}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
