/**
 * Task 3006: 投稿リスト (table for md+, card for mobile)
 *
 * デザイン: 「Editorial Ledger」路線
 *  - デスクトップはテーブル行が紙面の行のように並ぶ
 *  - 左端に細いプラットフォーム罫線（4px）
 *  - 本文は display font で大きめに、メタは small caps
 *  - モバイルはカード（同じ情報を縦に）
 */
"use client";

import Link from "next/link";
import {
  DotsThreeVertical,
  PaperPlaneTilt,
  Trash,
  PencilSimple,
  LinkSimple,
} from "@phosphor-icons/react";
import { PlatformIcon, PLATFORM_VISUALS } from "@/components/settings/PlatformIcon";
import { getStatusStyle } from "@/components/calendar/statusStyles";
import { COMMON_ACTIONS, SECTION_KICKERS } from "@/lib/i18n/labels";
import { StatusBadge } from "./StatusBadge";
import type { Post } from "./types";

// ───────────────────────────────────────────
// ユーティリティ
// ───────────────────────────────────────────

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const mm = (d.getMonth() + 1).toString().padStart(2, "0");
  const dd = d.getDate().toString().padStart(2, "0");
  const hh = d.getHours().toString().padStart(2, "0");
  const mi = d.getMinutes().toString().padStart(2, "0");
  return `${d.getFullYear()}/${mm}/${dd} ${hh}:${mi}`;
}

function excerpt(text: string | null, max = 140): string {
  if (!text) return "(本文なし)";
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max)}…`;
}

function truncateError(text: string | null | undefined, max = 84): string | null {
  if (!text) return null;
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max)}…`;
}

// ───────────────────────────────────────────
// Props
// ───────────────────────────────────────────

interface PostListProps {
  posts: Post[];
  loading: boolean;
  error: string | null;
  onPublish: (post: Post) => void;
  onDelete: (post: Post) => void;
  pendingId?: string | null;
  compact?: boolean;
}

