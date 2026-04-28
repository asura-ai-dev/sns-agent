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

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowsClockwise,
  FilmSlate,
  Image as ImageIcon,
  Paperclip,
  PaperPlaneTilt,
  ChatCircleDots as EmptyChatIcon,
  Tray,
} from "@phosphor-icons/react";
import { StatusBadge } from "@/components/posts/StatusBadge";
import type { PostStatus } from "@/components/posts/types";
import { PlatformIcon, PLATFORM_VISUALS } from "@/components/settings/PlatformIcon";
import type { Platform } from "@/components/settings/PlatformIcon";
import { MASTHEAD_TITLES, SECTION_KICKERS } from "@/lib/i18n/labels";
import { usePlatformViewMode } from "@/lib/view-mode/usePlatformViewMode";

// ───────────────────────────────────────────
// 型
// ───────────────────────────────────────────

type ThreadStatus = "open" | "closed" | "archived";
type MessageDirection = "inbound" | "outbound";
type InboxChannel = "direct" | "public";
type InboxInitiator = "self" | "external" | "mixed" | "unknown";
type XEntryType = "mention" | "reply" | "thread" | "dm";

interface XThreadProviderMetadata {
  entryType: XEntryType;
  conversationId: string | null;
  rootPostId: string | null;
  focusPostId: string | null;
  replyToPostId: string | null;
  authorXUserId: string | null;
  authorUsername: string | null;
}

interface XMessageProviderMetadata {
  entryType: XEntryType;
  conversationId: string | null;
  postId: string | null;
  replyToPostId: string | null;
  authorUsername: string | null;
  mentionedXUserIds: string[];
}

interface ConversationThread {
  id: string;
  workspaceId: string;
  socialAccountId: string;
  platform: Platform;
  externalThreadId: string | null;
  participantName: string | null;
  participantExternalId: string | null;
  channel: InboxChannel | null;
  initiatedBy: InboxInitiator | null;
  lastMessageAt: string | null;
  providerMetadata: {
    x?: XThreadProviderMetadata;
  } | null;
  status: ThreadStatus;
  createdAt: string;
}

interface Message {
  id: string;
  threadId: string;
  direction: MessageDirection;
  contentText: string | null;
  contentMedia: Array<{
    type: "image" | "video";
    url: string;
    mimeType: string;
  }> | null;
  externalMessageId: string | null;
  authorExternalId: string | null;
  authorDisplayName: string | null;
  sentAt: string | null;
  providerMetadata: {
    x?: XMessageProviderMetadata;
  } | null;
  createdAt: string;
}

interface ReplyMediaDraft {
  type: "image" | "video";
  url: string;
  mimeType: string | null;
  name: string;
}

interface RelatedPostSummary {
  id: string;
  platform: Platform;
  status: PostStatus;
  platformPostId: string | null;
  contentText: string | null;
  createdAt: string;
  publishedAt: string | null;
}

interface ListThreadsResponse {
  data: ConversationThread[];
  meta: { limit: number; offset: number; total: number };
}

type AccountStatus = "active" | "expired" | "revoked" | "error";

interface SocialAccountSummary {
  id: string;
  platform: Platform;
  status: AccountStatus;
}

interface ListAccountsResponse {
  data: SocialAccountSummary[];
}

interface GetThreadResponse {
  data: {
    thread: ConversationThread;
    messages: Message[];
    context: {
      entryType: XEntryType | null;
      conversationId: string | null;
      rootPostId: string | null;
      focusPostId: string | null;
      replyToPostId: string | null;
      relatedPosts: RelatedPostSummary[];
    };
  };
}

type SendReplyResponse =
  | {
      data: {
        message: Message;
        externalMessageId: string | null;
      };
      meta?: {
        requiresApproval?: false;
      };
    }
  | {
      data: {
        threadId: string;
        status: "pending_approval";
        contentText: string;
      };
      meta: {
        requiresApproval: true;
        approvalId: string;
      };
    };

interface ApiError {
  error?: { code?: string; message?: string };
}

