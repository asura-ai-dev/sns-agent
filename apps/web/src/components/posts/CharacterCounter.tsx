/**
 * Task 3006: 文字数カウンター
 *
 * 環状リング（SVG progress ring）+ 残量数字でプラットフォーム別上限を
 * 視覚化する。残量が 20% 以下で caution、5% 以下で danger、超過で over。
 *
 * 進捗リングは CSS の `stroke-dashoffset` で滑らかに遷移する。
 */
import { getCounterZone, PLATFORM_LIMITS } from "./platformLimits";
import type { Platform } from "./types";

interface CharacterCounterProps {
  length: number;
  platform: Platform;
  compact?: boolean;
}

const ZONE_COLOR: Record<ReturnType<typeof getCounterZone>, string> = {
  safe: "oklch(72.45% 0.205 148.63)", // primary
  caution: "oklch(81.58% 0.147 80.2)", // warning
  danger: "oklch(72.9% 0.17 35.11)", // accent (orange)
  over: "oklch(62.56% 0.193 23.03)", // error
};

export function CharacterCounter({ length, platform, compact = false }: CharacterCounterProps) {
  const limit = PLATFORM_LIMITS[platform].textLimit;
  const zone = getCounterZone(length, limit);
  const remaining = limit - length;
  const ratio = Math.min(length / limit, 1.2); // over は 20% 分はみ出し表現
  const r = 11;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - Math.min(ratio, 1));
  const color = ZONE_COLOR[zone];

  const textColor =
    zone === "over"
      ? "text-error"
      : zone === "danger"
        ? "text-accent"
        : zone === "caution"
          ? "text-warning-content"
          : "text-base-content/60";

  if (compact) {
    return (
      <div className="inline-flex items-center gap-2">
        <svg width="26" height="26" viewBox="0 0 28 28" aria-hidden>
          <circle
            cx="14"
            cy="14"
            r={r}
            fill="none"
            stroke="oklch(91.73% 0.013 82.4)"
            strokeWidth="3"
          />
          <circle
            cx="14"
            cy="14"
            r={r}
            fill="none"
            stroke={color}
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            transform="rotate(-90 14 14)"
            style={{ transition: "stroke-dashoffset 220ms ease, stroke 220ms ease" }}
          />
        </svg>
        <span className={`tabular-nums text-xs font-medium ${textColor}`}>
          {remaining >= 0 ? remaining : `+${Math.abs(remaining)}`}
        </span>
      </div>
    );
  }

  return (
    <div
      className="inline-flex items-center gap-3 rounded-field border border-base-300 bg-base-100 px-3 py-2"
      role="status"
      aria-live="polite"
    >
      <svg width="32" height="32" viewBox="0 0 28 28" aria-hidden>
        <circle
          cx="14"
          cy="14"
          r={r}
          fill="none"
          stroke="oklch(91.73% 0.013 82.4)"
          strokeWidth="3"
        />
        <circle
          cx="14"
          cy="14"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform="rotate(-90 14 14)"
          style={{ transition: "stroke-dashoffset 220ms ease, stroke 220ms ease" }}
        />
      </svg>
      <div className="flex flex-col leading-tight">
        <span className={`font-display text-sm font-semibold tabular-nums ${textColor}`}>
          {length.toLocaleString()}{" "}
          <span className="text-base-content/40">/ {limit.toLocaleString()}</span>
        </span>
        <span className="text-[0.65rem] uppercase tracking-wider text-base-content/50">
          {remaining >= 0
            ? `残り ${remaining.toLocaleString()} 文字`
            : `${Math.abs(remaining).toLocaleString()} 文字オーバー`}
        </span>
      </div>
    </div>
  );
}