export function PostList({
  posts,
  loading,
  error,
  onPublish,
  onDelete,
  pendingId,
  compact = false,
}: PostListProps) {
  if (loading && posts.length === 0) {
    return <ListSkeleton />;
  }

  if (error) {
    return (
      <div
        role="status"
        className="rounded-box border border-warning/40 bg-warning/5 px-5 py-4 text-sm text-base-content/80"
      >
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-warning">
          {SECTION_KICKERS.posts} offline · using local fallback
        </p>
        <p
          className="mt-2 font-display text-base font-medium leading-snug text-base-content"
          style={{ fontFamily: "'Fraunces', serif" }}
        >
          投稿一覧を取得できませんでした
        </p>
        <p className="mt-1 font-mono text-[10px] text-base-content/55">· {error}</p>
        <p className="mt-2 text-xs text-base-content/55">
          API サーバー未起動時は 0 件として表示されます。再読み込みで再試行できます。
        </p>
      </div>
    );
  }

  if (posts.length === 0) {
    return <EmptyState />;
  }

  return (
    <>
      {/* Desktop: table */}
      <div
        className={[
          "overflow-hidden rounded-box border border-base-300 bg-base-100",
          compact ? "hidden" : "hidden md:block",
        ].join(" ")}
      >
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-base-300 bg-base-100/60 text-left text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-base-content/50">
              <th className="w-[42%] px-5 py-3">Post</th>
              <th className="px-4 py-3">Account</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Created</th>
              <th className="w-16 px-4 py-3 text-right">·</th>
            </tr>
          </thead>
          <tbody>
            {posts.map((p) => (
              <PostRow
                key={p.id}
                post={p}
                onPublish={onPublish}
                onDelete={onDelete}
                pending={pendingId === p.id}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: cards */}
      <ul className={compact ? "space-y-3" : "space-y-3 md:hidden"}>
        {posts.map((p) => (
          <li key={p.id}>
            <PostCard
              post={p}
              onPublish={onPublish}
              onDelete={onDelete}
              pending={pendingId === p.id}
            />
          </li>
        ))}
      </ul>
    </>
  );
}

// ───────────────────────────────────────────
// Row (desktop)
// ───────────────────────────────────────────

function PostRow({
  post,
  onPublish,
  onDelete,
  pending,
}: {
  post: Post;
  onPublish: (p: Post) => void;
  onDelete: (p: Post) => void;
  pending: boolean;
}) {
  const visual = PLATFORM_VISUALS[post.platform];
  const accountName =
    post.socialAccount?.displayName ??
    post.socialAccount?.externalAccountId ??
    "(不明なアカウント)";

  return (
    <tr
      data-post-id={post.id}
      data-status={post.status}
      className="group relative border-b border-base-200 last:border-b-0 transition-colors hover:bg-base-200/40"
    >
      {/* platform rule */}
      <td className="relative px-5 py-4 align-top">
        <span
          aria-hidden
          className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full"
          style={{ background: visual.background }}
        />
        <div className="min-w-0 pl-3">
          <p className="line-clamp-2 font-display text-[0.95rem] leading-snug text-base-content">
            {excerpt(post.contentText, 160)}
          </p>
          {post.contentMedia && post.contentMedia.length > 0 && (
            <p className="mt-1 inline-flex items-center gap-1 text-[0.65rem] uppercase tracking-wider text-base-content/40">
              <LinkSimple size={11} weight="bold" />
              {post.contentMedia.length} media
            </p>
          )}
        </div>
      </td>

      <td className="px-4 py-4 align-top">
        <div className="flex items-center gap-2.5">
          <PlatformIcon platform={post.platform} size={26} />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-base-content">{accountName}</p>
            <p className="truncate text-[0.65rem] uppercase tracking-wider text-base-content/40">
              {visual.label}
            </p>
          </div>
        </div>
      </td>

      <td className="px-4 py-4 align-top">
        <StatusBadge status={post.status} />
        <ScheduleStatusPanel schedule={post.schedule} className="mt-2" />
      </td>

      <td className="px-4 py-4 align-top">
        <p className="text-xs tabular-nums text-base-content/70">
          {formatDateTime(post.createdAt)}
        </p>
        {post.publishedAt && (
          <p className="mt-0.5 text-[0.65rem] tabular-nums text-base-content/40">
            pub {formatDateTime(post.publishedAt)}
          </p>
        )}
      </td>

      <td className="px-4 py-4 align-top text-right">
        <RowActions post={post} onPublish={onPublish} onDelete={onDelete} pending={pending} />
      </td>
    </tr>
  );
}

// ───────────────────────────────────────────
// Card (mobile)
// ───────────────────────────────────────────

function PostCard({
  post,
  onPublish,
  onDelete,
  pending,
}: {
  post: Post;
  onPublish: (p: Post) => void;
  onDelete: (p: Post) => void;
  pending: boolean;
}) {
  const visual = PLATFORM_VISUALS[post.platform];
  const accountName =
    post.socialAccount?.displayName ??
    post.socialAccount?.externalAccountId ??
    "(不明なアカウント)";

  return (
    <article
      data-post-id={post.id}
      data-status={post.status}
      className="relative overflow-hidden rounded-box border border-base-300 bg-base-100 p-4"
    >
      <span
        aria-hidden
        className="absolute left-0 top-0 bottom-0 w-1"
        style={{ background: visual.background }}
      />
      <div className="flex items-start gap-3 pl-2">
        <PlatformIcon platform={post.platform} size={32} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-base-content">{accountName}</p>
              <p className="truncate text-[0.6rem] uppercase tracking-wider text-base-content/40">
                {visual.label} · {formatDateTime(post.createdAt)}
              </p>
            </div>
            <StatusBadge status={post.status} />
          </div>
          <p className="mt-2 line-clamp-3 font-display text-sm leading-snug text-base-content">
            {excerpt(post.contentText, 200)}
          </p>
          <ScheduleStatusPanel schedule={post.schedule} className="mt-3" />
          <div className="mt-3 flex items-center justify-end gap-1">
            <RowActions
              post={post}
              onPublish={onPublish}
              onDelete={onDelete}
              pending={pending}
              compact
            />
          </div>
        </div>
      </div>
    </article>
  );
}

function ScheduleStatusPanel({
  schedule,
  className = "",
}: {
  schedule: Post["schedule"];
  className?: string;
}) {
  if (!schedule) return null;

  const status = getStatusStyle(schedule.status);
  const lastError = truncateError(schedule.lastError);

  return (
    <div
      className={["rounded-sm border border-base-300 bg-base-200/35 px-2.5 py-2", className].join(
        " ",
      )}
    >
      <p className="text-[0.58rem] font-semibold uppercase tracking-[0.18em] text-base-content/45">
        Schedule
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.65rem] ${status.chipClass}`}
        >
          <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${status.dotClass}`} />
          {status.label}
        </span>
        <span className="text-[0.72rem] tabular-nums text-base-content/70">
          予約 {formatDateTime(schedule.scheduledAt)}
        </span>
      </div>
      {schedule.nextRetryAt ? (
        <p className="mt-1 text-[0.68rem] tabular-nums text-base-content/58">
          次回再試行 {formatDateTime(schedule.nextRetryAt)}
        </p>
      ) : null}
      {schedule.lastExecutedAt ? (
        <p className="mt-1 text-[0.68rem] tabular-nums text-base-content/58">
          最終実行 {formatDateTime(schedule.lastExecutedAt)}
        </p>
      ) : null}
      {lastError ? (
        <p className="mt-1 text-[0.68rem] leading-snug text-error/85">理由 {lastError}</p>
      ) : null}
    </div>
  );
}