type ReplyNotice =
  | { kind: "sent"; message: string }
  | {
      kind: "pending";
      message: string;
      approvalId: string;
      contentText: string;
      mediaCount?: number;
    }
  | { kind: "failed"; message: string };

function isPendingReplyResponse(
  response: SendReplyResponse,
): response is Extract<SendReplyResponse, { data: { status: "pending_approval" } }> {
  return "status" in response.data && response.data.status === "pending_approval";
}

// ───────────────────────────────────────────
// タブフィルタ
// ───────────────────────────────────────────

type TabValue = "all" | Platform;

const TABS: { value: TabValue; label: string; platform?: Platform }[] = [
  { value: "all", label: "すべて" },
  { value: "x", label: "X", platform: "x" },
  { value: "line", label: "LINE", platform: "line" },
  { value: "instagram", label: "Instagram", platform: "instagram" },
];

const COLUMN_PLATFORMS: Platform[] = ["x", "line", "instagram"];

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

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(
    d.getDate(),
  ).padStart(
    2,
    "0",
  )} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function humanizeThreadStatus(status: ThreadStatus): string {
  switch (status) {
    case "open":
      return "対応中";
    case "closed":
      return "完了";
    case "archived":
      return "保管";
    default:
      return status;
  }
}

function humanizeChannel(channel: InboxChannel | null): string {
  switch (channel) {
    case "direct":
      return "DM / 個別連絡";
    case "public":
      return "公開会話";
    default:
      return "未分類";
  }
}

function humanizeInitiator(initiatedBy: InboxInitiator | null): string {
  switch (initiatedBy) {
    case "self":
      return "こちらから開始";
    case "external":
      return "相手から開始";
    case "mixed":
      return "両方向で進行";
    case "unknown":
      return "開始元は不明";
    default:
      return "開始元は未判定";
  }
}

function humanizeEntryType(entryType: XEntryType | null | undefined): string {
  switch (entryType) {
    case "mention":
      return "メンション";
    case "reply":
      return "リプライ";
    case "thread":
      return "スレッド会話";
    case "dm":
      return "ダイレクトメッセージ";
    default:
      return "会話";
  }
}

function summarizeThread(thread: ConversationThread): string {
  const parts = [
    humanizeEntryType(thread.providerMetadata?.x?.entryType),
    humanizeChannel(thread.channel),
    humanizeInitiator(thread.initiatedBy),
  ].filter(Boolean);
  return parts.join(" / ");
}

