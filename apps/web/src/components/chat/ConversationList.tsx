/**
 * Task 5004: ConversationList.
 *
 * The "File Cabinet" — the left pane of the chat page. Shows previous
 * conversations grouped by conversationId from GET /api/agent/history,
 * plus a "new dispatch" button to start a fresh conversation.
 *
 * Each row is rendered as a bound edition with a volume number, a
 * filed-at timestamp, and the last snippet. The active conversation
 * gets a primary rail and a subtle fill. Loading and offline states
 * each have their own distinctive tone.
 */

"use client";

import { Folders, NotePencil, Files, CircleNotch, RssSimple } from "@phosphor-icons/react";
import { SECTION_KICKERS } from "@/lib/i18n/labels";
import type { ConversationSummary } from "./api";

interface ConversationListProps {
  conversations: ConversationSummary[];
  activeId: string | null;
  loading: boolean;
  offline: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  /** Optional close handler on mobile after a tap. */
  onAfterSelect?: () => void;
}

function relativeDate(iso: string): string {
  try {
    const d = new Date(iso);
    const delta = Date.now() - d.getTime();
    const hour = 3_600_000;
    if (delta < hour) {
      const mins = Math.max(1, Math.round(delta / 60_000));
      return `${mins}分前`;
    }
    if (delta < 24 * hour) {
      const hours = Math.round(delta / hour);
      return `${hours}時間前`;
    }
    if (delta < 7 * 24 * hour) {
      const days = Math.round(delta / (24 * hour));
      return `${days}日前`;
    }
    return d.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" });
  } catch {
    return "—";
  }
}

function volumeRef(id: string, index: number): string {
  const clean =
    id
      .replace(/[^a-z0-9]/gi, "")
      .slice(-3)
      .toUpperCase() || "000";
  return `vol · ${String(index + 1).padStart(2, "0")} · ${clean}`;
}

export function ConversationList({
  conversations,
  activeId,
  loading,
  offline,
  onSelect,
  onNew,
  onAfterSelect,
}: ConversationListProps) {
  const handleSelect = (id: string) => {
    onSelect(id);
    onAfterSelect?.();
  };

  return (
    <aside className="flex h-full flex-col border-r border-base-content/15 bg-[oklch(97.5%_0.01_82)]">
      {/* Header */}
      <div className="border-b-2 border-base-content/75 px-4 pt-4 pb-3">
        <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-base-content/45">
          {SECTION_KICKERS.agents}
        </div>
        <h2
          className="mt-0.5 font-display text-[22px] font-semibold leading-tight text-base-content"
          style={{ fontFamily: "'Fraunces', serif", fontOpticalSizing: "auto" }}
        >
          Wire Archive
        </h2>
        <p
          className="mt-0.5 font-display text-xs italic text-base-content/55"
          style={{ fontFamily: "'Fraunces', serif", fontStyle: "italic" }}
        >
          過去のやり取りを時系列で確認できます
        </p>

        <button
          type="button"
          onClick={() => {
            onNew();
            onAfterSelect?.();
          }}
          className="wire-stamp mt-3 flex w-full items-center justify-center gap-1.5 rounded-sm border-2 border-base-content/80 bg-base-100 px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-base-content shadow-[2px_2px_0_0_rgba(17,17,17,0.18)] transition hover:-translate-y-[1px] hover:shadow-[2px_3px_0_0_rgba(17,17,17,0.25)] active:translate-y-[1px] active:shadow-none"
        >
          <NotePencil size={13} weight="bold" />
          新しいチャット
        </button>
      </div>

      {/* Wire-offline hint */}
      {offline && !loading && (
        <div className="mx-3 mt-3 flex items-start gap-2 rounded-sm border border-dashed border-warning/60 bg-warning/10 px-3 py-2 font-mono text-[9px] uppercase tracking-[0.18em] text-[#7a4b00]">
          <RssSimple size={11} weight="bold" className="mt-0.5 shrink-0" />
          <span>回線オフライン · デモ履歴を表示しています</span>
        </div>
      )}

      {/* Listing */}
      <div className="flex-1 overflow-y-auto px-2 py-3">
        {loading ? (
          <div className="flex items-center gap-2 px-3 py-6 font-mono text-[10px] uppercase tracking-[0.18em] text-base-content/45">
            <CircleNotch size={12} weight="bold" className="animate-spin" />
            履歴を読み込み中…
          </div>
        ) : conversations.length === 0 ? (
          <div className="px-3 py-8 text-center">
            <Folders size={24} weight="duotone" className="mx-auto text-base-content/35" />
            <p
              className="mt-2 font-display text-sm italic text-base-content/55"
              style={{ fontFamily: "'Fraunces', serif", fontStyle: "italic" }}
            >
              まだ会話はありません。
            </p>
            <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.18em] text-base-content/40">
              新しいチャットを開始すると、ここに履歴が表示されます
            </p>
          </div>
        ) : (
          <ul className="space-y-1.5">
            {conversations.map((c, i) => {
              const active = c.id === activeId;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => handleSelect(c.id)}
                    data-active={active}
                    className="group relative block w-full border border-base-content/15 bg-base-100 px-3 py-2.5 text-left transition hover:border-base-content/40 hover:bg-base-100 data-[active=true]:border-primary/70 data-[active=true]:bg-primary/5"
                    style={{ borderRadius: 2 }}
                  >
                    {active && (
                      <span
                        aria-hidden
                        className="absolute left-[-1px] top-2 bottom-2 w-[3px] bg-primary"
                      />
                    )}
                    <div className="flex items-baseline justify-between gap-2 font-mono text-[9px] uppercase tracking-[0.2em] text-base-content/50">
                      <span>{volumeRef(c.id, i)}</span>
                      <span className="tabular-nums">{relativeDate(c.lastActionAt)}</span>
                    </div>
                    <div
                      className="mt-1 line-clamp-2 font-display text-[14px] font-semibold leading-snug text-base-content group-data-[active=true]:text-primary"
                      style={{
                        fontFamily: "'Fraunces', serif",
                        fontOpticalSizing: "auto",
                      }}
                    >
                      {c.title || "（タイトル未設定）"}
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.18em] text-base-content/40">
                      <Files size={10} weight="bold" />
                      <span className="tabular-nums">{c.messageCount} 件</span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Footer colophon */}
      <div className="border-t border-dashed border-base-content/20 px-4 py-2 font-mono text-[8px] uppercase tracking-[0.22em] text-base-content/40">
        <div className="flex items-center justify-between">
          <span>archive · agent wire</span>
          <span className="tabular-nums">
            {conversations.length.toString().padStart(2, "0")} bound
          </span>
        </div>
      </div>
    </aside>
  );
}
