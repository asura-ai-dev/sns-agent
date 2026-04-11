/**
 * Task 3006: 投稿一覧ページ
 *
 * - フィルタバー（platform, status, 日付範囲, 検索）
 * - PostList（デスクトップ: テーブル / モバイル: カード）
 * - ページネーション（DaisyUI join + btn）
 * - 「新規投稿」-> /posts/new
 *
 * API 未起動時も fallback として「投稿 0 件」を表示し、再試行できる。
 *
 * デザイン: Editorial Operations Ledger（既存の inbox / settings と整合）。
 */
"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowsClockwise, CaretLeft, CaretRight, Plus } from "@phosphor-icons/react";
import { PostFilters } from "@/components/posts/PostFilters";
import { PostList } from "@/components/posts/PostList";
import { deletePostApi, fetchPosts, publishPostApi } from "@/components/posts/api";
import {
  ALL_PLATFORMS,
  type Platform,
  type Post,
  type PostListFilters,
  type PostListMeta,
} from "@/components/posts/types";
import { PlatformIcon, PLATFORM_VISUALS } from "@/components/settings/PlatformIcon";
import { MASTHEAD_TITLES, SECTION_KICKERS } from "@/lib/i18n/labels";
import { usePlatformViewMode } from "@/lib/view-mode/usePlatformViewMode";

const DEFAULT_FILTERS: PostListFilters = {
  platforms: [],
  statuses: [],
  from: null,
  to: null,
  search: "",
  page: 1,
  limit: 20,
};

export default function PostsPage() {
  return (
    <Suspense fallback={null}>
      <PostsPageContent />
    </Suspense>
  );
}

