/**
 * Task 3006: 投稿プレビュー
 *
 * SNS ごとの見た目を厳密に模倣しない。統一トーンで
 * 「選択アカウント + 本文 + メディア + 文字数メタ」をカード表示する。
 */
"use client";

import { Image as ImageIcon, FilmSlate, Quotes } from "@phosphor-icons/react";
import { PlatformIcon, PLATFORM_VISUALS } from "@/components/settings/PlatformIcon";
import { PLATFORM_LIMITS } from "./platformLimits";
import type { MediaAttachment, Platform, PostSocialAccount } from "./types";

interface PostPreviewProps {
  account: PostSocialAccount | null;
  platform: Platform | null;
  text: string;
  media: MediaAttachment[];
}

export function PostPreview({ account, platform, text, media }: PostPreviewProps) {
  if (!platform || !account) {
    return (
      <div className="rounded-box border border-dashed border-base-300 bg-base-100 p-6 text-center">
        <Quotes size={24} weight="light" className="mx-auto text-base-content/20" />
        <p className="mt-2 font-display text-sm text-base-content/50">
          SNS アカウントを選択すると、プレビューが表示されます。
        </p>
      </div>
    );
  }

  const visual = PLATFORM_VISUALS[platform];
  const limit = PLATFORM_LIMITS[platform].textLimit;
  const length = text.length;
  const over = length > limit;

  return (
    <div className="relative overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-[0_1px_0_rgba(0,0,0,0.02),0_20px_50px_-30px_rgba(0,0,0,0.2)]">
      {/* header */}
      <div
        className="flex items-center gap-3 border-b border-base-300 px-5 py-4"
        style={{
          background: "linear-gradient(180deg, rgba(255,253,248,1) 0%, rgba(250,246,238,1) 100%)",
        }}
      >
        <PlatformIcon platform={platform} size={36} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-sm font-semibold text-base-content">
            {account.displayName}
          </p>
          <p className="truncate text-[0.65rem] uppercase tracking-wider text-base-content/50">
            {visual.label} · preview
          </p>
        </div>
        <span className="rounded-full border border-base-300 bg-base-100 px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wider text-base-content/50">
          Draft
        </span>
      </div>

      {/* body */}
      <div className="px-5 py-5">
        {text.trim() ? (
          <p className="whitespace-pre-wrap break-words font-display text-[0.95rem] leading-relaxed text-base-content">
            {text}
          </p>
        ) : (
          <p className="italic text-sm text-base-content/40">本文がまだ入力されていません。</p>
        )}

        {media.length > 0 && (
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {media.map((m, idx) => (
              <div
                key={`${m.url}-${idx}`}
                className="flex items-center gap-3 rounded-field border border-base-300 bg-base-100 p-3"
              >
                {m.type === "image" ? (
                  <ImageIcon size={18} weight="bold" className="text-base-content/50" />
                ) : (
                  <FilmSlate size={18} weight="bold" className="text-base-content/50" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-base-content">
                    {m.name ?? m.url}
                  </p>
                  <p className="truncate text-[0.65rem] uppercase tracking-wider text-base-content/40">
                    {m.type} {m.mimeType ? `· ${m.mimeType}` : ""}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* footer meta */}
      <div className="flex items-center justify-between border-t border-base-200 bg-base-100/60 px-5 py-3 text-[0.65rem] uppercase tracking-[0.14em] text-base-content/50">
        <span>
          {length.toLocaleString()} / {limit.toLocaleString()} chars
        </span>
        <span className={over ? "text-error" : undefined}>
          {over ? "over limit" : "within limit"}
        </span>
      </div>
    </div>
  );
}
