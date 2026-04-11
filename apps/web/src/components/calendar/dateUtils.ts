/**
 * カレンダー画面で使う日付ユーティリティ
 *
 * 軽量実装のため date-fns 等は使わない。
 * すべての週はローカルタイムゾーンで月曜始まりとする。
 */

export const DAYS_OF_WEEK_JA = ["月", "火", "水", "木", "金", "土", "日"] as const;

export function startOfDay(d: Date): Date {
  const n = new Date(d);
  n.setHours(0, 0, 0, 0);
  return n;
}

export function endOfDay(d: Date): Date {
  const n = new Date(d);
  n.setHours(23, 59, 59, 999);
  return n;
}

export function addDays(d: Date, days: number): Date {
  const n = new Date(d);
  n.setDate(n.getDate() + days);
  return n;
}

export function addMonths(d: Date, months: number): Date {
  const n = new Date(d);
  // 月末オーバーフロー回避: 1 日に固定してから加算
  n.setDate(1);
  n.setMonth(n.getMonth() + months);
  return n;
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function isSameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

/**
 * 月曜始まりの週の開始日（月曜）を返す。
 */
export function startOfWeekMonday(d: Date): Date {
  const n = startOfDay(d);
  const day = n.getDay(); // 0=Sun ... 6=Sat
  const diff = (day + 6) % 7; // 月曜=0, 火曜=1, ..., 日曜=6
  n.setDate(n.getDate() - diff);
  return n;
}

/**
 * 月ビュー用の 6 週 × 7 日 = 42 日グリッドを返す。
 * 表示中の月の 1 日を含む週の月曜日から 42 日間。
 */
export function getMonthGrid(date: Date): Date[] {
  const firstOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
  const gridStart = startOfWeekMonday(firstOfMonth);
  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) {
    cells.push(addDays(gridStart, i));
  }
  return cells;
}

/**
 * 週ビュー用の 7 日配列（月曜始まり）を返す。
 */
export function getWeekDays(date: Date): Date[] {
  const start = startOfWeekMonday(date);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function formatYearMonth(d: Date): string {
  return `${d.getFullYear()}年 ${d.getMonth() + 1}月`;
}

export function formatMonthDayShort(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function formatClock(d: Date): string {
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  return `${hh}:${mm}`;
}

export function formatDateTimeJa(d: Date): string {
  return `${d.getFullYear()}/${(d.getMonth() + 1).toString().padStart(2, "0")}/${d
    .getDate()
    .toString()
    .padStart(2, "0")} ${formatClock(d)}`;
}

/**
 * <input type="datetime-local"> 用の文字列に変換する（タイムゾーンはローカル）。
 */
export function toDatetimeLocalValue(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}
