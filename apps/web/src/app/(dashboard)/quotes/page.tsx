"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowsClockwise,
  CheckCircle,
  Heart,
  PaperPlaneTilt,
  Quotes,
  Repeat,
  WarningCircle,
} from "@phosphor-icons/react";
import { SECTION_KICKERS, MASTHEAD_TITLES } from "@/lib/i18n/labels";
import { PlatformIcon } from "@/components/settings/PlatformIcon";

type AccountStatus = "active" | "expired" | "revoked" | "error";

interface SocialAccountSummary {
  id: string;
  platform: "x" | "line" | "instagram";
  status: AccountStatus;
}

interface ListAccountsResponse {
  data: SocialAccountSummary[];
}

interface QuoteTweet {
  id: string;
  workspaceId: string;
  socialAccountId: string;
  sourceTweetId: string;
  quoteTweetId: string;
  authorExternalId: string;
  authorUsername: string | null;
  authorDisplayName: string | null;
  authorProfileImageUrl: string | null;
  authorVerified: boolean;
  contentText: string | null;
  quotedAt: string | null;
  metrics: Record<string, unknown> | null;
  lastActionType: "reply" | "like" | "repost" | null;
  lastActionExternalId: string | null;
  lastActionAt: string | null;
  discoveredAt: string;
  lastSeenAt: string;
}

interface ListQuoteTweetsResponse {
  data: QuoteTweet[];
}

interface ApiError {
  error?: { code?: string; message?: string };
}

type Notice = { kind: "ok" | "error"; message: string } | null;

function formatDateTime(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(
    d.getDate(),
  ).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(
    2,
    "0",
  )}`;
}

function metricValue(metrics: Record<string, unknown> | null, key: string): string {
  const value = metrics?.[key];
  return typeof value === "number" ? value.toLocaleString() : "-";
}

function displayAuthor(quote: QuoteTweet): string {
  return quote.authorDisplayName ?? quote.authorUsername ?? quote.authorExternalId;
}

function displayHandle(quote: QuoteTweet): string {
  return quote.authorUsername ? `@${quote.authorUsername}` : quote.authorExternalId;
}

function truncateText(text: string | null, max = 120): string {
  if (!text) return "本文なし";
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max)}...`;
}

export default function QuotesPage() {
  return (
    <Suspense fallback={null}>
      <QuotesPageContent />
    </Suspense>
  );
}

