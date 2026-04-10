/**
 * 受信トレイ (Inbox) 画面
 *
 * Task 6003: X / LINE / Instagram の DM・リプライ・コメントを統一的に参照・返信する。
 *
 * レイアウト:
 *  - デスクトップ: 左 = スレッド一覧 / 右 = 会話 + 返信
 *  - モバイル: 一覧 / 会話 の 2 ペインをスライド切り替え
 *
 * 機能:
 *  - GET  /api/inbox?platform=&status=open -> スレッド一覧
 *  - GET  /api/inbox/:threadId             -> メッセージ
 *  - POST /api/inbox/:threadId/reply       -> 返信送信
 *
 * デザイン方針 (frontend-design スキルに基づく):
 *  - 冷たい "AI スラップ" を避け、既存の warm off-white + Fraunces 見出しで
 *    編集的・手紙的な質感を維持する。
 *  - プラットフォーム色は左側の縦罫線と platform chip のみに限定し、
 *    スレッド本体は落ち着いた紙面として統一する。
 *  - inbound = 薄いオフホワイト + 左寄せ + 角丸左下シャープ
 *    outbound = primary 系グラデ + 右寄せ + 角丸右下シャープ
 *  - モーション: ペイン遷移のみ transform transition。ミクロインタラクションは最小。
 */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowsClockwise,
  PaperPlaneTilt,
  ChatCircleDots as EmptyChatIcon,
  Tray,
} from "@phosphor-icons/react";
import { PlatformIcon, PLATFORM_VISUALS } from "@/components/settings/PlatformIcon";
import type { Platform } from "@/components/settings/PlatformIcon";

// ───────────────────────────────────────────
// 型
// ───────────────────────────────────────────

type ThreadStatus = "open" | "closed" | "archived";
type MessageDirection = "inbound" | "outbound";

interface ConversationThread {
  id: string;
  workspaceId: string;
  socialAccountId: string;
  platform: Platform;
  externalThreadId: string | null;
  participantName: string | null;
  lastMessageAt: string | null;
  status: ThreadStatus;
  createdAt: string;
}

interface Message {
  id: string;
  threadId: string;
  direction: MessageDirection;
  contentText: string | null;
  contentMedia: unknown;
  externalMessageId: string | null;
  sentAt: string | null;
  createdAt: string;
}

interface ListThreadsResponse {
  data: ConversationThread[];
  meta: { limit: number; offset: number; total: number };
}

interface GetThreadResponse {
  data: {
    thread: ConversationThread;
    messages: Message[];
  };
}

interface SendReplyResponse {
  data: {
    message: Message;
    externalMessageId: string | null;
  };
}

interface ApiError {
  error?: { code?: string; message?: string };
}

// ───────────────────────────────────────────
// タブフィルタ
// ───────────────────────────────────────────

type TabValue = "all" | Platform;

const TABS: { value: TabValue; label: string }[] = [
  { value: "all", label: "すべて" },
  { value: "x", label: "X" },
  { value: "line", label: "LINE" },
  { value: "instagram", label: "Instagram" },
];

// ───────────────────────────────────────────
// ユーティリティ
// ───────────────────────────────────────────

