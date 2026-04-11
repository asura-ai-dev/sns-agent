/**
 * Task 3006: 投稿ステータスバッジ
 *
 * design.md: draft(灰), scheduled(青), published(緑), failed(赤), deleted(灰取消線)
 * + publishing は scheduled と同じ系で "info / pulse" 表現。
 *
 * デザイン: pill 形 + 細罫線 + 先頭の小さな丸ドット。色面は抑制し、
 * テキストは uppercase tracking-wide。全体トーン(Editorial Ledger) と揃える。
 */
import type { PostStatus } from "./types";

interface StatusConfig {
  label: string;
  dotClass: string;
  containerClass: string;
  strike?: boolean;
}

const CONFIG: Record<PostStatus, StatusConfig> = {
  draft: {
    label: "Draft",
    dotClass: "bg-base-content/40",
    containerClass: "border-base-300 bg-base-200/60 text-base-content/70",
  },
  scheduled: {
    label: "Scheduled",
    dotClass: "bg-info",
    containerClass: "border-info/30 bg-info/10 text-info",
  },
  publishing: {
    label: "Publishing",
    dotClass: "bg-info animate-pulse",
    containerClass: "border-info/30 bg-info/5 text-info",
  },
  published: {
    label: "Published",
    dotClass: "bg-primary",
    containerClass: "border-primary/30 bg-primary/10 text-primary",
  },
  failed: {
    label: "Failed",
    dotClass: "bg-error",
    containerClass: "border-error/30 bg-error/10 text-error",
  },
  deleted: {
    label: "Deleted",
    dotClass: "bg-base-content/30",
    containerClass: "border-base-300 bg-base-200/40 text-base-content/50",
    strike: true,
  },
};

interface StatusBadgeProps {
  status: PostStatus;
  className?: string;
}

export function StatusBadge({ status, className = "" }: StatusBadgeProps) {
  const cfg = CONFIG[status];
  return (
    <span
      data-status={status}
      className={[
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[0.625rem] font-semibold uppercase tracking-[0.12em]",
        cfg.containerClass,
        cfg.strike ? "line-through decoration-base-content/30" : "",
        className,
      ].join(" ")}
    >
      <span
        aria-hidden
        className={["inline-block h-1.5 w-1.5 rounded-full", cfg.dotClass].join(" ")}
      />
      {cfg.label}
    </span>
  );
}