function QuotesPageContent() {
  const [quotes, setQuotes] = useState<QuoteTweet[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [acting, setActing] = useState<"reply" | "like" | "repost" | null>(null);

  const selectedQuote = useMemo(
    () => quotes.find((quote) => quote.id === selectedId) ?? quotes[0] ?? null,
    [quotes, selectedId],
  );

  useEffect(() => {
    if (!selectedId && quotes[0]) {
      setSelectedId(quotes[0].id);
    }
  }, [quotes, selectedId]);

  const refreshQuotes = useCallback(async () => {
    setLoading(true);
    setNotice(null);
    try {
      const res = await fetch("/api/quote-tweets?limit=100", { credentials: "include" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as ApiError;
        throw new Error(body.error?.message ?? `引用一覧の取得に失敗しました (${res.status})`);
      }
      const body = (await res.json()) as ListQuoteTweetsResponse;
      setQuotes(body.data ?? []);
    } catch (err) {
      setQuotes([]);
      setNotice({
        kind: "error",
        message: err instanceof Error ? err.message : "引用一覧の取得に失敗しました",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  const syncQuotes = useCallback(async () => {
    setSyncing(true);
    setNotice(null);
    try {
      const accountsRes = await fetch("/api/accounts", { credentials: "include" });
      if (!accountsRes.ok) {
        const body = (await accountsRes.json().catch(() => ({}))) as ApiError;
        throw new Error(
          body.error?.message ?? `アカウント一覧の取得に失敗しました (${accountsRes.status})`,
        );
      }
      const accountsBody = (await accountsRes.json()) as ListAccountsResponse;
      const xAccounts = (accountsBody.data ?? []).filter(
        (account) => account.platform === "x" && account.status === "active",
      );
      for (const account of xAccounts) {
        const syncRes = await fetch("/api/quote-tweets/sync", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ socialAccountId: account.id, limit: 50 }),
        });
        if (!syncRes.ok) {
          const body = (await syncRes.json().catch(() => ({}))) as ApiError;
          throw new Error(body.error?.message ?? `引用同期に失敗しました (${syncRes.status})`);
        }
      }
      await refreshQuotes();
      setNotice({ kind: "ok", message: "同期しました" });
    } catch (err) {
      setNotice({
        kind: "error",
        message: err instanceof Error ? err.message : "引用同期に失敗しました",
      });
    } finally {
      setSyncing(false);
    }
  }, [refreshQuotes]);

  useEffect(() => {
    void refreshQuotes();
  }, [refreshQuotes]);

  const performAction = async (actionType: "reply" | "like" | "repost") => {
    if (!selectedQuote) return;
    const text = replyDraft.trim();
    if (actionType === "reply" && text.length === 0) return;
    setActing(actionType);
    setNotice(null);
    try {
      const res = await fetch(`/api/quote-tweets/${encodeURIComponent(selectedQuote.id)}/actions`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actionType,
          contentText: actionType === "reply" ? text : undefined,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as ApiError;
        throw new Error(body.error?.message ?? `操作に失敗しました (${res.status})`);
      }
      const body = (await res.json()) as { data: { quote: QuoteTweet } };
      setQuotes((prev) =>
        prev.map((quote) => (quote.id === body.data.quote.id ? body.data.quote : quote)),
      );
      if (actionType === "reply") setReplyDraft("");
      setNotice({ kind: "ok", message: "反映しました" });
    } catch (err) {
      setNotice({
        kind: "error",
        message: err instanceof Error ? err.message : "操作に失敗しました",
      });
    } finally {
      setActing(null);
    }
  };

  return (
    <div className="flex h-[calc(100vh-5rem)] flex-col gap-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="text-[0.7rem] font-medium uppercase tracking-[0.18em] text-base-content/50">
            {SECTION_KICKERS.quotes}
          </p>
          <h1 className="mt-1 font-display text-3xl font-semibold leading-tight tracking-tight text-base-content">
            {MASTHEAD_TITLES.quotes}
          </h1>
        </div>
        <button
          type="button"
          onClick={() => void syncQuotes()}
          disabled={loading || syncing}
          className="inline-flex min-h-10 items-center gap-2 rounded-field border border-base-300 bg-base-100 px-3 py-2 text-xs font-medium text-base-content/70 transition-colors hover:border-base-content/30 hover:text-base-content disabled:opacity-50"
        >
          <ArrowsClockwise
            size={14}
            weight="bold"
            className={loading || syncing ? "animate-spin" : undefined}
          />
          同期
        </button>
      </header>

      {notice ? (
        <div
          className={[
            "flex items-center gap-2 rounded-box border px-3 py-2 text-sm",
            notice.kind === "ok"
              ? "border-success/30 bg-success/10 text-success"
              : "border-error/30 bg-error/10 text-error",
          ].join(" ")}
        >
          {notice.kind === "ok" ? <CheckCircle size={18} /> : <WarningCircle size={18} />}
          {notice.message}
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(18rem,26rem)_1fr]">
        <section className="min-h-0 overflow-hidden rounded-box border border-base-300 bg-base-100">
          <div className="flex items-center justify-between border-b border-base-300 px-4 py-3">
            <div className="flex items-center gap-2">
              <Quotes size={20} weight="bold" />
              <span className="font-display text-sm font-semibold">Quotes</span>
            </div>
            <span className="text-xs text-base-content/50">{quotes.length} 件</span>
          </div>
          <div className="min-h-0 overflow-y-auto p-2">
            {loading ? (
              <p className="px-3 py-4 text-sm text-base-content/55">読み込み中</p>
            ) : quotes.length === 0 ? (
              <p className="px-3 py-4 text-sm text-base-content/55">引用はありません</p>
            ) : (
              <div className="space-y-2">
                {quotes.map((quote) => {
                  const active = selectedQuote?.id === quote.id;
                  return (
                    <button
                      key={quote.id}
                      type="button"
                      onClick={() => setSelectedId(quote.id)}
                      data-active={active}
                      className="block w-full rounded-box border border-base-300 bg-base-100 p-3 text-left transition-colors hover:border-base-content/30 data-[active=true]:border-secondary data-[active=true]:bg-secondary/10"
                    >
                      <div className="flex items-center gap-3">
                        <Avatar quote={quote} />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-base-content">
                            {displayAuthor(quote)}
                          </p>
                          <p className="truncate text-xs text-base-content/55">
                            {displayHandle(quote)}
                          </p>
                        </div>
                      </div>
                      <p className="mt-3 line-clamp-3 text-sm leading-6 text-base-content/75">
                        {truncateText(quote.contentText)}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        <section className="min-h-0 overflow-hidden rounded-box border border-base-300 bg-base-100">
          {selectedQuote ? (
            <div className="flex h-full min-h-0 flex-col">
              <div className="border-b border-base-300 px-5 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar quote={selectedQuote} large />
                    <div className="min-w-0">
                      <p className="truncate font-display text-lg font-semibold text-base-content">
                        {displayAuthor(selectedQuote)}
                      </p>
                      <p className="truncate text-xs text-base-content/55">
                        {displayHandle(selectedQuote)} / {formatDateTime(selectedQuote.quotedAt)}
                      </p>
                    </div>
                  </div>
                  <PlatformIcon platform="x" size={30} />
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
                <p className="whitespace-pre-wrap text-base leading-7 text-base-content">
                  {selectedQuote.contentText ?? "本文なし"}
                </p>
                <dl className="mt-6 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  <Metric label="Likes" value={metricValue(selectedQuote.metrics, "like_count")} />
                  <Metric
                    label="Reposts"
                    value={metricValue(selectedQuote.metrics, "retweet_count")}
                  />
                  <Metric
                    label="Source"
                    value={selectedQuote.sourceTweetId}
                    title={selectedQuote.sourceTweetId}
                  />
                  <Metric
                    label="Quote"
                    value={selectedQuote.quoteTweetId}
                    title={selectedQuote.quoteTweetId}
                  />
                </dl>
                {selectedQuote.lastActionType ? (
                  <p className="mt-4 text-xs text-base-content/55">
                    Last action: {selectedQuote.lastActionType} /{" "}
                    {formatDateTime(selectedQuote.lastActionAt)}
                  </p>
                ) : null}
              </div>

              <div className="border-t border-base-300 p-4">
                <textarea
                  value={replyDraft}
                  onChange={(e) => setReplyDraft(e.target.value)}
                  rows={3}
                  className="textarea textarea-bordered w-full resize-none text-sm"
                  placeholder="返信を書く"
                />
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void performAction("like")}
                      disabled={acting !== null}
                      className="btn btn-sm btn-outline"
                      title="Like"
                    >
                      <Heart size={16} weight="bold" />
                      Like
                    </button>
                    <button
                      type="button"
                      onClick={() => void performAction("repost")}
                      disabled={acting !== null}
                      className="btn btn-sm btn-outline"
                      title="Repost"
                    >
                      <Repeat size={16} weight="bold" />
                      Repost
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => void performAction("reply")}
                    disabled={acting !== null || replyDraft.trim().length === 0}
                    className="btn btn-sm btn-primary"
                    title="Reply"
                  >
                    <PaperPlaneTilt size={16} weight="bold" />
                    Reply
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center px-6 text-sm text-base-content/55">
              引用を選択
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Avatar({ quote, large = false }: { quote: QuoteTweet; large?: boolean }) {
  const size = large ? "h-12 w-12" : "h-10 w-10";
  if (quote.authorProfileImageUrl) {
    return (
      <img
        src={quote.authorProfileImageUrl}
        alt=""
        className={`${size} shrink-0 rounded-full border border-base-300 object-cover`}
      />
    );
  }
  return (
    <div
      className={`${size} flex shrink-0 items-center justify-center rounded-full border border-base-300 bg-base-200 font-display text-sm font-semibold text-base-content/60`}
    >
      {displayAuthor(quote).slice(0, 1).toUpperCase()}
    </div>
  );
}

function Metric({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="rounded-box border border-base-300 bg-base-100 px-3 py-2">
      <dt className="text-[0.65rem] uppercase tracking-[0.16em] text-base-content/45">{label}</dt>
      <dd className="mt-1 truncate text-sm font-medium text-base-content" title={title}>
        {value}
      </dd>
    </div>
  );
}
