/**
 * Task 3006: 投稿一覧のフィルタバー
 *
 * - プラットフォームチップ（トグル）
 * - ステータス select
 * - 日付範囲（from/to）
 * - フリーテキスト検索
 *
 * デザイン: warm off-white 罫線ボックス。ラベルは uppercase の small caps 風。
 * 入力要素は DaisyUI `input`/`select` を薄く上書きしてトーンを揃える。
 */
"use client";

import { MagnifyingGlass, X } from "@phosphor-icons/react";
import { PLATFORM_VISUALS } from "@/components/settings/PlatformIcon";
import { SECTION_KICKERS } from "@/lib/i18n/labels";
import { ALL_PLATFORMS, POST_STATUSES } from "./types";
import type { Platform, PostListFilters, PostStatus } from "./types";

interface PostFiltersProps {
  value: PostListFilters;
  onChange: (next: PostListFilters) => void;
  disabled?: boolean;
}

const STATUS_LABELS: Record<PostStatus, string> = {
  draft: "下書き",
  scheduled: "予約",
  publishing: "公開中",
  published: "公開済み",
  failed: "失敗",
  deleted: "削除",
};

export function PostFilters({ value, onChange, disabled }: PostFiltersProps) {
  const togglePlatform = (p: Platform) => {
    const next = value.platforms.includes(p)
      ? value.platforms.filter((x) => x !== p)
      : [...value.platforms, p];
    onChange({ ...value, platforms: next, page: 1 });
  };

  const toggleStatus = (s: PostStatus) => {
    const next = value.statuses.includes(s)
      ? value.statuses.filter((x) => x !== s)
      : [...value.statuses, s];
    onChange({ ...value, statuses: next, page: 1 });
  };

  const hasActiveFilters =
    value.platforms.length > 0 ||
    value.statuses.length > 0 ||
    !!value.from ||
    !!value.to ||
    !!value.search.trim();

  const reset = () =>
    onChange({
      platforms: [],
      statuses: [],
      from: null,
      to: null,
      search: "",
      page: 1,
      limit: value.limit,
    });

  return (
    <section
      aria-label={`${SECTION_KICKERS.posts} filters`}
      className="rounded-box border border-base-300 bg-base-100 p-4 sm:p-5"
    >
      {/* Row 1: Platform chips + search */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="mb-2 text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-base-content/50">
            Platform
          </p>
          <div className="flex flex-wrap gap-1.5">
            {ALL_PLATFORMS.map((p) => {
              const active = value.platforms.includes(p);
              const visual = PLATFORM_VISUALS[p];
              return (
                <button
                  key={p}
                  type="button"
                  disabled={disabled}
                  onClick={() => togglePlatform(p)}
                  aria-pressed={active}
                  className={[
                    "group inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                    active
                      ? "border-base-content/60 bg-secondary text-secondary-content shadow-sm"
                      : "border-base-300 bg-base-100 text-base-content/70 hover:border-base-content/30 hover:text-base-content",
                    disabled ? "opacity-50" : "",
                  ].join(" ")}
                >
                  <span
                    aria-hidden
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ background: visual.background }}
                  />
                  {visual.label}
                </button>
              );
            })}
          </div>
        </div>

        <label className="flex min-w-0 items-center gap-2 rounded-field border border-base-300 bg-base-100 px-3 py-2 text-sm focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/15 lg:w-80">
          <MagnifyingGlass size={16} className="shrink-0 text-base-content/40" weight="bold" />
          <input
            type="text"
            value={value.search}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, search: e.target.value, page: 1 })}
            placeholder="本文・ハッシュタグで検索"
            className="min-w-0 flex-1 bg-transparent text-sm text-base-content placeholder:text-base-content/40 focus:outline-none disabled:opacity-60"
          />
          {value.search && (
            <button
              type="button"
              aria-label="検索クリア"
              className="text-base-content/40 hover:text-base-content"
              onClick={() => onChange({ ...value, search: "", page: 1 })}
            >
              <X size={14} weight="bold" />
            </button>
          )}
        </label>
      </div>

      {/* Row 2: Status + date range + reset */}
      <div className="mt-4 flex flex-col gap-3 border-t border-base-200 pt-4 sm:flex-row sm:flex-wrap sm:items-end sm:gap-4">
        <div className="min-w-0">
          <p className="mb-2 text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-base-content/50">
            Status
          </p>
          <div className="flex flex-wrap gap-1.5">
            {POST_STATUSES.map((s) => {
              const active = value.statuses.includes(s);
              return (
                <button
                  key={s}
                  type="button"
                  disabled={disabled}
                  onClick={() => toggleStatus(s)}
                  aria-pressed={active}
                  className={[
                    "inline-flex items-center rounded-full border px-2.5 py-1 text-[0.7rem] font-medium transition-colors",
                    active
                      ? "border-base-content/70 bg-base-content text-base-100"
                      : "border-base-300 bg-base-100 text-base-content/70 hover:border-base-content/30 hover:text-base-content",
                  ].join(" ")}
                >
                  {STATUS_LABELS[s]}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <p className="mb-2 text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-base-content/50">
            From
          </p>
          <input
            type="date"
            disabled={disabled}
            value={value.from ?? ""}
            onChange={(e) => onChange({ ...value, from: e.target.value || null, page: 1 })}
            className="rounded-field border border-base-300 bg-base-100 px-3 py-1.5 text-xs text-base-content/80 focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/15"
          />
        </div>

        <div>
          <p className="mb-2 text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-base-content/50">
            To
          </p>
          <input
            type="date"
            disabled={disabled}
            value={value.to ?? ""}
            onChange={(e) => onChange({ ...value, to: e.target.value || null, page: 1 })}
            className="rounded-field border border-base-300 bg-base-100 px-3 py-1.5 text-xs text-base-content/80 focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/15"
          />
        </div>

        {hasActiveFilters && (
          <button
            type="button"
            onClick={reset}
            disabled={disabled}
            className="ml-auto inline-flex items-center gap-1.5 self-end rounded-field border border-base-300 bg-base-100 px-3 py-1.5 text-[0.7rem] font-medium text-base-content/60 hover:border-base-content/30 hover:text-base-content"
          >
            <X size={12} weight="bold" />
            フィルタをクリア
          </button>
        )}
      </div>
    </section>
  );
}