function PostsPageContent() {
  const { mode } = usePlatformViewMode("posts");
  const [filters, setFilters] = useState<PostListFilters>(DEFAULT_FILTERS);
  const [posts, setPosts] = useState<Post[]>([]);
  const [meta, setMeta] = useState<PostListMeta>({ page: 1, limit: 20, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  // ───────── Fetch ─────────
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetchPosts(filters);
    setLoading(false);
    if (!res.ok) {
      if (res.error.code === "ABORTED") return;
      setError(res.error.message);
      setPosts([]);
      setMeta({ page: filters.page, limit: filters.limit, total: 0 });
      return;
    }
    setPosts(res.value.data);
    setMeta(
      res.value.meta ?? { page: filters.page, limit: filters.limit, total: res.value.data.length },
    );
  }, [filters]);

  useEffect(() => {
    void load();
  }, [load]);

  // debounced search trigger: filters object change triggers fetch; for search
  // we rely on onChange immediately. 簡易実装のため debounce は省く（将来拡張）。

  // ───────── Actions ─────────
  const handlePublish = async (post: Post) => {
    if (pendingId) return;
    if (
      !confirm(`「${(post.contentText ?? "").slice(0, 30)}」を即時公開します。よろしいですか？`)
    ) {
      return;
    }
    setPendingId(post.id);
    const res = await publishPostApi(post.id);
    setPendingId(null);
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    setFlash("投稿を公開しました");
    void load();
  };

  const handleDelete = async (post: Post) => {
    if (pendingId) return;
    if (!confirm("この投稿を削除します。よろしいですか？")) return;
    setPendingId(post.id);
    const res = await deletePostApi(post.id);
    setPendingId(null);
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    setFlash("投稿を削除しました");
    void load();
  };

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 2500);
    return () => clearTimeout(t);
  }, [flash]);

  // ───────── Pagination ─────────
  const totalPages = useMemo(() => {
    if (!meta.total) return 1;
    return Math.max(1, Math.ceil(meta.total / meta.limit));
  }, [meta]);
  const postsByPlatform = useMemo(() => {
    const grouped: Record<Platform, Post[]> = { x: [], line: [], instagram: [] };
    for (const post of posts) {
      grouped[post.platform].push(post);
    }
    return grouped;
  }, [posts]);

  const goToPage = (p: number) => {
    if (p < 1 || p > totalPages) return;
    setFilters((prev) => ({ ...prev, page: p }));
  };

  return (
    <div className="space-y-6">
      {/* ── Header ─────────────────────────── */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[0.7rem] font-medium uppercase tracking-[0.18em] text-base-content/50">
            {SECTION_KICKERS.posts}
          </p>
          <h1 className="mt-1 font-display text-3xl font-semibold leading-tight tracking-tight text-base-content">
            {MASTHEAD_TITLES.posts}
          </h1>
          <p className="mt-1 text-sm text-base-content/60">
            {meta.total.toLocaleString()} 件の投稿 ·{" "}
            {filters.platforms.length > 0 || filters.statuses.length > 0
              ? "フィルタ適用中"
              : "すべてを表示"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-field border border-base-300 bg-base-100 px-3 py-2 text-xs font-medium text-base-content/70 transition-colors hover:border-base-content/30 hover:text-base-content disabled:opacity-60"
          >
            <ArrowsClockwise size={14} weight="bold" />
            更新
          </button>
          <Link
            href="/posts/new"
            data-testid="new-post-button"
            className="inline-flex items-center gap-2 rounded-field bg-primary px-4 py-2 text-sm font-semibold text-primary-content shadow-sm transition-opacity hover:opacity-90"
          >
            <Plus size={14} weight="bold" />
            新規投稿
          </Link>
        </div>
      </header>

      {/* Flash */}
      {flash && (
        <div className="rounded-field border border-primary/30 bg-primary/5 px-4 py-2 text-xs text-primary">
          {flash}
        </div>
      )}

      {/* ── Filters ────────────────────────── */}
      <PostFilters value={filters} onChange={setFilters} disabled={loading} />

      {/* ── List ───────────────────────────── */}
      <div className="transition-opacity duration-200 motion-reduce:transition-none">
        {mode === "columns" ? (
          <div className="flex gap-4 overflow-x-auto pb-2 snap-x snap-mandatory sm:snap-none">
            {ALL_PLATFORMS.map((platform) => {
              const columnPosts = postsByPlatform[platform];
              const visual = PLATFORM_VISUALS[platform];

              return (
                <section
                  key={platform}
                  aria-label={`${visual.label} の投稿 ${columnPosts.length} 件`}
                  className="snap-start shrink-0 min-w-[22rem] max-w-[28rem] flex-1 rounded-box border border-base-300 bg-base-100"
                >
                  <header className="flex items-center gap-3 border-b border-base-300 px-4 py-3">
                    <PlatformIcon platform={platform} size={28} />
                    <div className="min-w-0">
                      <p className="font-display text-sm font-semibold text-base-content">
                        {visual.label}
                      </p>
                      <p className="text-[0.65rem] uppercase tracking-[0.18em] text-base-content/50">
                        {columnPosts.length} 件
                      </p>
                    </div>
                  </header>
                  <div className="p-4">
                    <PostList
                      posts={columnPosts}
                      loading={loading}
                      error={error}
                      onPublish={handlePublish}
                      onDelete={handleDelete}
                      pendingId={pendingId}
                      compact
                    />
                  </div>
                </section>
              );
            })}
          </div>
        ) : (
          <PostList
            posts={posts}
            loading={loading}
            error={error}
            onPublish={handlePublish}
            onDelete={handleDelete}
            pendingId={pendingId}
          />
        )}
      </div>

      {/* ── Pagination ─────────────────────── */}
      {mode === "unified" && meta.total > 0 && totalPages > 1 && (
        <nav
          aria-label="ページネーション"
          className="flex flex-col items-center justify-between gap-3 border-t border-base-200 pt-4 sm:flex-row"
        >
          <p className="text-[0.65rem] uppercase tracking-wider text-base-content/50">
            ページ {meta.page} / {totalPages} · {meta.total.toLocaleString()} 件
          </p>
          <div className="join">
            <button
              type="button"
              aria-label="前のページ"
              onClick={() => goToPage(meta.page - 1)}
              disabled={meta.page <= 1 || loading}
              className="btn btn-sm join-item border-base-300 bg-base-100"
            >
              <CaretLeft size={14} weight="bold" />
            </button>
            {buildPageWindow(meta.page, totalPages).map((p, i) =>
              p === "…" ? (
                <span
                  key={`gap-${i}`}
                  className="btn btn-sm join-item border-base-300 bg-base-100 pointer-events-none"
                >
                  …
                </span>
              ) : (
                <button
                  key={p}
                  type="button"
                  aria-label={`ページ ${p}`}
                  aria-current={p === meta.page ? "page" : undefined}
                  onClick={() => goToPage(p)}
                  disabled={loading}
                  className={[
                    "btn btn-sm join-item border-base-300",
                    p === meta.page ? "bg-secondary text-secondary-content" : "bg-base-100",
                  ].join(" ")}
                >
                  {p}
                </button>
              ),
            )}
            <button
              type="button"
              aria-label="次のページ"
              onClick={() => goToPage(meta.page + 1)}
              disabled={meta.page >= totalPages || loading}
              className="btn btn-sm join-item border-base-300 bg-base-100"
            >
              <CaretRight size={14} weight="bold" />
            </button>
          </div>
        </nav>
      )}
    </div>
  );
}

// ページ番号ウィンドウ（5 つ表示 + 先頭/末尾）
function buildPageWindow(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: (number | "…")[] = [1];
  const left = Math.max(2, current - 1);
  const right = Math.min(total - 1, current + 1);
  if (left > 2) out.push("…");
  for (let p = left; p <= right; p++) out.push(p);
  if (right < total - 1) out.push("…");
  out.push(total);
  return out;
}
