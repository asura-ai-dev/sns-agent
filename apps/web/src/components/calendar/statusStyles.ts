/**
 * 予約ジョブ status の色・ラベル定義
 *
 * Task 3007 の要件:
 * - pending    : primary
 * - succeeded  : 緑 (= success)
 * - failed     : 赤 (= error)
 * - retrying   : warning
 *
 * running / locked は pending と同じ系統（実行準備中）として扱う。
 */
import type { JobStatus } from "./types";

export interface StatusStyle {
  label: string;
  /** カレンダーセルのドットやチップの背景 (oklch Tailwind クラス) */
  dotClass: string;
  /** チップ/バッジ全体のクラス */
  chipClass: string;
  /** 詳細モーダル等で使うテキスト色 */
  textClass: string;
  /** ソートやフィルタのヒント（finish / running / fail） */
  phase: "queued" | "running" | "done" | "fail" | "retry";
}

export const STATUS_STYLES: Record<JobStatus, StatusStyle> = {
  pending: {
    label: "予約中",
    dotClass: "bg-primary",
    chipClass: "border-primary/40 bg-primary/10 text-primary",
    textClass: "text-primary",
    phase: "queued",
  },
  locked: {
    label: "ロック中",
    dotClass: "bg-primary/70",
    chipClass: "border-primary/30 bg-primary/5 text-primary/80",
    textClass: "text-primary/80",
    phase: "queued",
  },
  running: {
    label: "実行中",
    dotClass: "bg-info",
    chipClass: "border-info/40 bg-info/10 text-info",
    textClass: "text-info",
    phase: "running",
  },
  succeeded: {
    label: "完了",
    dotClass: "bg-success",
    chipClass: "border-success/40 bg-success/10 text-success",
    textClass: "text-success",
    phase: "done",
  },
  failed: {
    label: "失敗",
    dotClass: "bg-error",
    chipClass: "border-error/40 bg-error/10 text-error",
    textClass: "text-error",
    phase: "fail",
  },
  retrying: {
    label: "再試行",
    dotClass: "bg-warning",
    chipClass: "border-warning/50 bg-warning/15 text-warning-content",
    textClass: "text-warning-content",
    phase: "retry",
  },
};

export function getStatusStyle(status: JobStatus | string): StatusStyle {
  return (
    STATUS_STYLES[status as JobStatus] ?? {
      label: status,
      dotClass: "bg-base-content/30",
      chipClass: "border-base-300 bg-base-200 text-base-content/70",
      textClass: "text-base-content/70",
      phase: "queued",
    }
  );
}