// ───────────────────────────────────────────
// Actions
// ───────────────────────────────────────────

function RowActions({
  post,
  onPublish,
  onDelete,
  pending,
  compact = false,
}: {
  post: Post;
  onPublish: (p: Post) => void;
  onDelete: (p: Post) => void;
  pending: boolean;
  compact?: boolean;
}) {
  const canPublish = post.status === "draft";
  const canEdit = post.status === "draft";
  const canDelete = post.status !== "deleted";

  const btn =
    "inline-flex items-center justify-center rounded-field border border-base-300 bg-base-100 text-base-content/60 transition-colors hover:border-base-content/30 hover:text-base-content disabled:opacity-40";
  const size = compact ? "h-7 w-7" : "h-8 w-8";

  return (
    <div className="inline-flex items-center gap-1.5">
      {canEdit && (
        <Link
          href={`/posts/${post.id}/edit`}
          aria-label={COMMON_ACTIONS.edit}
          className={`${btn} ${size}`}
          data-testid="post-action-edit"
        >
          <PencilSimple size={14} weight="bold" />
        </Link>
      )}
      {canPublish && (
        <button
          type="button"
          aria-label="公開"
          disabled={pending}
          onClick={() => onPublish(post)}
          className={`${btn} ${size}`}
          data-testid="post-action-publish"
        >
          <PaperPlaneTilt size={14} weight="bold" />
        </button>
      )}
      {canDelete && (
        <button
          type="button"
          aria-label={COMMON_ACTIONS.delete}
          disabled={pending}
          onClick={() => onDelete(post)}
          className={`${btn} ${size} hover:border-error/30 hover:text-error`}
          data-testid="post-action-delete"
        >
          <Trash size={14} weight="bold" />
        </button>
      )}
      {!canEdit && !canPublish && !canDelete && (
        <span className={`${btn} ${size} cursor-not-allowed opacity-40`} aria-hidden>
          <DotsThreeVertical size={14} weight="bold" />
        </span>
      )}
    </div>
  );
}

// ───────────────────────────────────────────
// Skeleton / Empty
// ───────────────────────────────────────────

function ListSkeleton() {
  return (
    <div className="rounded-box border border-base-300 bg-base-100 p-4">
      <ul className="space-y-3">
        {[0, 1, 2, 3].map((i) => (
          <li
            key={i}
            className="h-16 animate-pulse rounded-field border border-base-200 bg-base-200/40 motion-reduce:animate-none"
          />
        ))}
      </ul>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center rounded-box border border-dashed border-base-300 bg-base-100 px-6 py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-box border border-base-300 bg-base-100">
        <PaperPlaneTilt size={24} weight="light" className="text-base-content/30" />
      </div>
      <h3 className="mt-4 font-display text-xl font-semibold text-base-content">
        まだ投稿がありません
      </h3>
      <p className="mt-1 max-w-xs text-sm text-base-content/50">
        右上の「新規投稿」から X / LINE / Instagram へ向けた最初の投稿を下書きしましょう。
      </p>
      <Link
        href="/posts/new"
        className="mt-5 inline-flex items-center gap-2 rounded-field bg-primary px-4 py-2 text-sm font-medium text-primary-content transition-opacity hover:opacity-90"
      >
        <PaperPlaneTilt size={14} weight="fill" />
        新規投稿を作成
      </Link>
    </div>
  );
}