function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const now = Date.now();
  const diffMs = now - d.getTime();
  if (diffMs < 0) return "たった今";
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return "たった今";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}分前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}時間前`;
  const day = Math.floor(hour / 24);
  if (day < 7) return `${day}日前`;
  // 7日以上は 月/日 表記
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function formatClock(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  return `${hh}:${mm}`;
}

// ───────────────────────────────────────────
// Page コンポーネント
// ───────────────────────────────────────────

export default function InboxPage() {
  const [activeTab, setActiveTab] = useState<TabValue>("all");
  const [threads, setThreads] = useState<ConversationThread[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<GetThreadResponse["data"] | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [replyDraft, setReplyDraft] = useState("");
  const [sendingReply, setSendingReply] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);

  // モバイルの右ペイン表示切り替え
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // ───────── Fetch threads ─────────
  const fetchThreads = useCallback(async () => {
    setLoadingList(true);
    setListError(null);
    try {
      const url = new URL("/api/inbox", window.location.origin);
      if (activeTab !== "all") {
        url.searchParams.set("platform", activeTab);
      }
      url.searchParams.set("limit", "100");
      const res = await fetch(url.toString(), { credentials: "include" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as ApiError;
        throw new Error(body.error?.message ?? `スレッドの取得に失敗しました (${res.status})`);
      }
      const body = (await res.json()) as ListThreadsResponse;
      setThreads(body.data ?? []);
    } catch (err) {
      setListError(err instanceof Error ? err.message : "スレッドの取得に失敗しました");
      setThreads([]);
    } finally {
      setLoadingList(false);
    }
  }, [activeTab]);

  useEffect(() => {
    void fetchThreads();
  }, [fetchThreads]);

  // ───────── Fetch thread detail ─────────
  const fetchDetail = useCallback(async (threadId: string) => {
    setLoadingDetail(true);
    setDetailError(null);
    try {
      const res = await fetch(`/api/inbox/${encodeURIComponent(threadId)}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as ApiError;
        throw new Error(body.error?.message ?? `メッセージの取得に失敗しました (${res.status})`);
      }
      const body = (await res.json()) as GetThreadResponse;
      setDetail(body.data);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "メッセージの取得に失敗しました");
      setDetail(null);
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    if (selectedId) {
      void fetchDetail(selectedId);
    } else {
      setDetail(null);
    }
  }, [selectedId, fetchDetail]);

  // メッセージ末尾へスクロール
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "auto" });
    }
  }, [detail]);

  // ───────── Select thread ─────────
  const handleSelectThread = (id: string) => {
    setSelectedId(id);
    setReplyDraft("");
    setReplyError(null);
    setMobileDetailOpen(true);
  };

  // ───────── Send reply ─────────
  const handleSendReply = async () => {
    if (!selectedId || !replyDraft.trim()) return;
    setSendingReply(true);
    setReplyError(null);
    try {
      const res = await fetch(`/api/inbox/${encodeURIComponent(selectedId)}/reply`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentText: replyDraft }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as ApiError;
        throw new Error(body.error?.message ?? `送信に失敗しました (${res.status})`);
      }
      const body = (await res.json()) as SendReplyResponse;
      // 楽観的に messages に追加
      setDetail((prev) =>
        prev ? { ...prev, messages: [...prev.messages, body.data.message] } : prev,
      );
      setReplyDraft("");
      // 一覧の last_message_at を更新するため再取得
      void fetchThreads();
    } catch (err) {
      setReplyError(err instanceof Error ? err.message : "送信に失敗しました");
    } finally {
      setSendingReply(false);
    }
  };

  // ───────── 派生状態 ─────────
  const filteredThreads = useMemo(() => threads ?? [], [threads]);
  const selectedThread = detail?.thread;

  return (
    <div className="relative flex h-[calc(100vh-5rem)] flex-col gap-6">
      {/* ── Header ─────────────────────────────── */}
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="text-[0.7rem] font-medium uppercase tracking-[0.18em] text-base-content/50">
            Unified Inbox · 受信トレイ
          </p>
          <h1 className="mt-1 font-display text-3xl font-semibold leading-tight tracking-tight text-base-content">
            会話を一箇所で読む
          </h1>
        </div>
        <button
          type="button"
          onClick={() => void fetchThreads()}
          className="inline-flex items-center gap-2 rounded-field border border-base-300 bg-base-100 px-3 py-2 text-xs font-medium text-base-content/70 transition-colors hover:border-base-content/30 hover:text-base-content"
        >
          <ArrowsClockwise size={14} weight="bold" />
          更新
        </button>
      </header>

      {/* ── Tab filter ─────────────────────────── */}
      <TabBar value={activeTab} onChange={setActiveTab} />

      {/* ── Body: 2 columns ────────────────────── */}
      <div className="relative flex min-h-0 flex-1 overflow-hidden rounded-box border border-base-300 bg-base-100/60 shadow-[0_1px_0_rgba(0,0,0,0.03),0_20px_50px_-30px_rgba(0,0,0,0.18)]">
        {/* 左: スレッド一覧 */}
        <aside
          className={[
            "flex w-full shrink-0 flex-col border-r border-base-300 bg-base-100/80 md:w-[22rem] lg:w-[26rem]",
            mobileDetailOpen ? "hidden md:flex" : "flex",
          ].join(" ")}
        >
          <ThreadList
            threads={filteredThreads}
            loading={loadingList}
            error={listError}
            selectedId={selectedId}
            onSelect={handleSelectThread}
          />
        </aside>

        {/* 右: 会話 + 返信 */}
        <section
          className={[
            "min-w-0 flex-1 flex-col bg-base-100",
            mobileDetailOpen ? "flex" : "hidden md:flex",
          ].join(" ")}
        >
          {selectedThread ? (
            <ConversationPanel
              thread={selectedThread}
              messages={detail?.messages ?? []}
              loading={loadingDetail}
              error={detailError}
              replyDraft={replyDraft}
              onReplyChange={setReplyDraft}
              onSend={handleSendReply}
              sending={sendingReply}
              replyError={replyError}
              onBack={() => setMobileDetailOpen(false)}
              messagesEndRef={messagesEndRef}
            />
          ) : (
            <EmptyState />
          )}
        </section>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────
// TabBar
// ───────────────────────────────────────────
function TabBar({ value, onChange }: { value: TabValue; onChange: (v: TabValue) => void }) {
  return (
    <nav
      aria-label="プラットフォームフィルタ"
      className="inline-flex w-full items-center gap-1 self-start rounded-box border border-base-300 bg-base-100 p-1 sm:w-auto"
    >
      {TABS.map((tab) => {
        const active = value === tab.value;
        return (
          <button
            key={tab.value}
            type="button"
            onClick={() => onChange(tab.value)}
            className={[
              "relative min-w-[4.5rem] rounded-field px-3.5 py-1.5 text-xs font-medium transition-colors",
              active
                ? "bg-secondary text-secondary-content shadow-sm"
                : "text-base-content/60 hover:text-base-content",
            ].join(" ")}
          >
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}

// ───────────────────────────────────────────
// ThreadList
// ───────────────────────────────────────────
function ThreadList({
  threads,
  loading,
  error,
  selectedId,
  onSelect,
}: {
  threads: ConversationThread[];
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-base-300 px-5 py-4">
        <span className="font-display text-sm font-semibold text-base-content">
          スレッド
          <span className="ml-2 font-sans text-xs font-normal text-base-content/50">
            {threads.length}
          </span>
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && (
          <div className="space-y-3 px-5 py-6">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-16 animate-pulse rounded-field border border-base-200 bg-base-200/50"
              />
            ))}
          </div>
        )}

        {error && !loading && (
          <div className="m-4 rounded-field border border-error/30 bg-error/5 px-4 py-3 text-xs text-error">
            {error}
          </div>
        )}

        {!loading && !error && threads.length === 0 && (
          <div className="flex h-full items-center justify-center px-6 py-10 text-center">
            <div>
              <Tray size={32} className="mx-auto text-base-content/20" weight="light" />
              <p className="mt-3 font-display text-sm text-base-content/50">まだ会話はありません</p>
              <p className="mt-1 text-xs text-base-content/40">
                Webhook が受信されると、ここに表示されます
              </p>
            </div>
          </div>
        )}

        <ul className="divide-y divide-base-200">
          {threads.map((t) => {
            const active = t.id === selectedId;
            const visual = PLATFORM_VISUALS[t.platform];
            return (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => onSelect(t.id)}
                  className={[
                    "group flex w-full items-start gap-3 px-5 py-4 text-left transition-colors",
                    active ? "bg-base-200/60" : "hover:bg-base-200/40",
                  ].join(" ")}
                >
                  {/* 左の細いプラットフォーム罫線 */}
                  <span
                    aria-hidden
                    className="mt-1 h-10 w-0.5 shrink-0 rounded-full"
                    style={{ background: visual.background }}
                  />
                  <PlatformIcon platform={t.platform} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate font-display text-sm font-semibold text-base-content">
                        {t.participantName ?? "(未設定)"}
                      </p>
                      <span className="shrink-0 text-[0.65rem] uppercase tracking-wide text-base-content/40">
                        {formatRelative(t.lastMessageAt)}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-base-content/60">
                      {t.externalThreadId ?? "—"}
                    </p>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <span
                        className={[
                          "inline-flex items-center rounded-full px-1.5 py-0.5 text-[0.6rem] font-medium uppercase tracking-wide",
                          t.status === "open"
                            ? "bg-primary/10 text-primary"
                            : t.status === "closed"
                              ? "bg-base-300 text-base-content/60"
                              : "bg-warning/15 text-warning-content",
                        ].join(" ")}
                      >
                        {t.status}
                      </span>
                      <span className="text-[0.65rem] text-base-content/40">{visual.label}</span>
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────
// ConversationPanel
// ───────────────────────────────────────────
function ConversationPanel({
  thread,
  messages,
  loading,
  error,
  replyDraft,
  onReplyChange,
  onSend,
  sending,
  replyError,
  onBack,
  messagesEndRef,
}: {
  thread: ConversationThread;
  messages: Message[];
  loading: boolean;
  error: string | null;
  replyDraft: string;
  onReplyChange: (v: string) => void;
  onSend: () => void;
  sending: boolean;
  replyError: string | null;
  onBack: () => void;
  messagesEndRef: React.MutableRefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ヘッダ */}
      <div className="flex items-center gap-3 border-b border-base-300 bg-base-100 px-5 py-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex h-8 w-8 items-center justify-center rounded-field text-base-content/60 hover:bg-base-200 md:hidden"
          aria-label="戻る"
        >
          <ArrowLeft size={18} weight="bold" />
        </button>
        <PlatformIcon platform={thread.platform} size={36} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-base font-semibold text-base-content">
            {thread.participantName ?? "(未設定)"}
          </p>
          <p className="mt-0.5 truncate text-xs text-base-content/50">
            {thread.externalThreadId ?? "—"} · {PLATFORM_VISUALS[thread.platform].label}
          </p>
        </div>
        <span className="hidden rounded-full bg-base-200 px-2 py-0.5 text-[0.65rem] font-medium uppercase tracking-wide text-base-content/60 sm:inline">
          {thread.status}
        </span>
      </div>

      {/* メッセージ領域 */}
      <div className="min-h-0 flex-1 overflow-y-auto bg-base-100/80 px-4 py-6 sm:px-8">
        {loading && (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-12 animate-pulse rounded-box border border-base-200 bg-base-200/50"
              />
            ))}
          </div>
        )}
        {error && !loading && (
          <div className="rounded-field border border-error/30 bg-error/5 px-4 py-3 text-xs text-error">
            {error}
          </div>
        )}
        {!loading && !error && messages.length === 0 && (
          <div className="flex h-full items-center justify-center text-center">
            <div>
              <EmptyChatIcon size={28} className="mx-auto text-base-content/20" weight="light" />
              <p className="mt-2 text-sm text-base-content/50">メッセージはまだありません</p>
            </div>
          </div>
        )}

        <ul className="space-y-3">
          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}
        </ul>
        <div ref={messagesEndRef} />
      </div>

      {/* 返信入力 */}
      <div className="border-t border-base-300 bg-base-100 px-5 py-4">
        {replyError && (
          <div className="mb-2 rounded-field border border-error/30 bg-error/5 px-3 py-2 text-xs text-error">
            {replyError}
          </div>
        )}
        <div className="flex items-end gap-3 rounded-box border border-base-300 bg-base-100 p-2 focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/15">
          <textarea
            rows={2}
            value={replyDraft}
            onChange={(e) => onReplyChange(e.target.value)}
            placeholder={`${thread.participantName ?? "この相手"}へ返信...`}
            disabled={sending}
            className="min-w-0 flex-1 resize-none bg-transparent px-3 py-2 text-sm text-base-content placeholder:text-base-content/40 focus:outline-none disabled:opacity-60"
            onKeyDown={(e) => {
              // Cmd/Ctrl + Enter で送信
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                onSend();
              }
            }}
          />
          <button
            type="button"
            onClick={onSend}
            disabled={sending || replyDraft.trim().length === 0}
            className="inline-flex h-10 items-center gap-1.5 rounded-field bg-primary px-4 text-sm font-medium text-primary-content transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <PaperPlaneTilt size={14} weight="fill" />
            {sending ? "送信中" : "送信"}
          </button>
        </div>
        <p className="mt-1.5 text-[0.65rem] text-base-content/40">
          ⌘/Ctrl + Enter で送信 · 返信は承認ポリシーに従って記録されます
        </p>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────
// MessageBubble
// ───────────────────────────────────────────
function MessageBubble({ message }: { message: Message }) {
  const isOutbound = message.direction === "outbound";
  return (
    <li className={isOutbound ? "flex justify-end" : "flex justify-start"}>
      <div
        className={[
          "max-w-[80%] rounded-box border px-4 py-2.5 text-sm shadow-[0_1px_0_rgba(0,0,0,0.02)]",
          isOutbound
            ? "rounded-br-sm border-primary/20 bg-gradient-to-br from-primary/12 to-primary/6 text-base-content"
            : "rounded-bl-sm border-base-300 bg-base-100 text-base-content",
        ].join(" ")}
      >
        {message.contentText ? (
          <p className="whitespace-pre-wrap break-words leading-relaxed">{message.contentText}</p>
        ) : (
          <p className="italic text-base-content/50">(メディアのみ)</p>
        )}
        <p
          className={[
            "mt-1 text-[0.65rem] tracking-wide",
            isOutbound ? "text-primary/70" : "text-base-content/40",
          ].join(" ")}
        >
          {isOutbound ? "送信" : "受信"} · {formatClock(message.sentAt ?? message.createdAt)}
        </p>
      </div>
    </li>
  );
}

// ───────────────────────────────────────────
// EmptyState (右ペイン初期)
// ───────────────────────────────────────────
function EmptyState() {
  return (
    <div className="flex h-full items-center justify-center px-8 text-center">
      <div className="max-w-sm">
        <div
          aria-hidden
          className="mx-auto flex h-16 w-16 items-center justify-center rounded-box border border-base-300 bg-base-100"
        >
          <Tray size={28} className="text-base-content/30" weight="light" />
        </div>
        <h2 className="mt-4 font-display text-xl font-semibold text-base-content">
          会話を選択してください
        </h2>
        <p className="mt-1 text-sm text-base-content/50">
          左側からスレッドを選ぶと、過去のやりとりと返信欄が表示されます。
        </p>
      </div>
    </div>
  );
}