function truncateText(text: string | null | undefined, max = 56): string {
  if (!text) return "本文はまだありません";
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max)}…`;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("ファイルを読み込めませんでした"));
    };
    reader.onerror = () => reject(reader.error ?? new Error("ファイルを読み込めませんでした"));
    reader.readAsDataURL(file);
  });
}

// ───────────────────────────────────────────
// Page コンポーネント
// ───────────────────────────────────────────

export default function InboxPage() {
  return (
    <Suspense fallback={null}>
      <InboxPageContent />
    </Suspense>
  );
}

function InboxPageContent() {
  const { mode } = usePlatformViewMode("inbox");
  const [activeTab, setActiveTab] = useState<TabValue>("all");
  const [threads, setThreads] = useState<ConversationThread[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [syncingInbox, setSyncingInbox] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<GetThreadResponse["data"] | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [replyDraft, setReplyDraft] = useState("");
  const [replyMedia, setReplyMedia] = useState<ReplyMediaDraft[]>([]);
  const [sendingReply, setSendingReply] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [replyNotice, setReplyNotice] = useState<ReplyNotice | null>(null);

  // モバイルの右ペイン表示切り替え
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const handleReplyFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    try {
      const next = await Promise.all(
        Array.from(files).map(async (file) => {
          if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
            throw new Error("画像または動画ファイルを選んでください");
          }

          const url = await readFileAsDataUrl(file);
          return {
            type: file.type.startsWith("video/") ? "video" : "image",
            url,
            mimeType: file.type || null,
            name: file.name,
          } satisfies ReplyMediaDraft;
        }),
      );

      setReplyMedia((prev) => [...prev, ...next]);
      setReplyError(null);
    } catch (err) {
      setReplyError(err instanceof Error ? err.message : "添付ファイルの読み込みに失敗しました");
    }
  }, []);

  const removeReplyMedia = useCallback((index: number) => {
    setReplyMedia((prev) => prev.filter((_, currentIndex) => currentIndex !== index));
  }, []);

  // ───────── Fetch threads ─────────
  const syncInbox = useCallback(async () => {
    if (activeTab !== "all" && activeTab !== "x") {
      return;
    }

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
      const syncRes = await fetch("/api/inbox/sync", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ socialAccountId: account.id, limit: 20 }),
      });
      if (!syncRes.ok) {
        const body = (await syncRes.json().catch(() => ({}))) as ApiError;
        throw new Error(body.error?.message ?? `X の受信同期に失敗しました (${syncRes.status})`);
      }
    }
  }, [activeTab]);

  const refreshThreads = useCallback(async () => {
    setLoadingList(true);
    setListError(null);
    try {
      setSyncingInbox(true);
      await syncInbox();
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
      setSyncingInbox(false);
      setLoadingList(false);
    }
  }, [activeTab, syncInbox]);

  useEffect(() => {
    void refreshThreads();
  }, [refreshThreads]);

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
    setReplyMedia([]);
    setReplyError(null);
    setReplyNotice(null);
    setMobileDetailOpen(true);
  };

  // ───────── Send reply ─────────
  const handleSendReply = async () => {
    const trimmedReply = replyDraft.trim();
    if (!selectedId || (trimmedReply.length === 0 && replyMedia.length === 0)) return;
    setSendingReply(true);
    setReplyError(null);
    setReplyNotice(null);
    try {
      const res = await fetch(`/api/inbox/${encodeURIComponent(selectedId)}/reply`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contentText: trimmedReply,
          contentMedia: replyMedia.map((media) => ({
            type: media.type,
            url: media.url,
            mimeType: media.mimeType ?? "application/octet-stream",
          })),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as ApiError;
        throw new Error(body.error?.message ?? `送信に失敗しました (${res.status})`);
      }
      const body = (await res.json()) as SendReplyResponse;
      if (!isPendingReplyResponse(body)) {
        const sentMessage = body.data.message;
        setDetail((prev) => (prev ? { ...prev, messages: [...prev.messages, sentMessage] } : prev));
        setReplyDraft("");
        setReplyMedia([]);
        setReplyNotice({
          kind: "sent",
          message:
            replyMedia.length > 0
              ? `返信を送信しました。画像・動画 ${replyMedia.length} 件も一緒に送られています。`
              : "返信を送信しました。タイムラインにも反映されています。",
        });
        void refreshThreads();
      } else {
        setReplyDraft("");
        setReplyMedia([]);
        setReplyNotice({
          kind: "pending",
          message:
            replyMedia.length > 0
              ? "この返信と添付ファイルは承認待ちです。管理者が承認すると送信されます。"
              : "この返信は承認待ちです。管理者が承認すると送信されます。",
          approvalId: body.meta.approvalId,
          contentText: trimmedReply,
          mediaCount: replyMedia.length,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "送信に失敗しました";
      setReplyError(message);
      setReplyNotice({
        kind: "failed",
        message: "返信はまだ送られていません。内容はこのまま残して再送できます。",
      });
    } finally {
      setSendingReply(false);
    }
  };

  // ───────── 派生状態 ─────────
  const filteredThreads = useMemo(() => threads ?? [], [threads]);
  const threadsByPlatform = useMemo(() => {
    const grouped: Record<Platform, ConversationThread[]> = { x: [], line: [], instagram: [] };
    for (const thread of filteredThreads) {
      grouped[thread.platform].push(thread);
    }
    return grouped;
  }, [filteredThreads]);
  const selectedThread =
    detail?.thread?.id === selectedId
      ? detail.thread
      : (filteredThreads.find((thread) => thread.id === selectedId) ?? null);
  const selectedContext = detail?.thread?.id === selectedId ? detail.context : null;
  const canSendReply = replyDraft.trim().length > 0 || replyMedia.length > 0;

  return (
    <div className="relative flex h-[calc(100vh-5rem)] flex-col gap-6">
      {/* ── Header ─────────────────────────────── */}
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="text-[0.7rem] font-medium uppercase tracking-[0.18em] text-base-content/50">
            {SECTION_KICKERS.inbox}
          </p>
          <h1 className="mt-1 font-display text-3xl font-semibold leading-tight tracking-tight text-base-content">
            {MASTHEAD_TITLES.inbox}
          </h1>
        </div>
        <button
          type="button"
          onClick={() => void refreshThreads()}
          disabled={loadingList || syncingInbox}
          className="inline-flex items-center gap-2 rounded-field border border-base-300 bg-base-100 px-3 py-2 text-xs font-medium text-base-content/70 transition-colors hover:border-base-content/30 hover:text-base-content"
        >
          <ArrowsClockwise
            size={14}
            weight="bold"
            className={loadingList || syncingInbox ? "animate-spin" : undefined}
          />
          同期して更新
        </button>
      </header>

      {/* ── Tab filter ─────────────────────────── */}
      <TabBar value={activeTab} onChange={setActiveTab} />

      <p className="text-[0.72rem] text-base-content/55">
        X のメンションと DM は、この画面を開いた時と「同期して更新」で取り込みます。
      </p>

      {/* ── Body: 2 columns ────────────────────── */}
      <div className="relative flex min-h-0 flex-1 overflow-hidden rounded-box border border-base-300 bg-base-100/60 shadow-[0_1px_0_rgba(0,0,0,0.03),0_20px_50px_-30px_rgba(0,0,0,0.18)]">
        {/* 左: スレッド一覧 */}
        <aside
          className={[
            "flex w-full shrink-0 flex-col border-r border-base-300 bg-base-100/80",
            mode === "columns" ? "md:min-w-0 md:flex-1 md:w-auto" : "md:w-[22rem] lg:w-[26rem]",
            mobileDetailOpen ? "hidden md:flex" : "flex",
          ].join(" ")}
        >
          {mode === "columns" ? (
            <div className="flex h-full min-h-0 flex-col">
              <div className="flex min-h-0 flex-1 gap-4 overflow-x-auto px-4 py-4 snap-x snap-mandatory md:px-5 sm:snap-none">
                {COLUMN_PLATFORMS.map((platform) => {
                  const platformThreads = threadsByPlatform[platform];
                  const visual = PLATFORM_VISUALS[platform];

                  return (
                    <section
                      key={platform}
                      aria-label={`${visual.label} のスレッド ${platformThreads.length} 件`}
                      className="flex h-full min-h-0 w-[18rem] shrink-0 snap-start flex-col rounded-box border border-base-300 bg-base-100 md:w-[20rem]"
                    >
                      <header className="flex items-center justify-between gap-3 border-b border-base-300 px-4 py-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <PlatformIcon platform={platform} size={28} />
                          <div className="min-w-0">
                            <p className="font-display text-sm font-semibold text-base-content">
                              {visual.label}
                            </p>
                            <p className="text-[0.65rem] uppercase tracking-[0.18em] text-base-content/50">
                              {platformThreads.length} 件
                            </p>
                          </div>
                        </div>
                      </header>
                      <div className="min-h-0 flex-1 overflow-y-auto">
                        <ThreadList
                          threads={platformThreads}
                          loading={loadingList}
                          error={listError}
                          selectedId={selectedId}
                          onSelect={handleSelectThread}
                          hideHeader
                        />
                      </div>
                    </section>
                  );
                })}
              </div>
            </div>
          ) : (
            <ThreadList
              threads={filteredThreads}
              loading={loadingList}
              error={listError}
              selectedId={selectedId}
              onSelect={handleSelectThread}
            />
          )}
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
              context={selectedContext}
              loading={loadingDetail}
              error={detailError}
              replyDraft={replyDraft}
              replyMedia={replyMedia}
              onReplyChange={setReplyDraft}
              onReplyFiles={handleReplyFiles}
              onRemoveReplyMedia={removeReplyMedia}
              onSend={handleSendReply}
              canSend={canSendReply}
              sending={sendingReply}
              replyError={replyError}
              replyNotice={replyNotice}
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
            aria-label={`${tab.label} で絞り込み`}
            aria-pressed={active}
            title={tab.label}
            className={[
              "relative inline-flex min-h-9 min-w-[4.5rem] items-center justify-center rounded-field px-3 py-1.5 text-xs font-medium transition-colors",
              active
                ? "bg-secondary text-secondary-content shadow-sm"
                : "text-base-content/60 hover:text-base-content",
            ].join(" ")}
          >
            {tab.platform ? (
              <>
                <PlatformIcon platform={tab.platform} variant="chip" size={18} />
                <span className="sr-only">{tab.label}</span>
              </>
            ) : (
              tab.label
            )}
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
  hideHeader = false,
}: {
  threads: ConversationThread[];
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  hideHeader?: boolean;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      {!hideHeader && (
        <div className="flex items-center justify-between border-b border-base-300 px-5 py-4">
          <span className="font-display text-sm font-semibold text-base-content">
            スレッド
            <span className="ml-2 font-sans text-xs font-normal text-base-content/50">
              {threads.length}
            </span>
          </span>
        </div>
      )}

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
                      {summarizeThread(t)}
                    </p>
                    <p className="mt-1 truncate text-[0.72rem] text-base-content/45">
                      {t.participantExternalId
                        ? `相手ID: ${t.participantExternalId}`
                        : (t.externalThreadId ?? "スレッドID未設定")}
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
                        {humanizeThreadStatus(t.status)}
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
  context,
  loading,
  error,
  replyDraft,
  replyMedia,
  onReplyChange,
  onReplyFiles,
  onRemoveReplyMedia,
  onSend,
  canSend,
  sending,
  replyError,
  replyNotice,
  onBack,
  messagesEndRef,
}: {
  thread: ConversationThread;
  messages: Message[];
  context: GetThreadResponse["data"]["context"] | null;
  loading: boolean;
  error: string | null;
  replyDraft: string;
  replyMedia: ReplyMediaDraft[];
  onReplyChange: (v: string) => void;
  onReplyFiles: (files: FileList | null) => void;
  onRemoveReplyMedia: (index: number) => void;
  onSend: () => void;
  canSend: boolean;
  sending: boolean;
  replyError: string | null;
  replyNotice: ReplyNotice | null;
  onBack: () => void;
  messagesEndRef: React.MutableRefObject<HTMLDivElement | null>;
}) {
  const conversationSummary = summarizeThread(thread);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const supportsReplyMedia = thread.platform === "x";
  const isDirectMessage = thread.providerMetadata?.x?.entryType === "dm";

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
            {conversationSummary} · {PLATFORM_VISUALS[thread.platform].label}
          </p>
        </div>
        <span className="hidden rounded-full bg-base-200 px-2 py-0.5 text-[0.65rem] font-medium uppercase tracking-wide text-base-content/60 sm:inline">
          {humanizeThreadStatus(thread.status)}
        </span>
      </div>

      {/* メッセージ領域 */}
      <div className="min-h-0 flex-1 overflow-y-auto bg-base-100/80 px-4 py-6 sm:px-8">
        <ConversationSummaryCards thread={thread} messages={messages} context={context} />

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
        <ReplyNoticeBanner notice={replyNotice} />
        {replyError && (
          <div className="mb-2 rounded-field border border-error/30 bg-error/5 px-3 py-2 text-xs text-error">
            {replyError}
          </div>
        )}
        {supportsReplyMedia && (
          <div className="mb-3 rounded-box border border-base-300 bg-base-100/80 px-3 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-base-content/50">
                  添付ファイル
                </p>
                <p className="mt-1 text-xs leading-relaxed text-base-content/60">
                  {isDirectMessage
                    ? "X DM では画像・動画を添えて送れます。本文を書かなくても、添付があれば送信できます。"
                    : "X の返信に画像・動画を添えられます。本文がなくても、添付があれば送信できます。"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={sending}
                className="inline-flex items-center gap-2 rounded-field border border-base-300 bg-base-100 px-3 py-2 text-xs font-medium text-base-content/70 transition-colors hover:border-base-content/30 hover:text-base-content disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Paperclip size={14} weight="bold" />
                画像・動画を添付
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*"
              multiple
              className="hidden"
              onChange={(event) => {
                void onReplyFiles(event.target.files);
                event.currentTarget.value = "";
              }}
            />

            {replyMedia.length > 0 && (
              <ul className="mt-3 space-y-2">
                {replyMedia.map((media, index) => (
                  <li
                    key={`${media.url}-${index}`}
                    className="flex items-center gap-3 rounded-field border border-base-300 bg-base-100 px-3 py-2"
                  >
                    {media.type === "video" ? (
                      <FilmSlate size={16} weight="bold" className="text-base-content/45" />
                    ) : (
                      <ImageIcon size={16} weight="bold" className="text-base-content/45" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-base-content">{media.name}</p>
                      <p className="text-[0.65rem] uppercase tracking-[0.14em] text-base-content/45">
                        {media.type === "video" ? "動画" : "画像"}
                        {media.mimeType ? ` · ${media.mimeType}` : ""}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onRemoveReplyMedia(index)}
                      disabled={sending}
                      className="rounded-field border border-base-300 px-2 py-1 text-[0.7rem] text-base-content/60 transition-colors hover:border-error/30 hover:text-error disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      外す
                    </button>
                  </li>
                ))}
              </ul>
            )}
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
            disabled={sending || !canSend}
            className="inline-flex h-10 items-center gap-1.5 rounded-field bg-primary px-4 text-sm font-medium text-primary-content transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <PaperPlaneTilt size={14} weight="fill" />
            {sending ? "送信中" : "送信"}
          </button>
        </div>
        <p className="mt-1.5 text-[0.65rem] text-base-content/40">
          ⌘/Ctrl + Enter で送信 · 本文または添付があれば送れます ·
          返信は承認ポリシーに従って記録されます
        </p>
      </div>
    </div>
  );
}

function ConversationSummaryCards({
  thread,
  messages,
  context,
}: {
  thread: ConversationThread;
  messages: Message[];
  context: GetThreadResponse["data"]["context"] | null;
}) {
  const inboundCount = messages.filter((message) => message.direction === "inbound").length;
  const outboundCount = messages.length - inboundCount;

  return (
    <section className="mb-5 grid gap-3 md:grid-cols-3">
      <article className="rounded-box border border-base-300 bg-base-100 px-4 py-3">
        <p className="text-[0.65rem] font-medium uppercase tracking-[0.18em] text-base-content/45">
          What
        </p>
        <p className="mt-1 font-display text-sm font-semibold text-base-content">
          {humanizeEntryType(context?.entryType ?? thread.providerMetadata?.x?.entryType)}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-base-content/60">
          {humanizeChannel(thread.channel)} / {humanizeInitiator(thread.initiatedBy)}
        </p>
      </article>

      <article className="rounded-box border border-base-300 bg-base-100 px-4 py-3">
        <p className="text-[0.65rem] font-medium uppercase tracking-[0.18em] text-base-content/45">
          How
        </p>
        <p className="mt-1 font-display text-sm font-semibold text-base-content">
          {humanizeThreadStatus(thread.status)}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-base-content/60">
          受信 {inboundCount}件 / 送信 {outboundCount}件 / 最終更新{" "}
          {formatDateTime(thread.lastMessageAt)}
        </p>
      </article>

      <article className="rounded-box border border-base-300 bg-base-100 px-4 py-3">
        <p className="text-[0.65rem] font-medium uppercase tracking-[0.18em] text-base-content/45">
          Why
        </p>
        <p className="mt-1 font-display text-sm font-semibold text-base-content">
          今どの会話に対応しているか
        </p>
        <p className="mt-1 text-xs leading-relaxed text-base-content/60">
          {thread.participantName ?? "相手不明"} との会話です。
          {context?.relatedPosts?.length
            ? ` 自社投稿 ${context.relatedPosts.length} 件と関連づいています。`
            : " まだひもづく自社投稿は見つかっていません。"}
        </p>
      </article>

      <article className="rounded-box border border-base-300 bg-base-100 px-4 py-3 md:col-span-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-display text-sm font-semibold text-base-content">関連投稿</p>
          {context?.conversationId && (
            <span className="rounded-full bg-base-200 px-2 py-0.5 text-[0.65rem] text-base-content/55">
              会話ID {context.conversationId}
            </span>
          )}
        </div>

        {context?.relatedPosts?.length ? (
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {context.relatedPosts.map((post) => (
              <article
                key={post.id}
                className="rounded-field border border-base-300 bg-base-100/80 px-3 py-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs text-base-content/45">
                      {post.platformPostId ?? "外部投稿ID未設定"}
                    </p>
                    <p className="mt-1 text-sm leading-relaxed text-base-content">
                      {truncateText(post.contentText, 88)}
                    </p>
                  </div>
                  <StatusBadge status={post.status} />
                </div>
                <p className="mt-2 text-[0.7rem] text-base-content/45">
                  公開 {formatDateTime(post.publishedAt)} / 作成 {formatDateTime(post.createdAt)}
                </p>
              </article>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-xs leading-relaxed text-base-content/55">
            自社の投稿データとまだ一致していないため、外部会話だけを表示しています。
          </p>
        )}
      </article>
    </section>
  );
}

function ReplyNoticeBanner({ notice }: { notice: ReplyNotice | null }) {
  if (!notice) return null;

  const classes =
    notice.kind === "sent"
      ? "border-primary/30 bg-primary/5 text-primary"
      : notice.kind === "pending"
        ? "border-warning/30 bg-warning/10 text-warning-content"
        : "border-error/30 bg-error/5 text-error";

  return (
    <div className={["mb-3 rounded-field border px-3 py-2 text-xs", classes].join(" ")}>
      <p className="font-medium">{notice.message}</p>
      {notice.kind === "pending" && (
        <p className="mt-1 leading-relaxed">
          承認ID: {notice.approvalId}
          {notice.contentText ? ` / 返信案: ${truncateText(notice.contentText, 72)}` : ""}
          {notice.mediaCount && notice.mediaCount > 0 ? ` / 添付: ${notice.mediaCount}件` : ""}
        </p>
      )}
    </div>
  );
}

// ───────────────────────────────────────────
// MessageBubble
// ───────────────────────────────────────────
function MessageBubble({ message }: { message: Message }) {
  const isOutbound = message.direction === "outbound";
  const authorLabel = isOutbound
    ? (message.authorDisplayName ?? "自社アカウント")
    : (message.authorDisplayName ?? "相手");
  const entryLabel = humanizeEntryType(message.providerMetadata?.x?.entryType);
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
        <div className="mb-1 flex items-center gap-2 text-[0.65rem] uppercase tracking-[0.14em]">
          <span className={isOutbound ? "text-primary/80" : "text-base-content/45"}>
            {authorLabel}
          </span>
          <span className={isOutbound ? "text-primary/55" : "text-base-content/35"}>
            {entryLabel}
          </span>
        </div>
        {message.contentText ? (
          <p className="whitespace-pre-wrap break-words leading-relaxed">{message.contentText}</p>
        ) : (
          <p className="italic text-base-content/50">(メディアのみ)</p>
        )}
        {message.contentMedia && message.contentMedia.length > 0 && (
          <ul className="mt-2 space-y-1.5">
            {message.contentMedia.map((media, index) => (
              <li
                key={`${media.url}-${index}`}
                className="flex items-center gap-2 rounded-field border border-base-300/80 bg-base-100/70 px-2.5 py-2 text-xs"
              >
                {media.type === "video" ? (
                  <FilmSlate size={14} weight="bold" className="text-base-content/45" />
                ) : (
                  <ImageIcon size={14} weight="bold" className="text-base-content/45" />
                )}
                <a
                  href={media.url}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate text-base-content/70 underline decoration-base-300 underline-offset-2"
                >
                  {media.type === "video" ? "動画を開く" : "画像を開く"}
                </a>
              </li>
            ))}
          </ul>
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
