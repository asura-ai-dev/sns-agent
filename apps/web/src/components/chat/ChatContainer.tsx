/**
 * Task 5004: ChatContainer.
 *
 * The right pane — the active wire desk. Hosts:
 *   - a masthead strip with the current edition № and a wire-offline badge
 *   - the scrolling dispatch column (MessageBubble list, TypingSlip,
 *     ActionPreview card)
 *   - the ChatInput ruled textarea
 *
 * Streaming state is managed here: `streamChatMessage` from ./api is
 * driven on form submit, mutating the last AI message in place as tokens
 * arrive. When the API returns a skill preview, an ActionPreview is
 * appended that can execute / cancel via POST /api/agent/execute.
 */

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Broadcast, RssSimple, List, ArrowClockwise } from "@phosphor-icons/react";
import { ChatInput } from "./ChatInput";
import { MessageBubble, type ChatMessage } from "./MessageBubble";
import { ActionPreview } from "./ActionPreview";
import {
  executeSkillAction,
  streamChatMessage,
  type ChatResponse,
  type ExecuteResponse,
  type SkillIntent,
  type SkillPreview,
} from "./api";

interface ChatContainerProps {
  conversationId: string | null;
  seedMessages?: ChatMessage[];
  /** Callback fired whenever a message or preview is added. Parent can
   * refresh conversation list if desired. */
  onConversationChanged?: (conversationId: string) => void;
  /** Mobile only — show a "back to file cabinet" button. */
  onOpenCabinet?: () => void;
  /** Shown in the masthead number slot. */
  editionNumber?: number;
}

interface PendingPreviewState {
  intent: SkillIntent;
  preview: SkillPreview;
  /** Messge id that this preview is anchored below. */
  anchorMessageId: string;
  settled: boolean;
}

const genId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export function ChatContainer({
  conversationId,
  seedMessages,
  onConversationChanged,
  onOpenCabinet,
  editionNumber = 1,
}: ChatContainerProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(seedMessages ?? []);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(conversationId);
  const [pendingPreview, setPendingPreview] = useState<PendingPreviewState | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Reset transcript when conversationId changes from parent (e.g. user
  // picked a different archived edition).
  useEffect(() => {
    setMessages(seedMessages ?? []);
    setActiveConversationId(conversationId);
    setPendingPreview(null);
    setInput("");
  }, [conversationId, seedMessages]);

  // Auto-scroll on new content.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Defer so layout settles first.
    const id = window.requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => window.cancelAnimationFrame(id);
  }, [messages, pendingPreview]);

  const updateAiMessage = useCallback((id: string, patch: Partial<ChatMessage>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }, []);

  const handleSubmit = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;

    const userMsg: ChatMessage = {
      id: genId(),
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    };
    const aiId = genId();
    const aiMsg: ChatMessage = {
      id: aiId,
      role: "agent",
      content: "",
      createdAt: new Date().toISOString(),
      streaming: true,
    };

    setMessages((prev) => [...prev, userMsg, aiMsg]);
    setInput("");
    setBusy(true);
    setPendingPreview(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await streamChatMessage(
        {
          message: text,
          conversationId: activeConversationId,
          mode: "approval-required",
        },
        {
          onOpen: (cid) => {
            if (!activeConversationId) {
              setActiveConversationId(cid);
              onConversationChanged?.(cid);
            }
          },
          onToken: (token) => {
            setMessages((prev) =>
              prev.map((m) => (m.id === aiId ? { ...m, content: m.content + token } : m)),
            );
          },
          onError: (err) => {
            if (err.code === "FALLBACK") {
              setOffline(true);
            }
          },
          onComplete: (response: ChatResponse, opts) => {
            updateAiMessage(aiId, {
              streaming: false,
              fallback: opts.fallback,
            });
            if (response.kind === "preview") {
              setPendingPreview({
                intent: response.intent,
                preview: response.preview,
                anchorMessageId: aiId,
                settled: false,
              });
            }
          },
        },
        controller.signal,
      );
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }, [input, busy, activeConversationId, onConversationChanged, updateAiMessage]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    // Mark the tailing streaming message as finished.
    setMessages((prev) =>
      prev.map((m) =>
        m.streaming
          ? {
              ...m,
              streaming: false,
              content: m.content
                ? m.content + "\n\n[wire killed by operator]"
                : "[wire killed by operator]",
            }
          : m,
      ),
    );
    setBusy(false);
  }, []);

  const handleApprove = useCallback(async (): Promise<ExecuteResponse | null> => {
    if (!pendingPreview) return null;
    const res = await executeSkillAction({
      intent: pendingPreview.intent,
      conversationId: activeConversationId,
      mode: pendingPreview.preview.mode,
    });
    if (!res.ok) {
      throw new Error(res.error.message);
    }
    if (res.isFallback) {
      setOffline(true);
    }
    // Append an execution log system message.
    const summary =
      typeof (res.value.outcome.result as { message?: unknown })?.message === "string"
        ? String((res.value.outcome.result as { message: string }).message)
        : `${res.value.outcome.actionName} executed`;
    setMessages((prev) => [
      ...prev,
      {
        id: genId(),
        role: "system",
        content: `press log · ${summary}`,
        createdAt: new Date().toISOString(),
      },
    ]);
    setPendingPreview((p) => (p ? { ...p, settled: true } : null));
    return res.value;
  }, [pendingPreview, activeConversationId]);

  const handleCancelPreview = useCallback(() => {
    setPendingPreview(null);
    setMessages((prev) => [
      ...prev,
      {
        id: genId(),
        role: "system",
        content: "proof sheet killed by operator",
        createdAt: new Date().toISOString(),
      },
    ]);
  }, []);

  const hasContent = messages.length > 0 || pendingPreview;

  // Compose a flat render order: messages in sequence, with the pending
  // preview inserted after its anchor message.
  const rendered = useMemo(() => {
    const items: Array<
      | { kind: "message"; message: ChatMessage; index: number }
      | { kind: "preview"; state: PendingPreviewState }
    > = [];
    messages.forEach((m, index) => {
      items.push({ kind: "message", message: m, index });
      if (pendingPreview && pendingPreview.anchorMessageId === m.id) {
        items.push({ kind: "preview", state: pendingPreview });
      }
    });
    // If the preview has no anchor in the current list (edge case), append it.
    if (pendingPreview && !messages.some((m) => m.id === pendingPreview.anchorMessageId)) {
      items.push({ kind: "preview", state: pendingPreview });
    }
    return items;
  }, [messages, pendingPreview]);

  return (
    <section className="relative flex h-full min-h-0 flex-1 flex-col bg-base-100">
      {/* Masthead */}
      <header className="border-b-2 border-base-content/75 px-4 pt-3 pb-2 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          {onOpenCabinet && (
            <button
              type="button"
              onClick={onOpenCabinet}
              className="flex items-center gap-1.5 rounded-sm border border-base-content/40 bg-base-100 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.2em] text-base-content/70 transition hover:bg-base-200 lg:hidden"
            >
              <List size={12} weight="bold" />
              cabinet
            </button>
          )}

          <div className="flex-1">
            <div className="flex items-baseline justify-between gap-3">
              <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-base-content/45">
                section · active wire desk
              </div>
              <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-base-content/45">
                edition №{" "}
                <span className="tabular-nums">{String(editionNumber).padStart(2, "0")}</span>
              </div>
            </div>
            <h1
              className="mt-0.5 font-display text-[26px] font-semibold leading-tight text-base-content sm:text-[32px]"
              style={{
                fontFamily: "'Fraunces', serif",
                fontOpticalSizing: "auto",
              }}
            >
              The Wire Room
            </h1>
            <p
              className="mt-0.5 font-display text-sm italic text-base-content/60"
              style={{ fontFamily: "'Fraunces', serif", fontStyle: "italic" }}
            >
              a live dispatch exchange with the sns agent desk
            </p>
          </div>
        </div>

        {offline && (
          <div className="mt-3 flex items-start gap-2 rounded-sm border border-dashed border-warning/60 bg-warning/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[#7a4b00]">
            <RssSimple size={12} weight="bold" className="mt-0.5 shrink-0" />
            <span>wire offline · operating on local fallback transcript</span>
          </div>
        )}
      </header>

      {/* Dispatch column (scrolling) */}
      <div ref={scrollRef} className="relative flex-1 overflow-y-auto px-4 pb-4 sm:px-8">
        {/* Paper grain atmosphere */}
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 opacity-[0.025]"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
            backgroundSize: "160px 160px",
          }}
        />

        {!hasContent ? (
          <EmptyDesk />
        ) : (
          <div className="relative mx-auto max-w-[780px] pt-4">
            {rendered.map((item, i) => {
              if (item.kind === "message") {
                return <MessageBubble key={item.message.id} message={item.message} index={i + 1} />;
              }
              return (
                <ActionPreview
                  key={`preview-${item.state.anchorMessageId}`}
                  preview={item.state.preview}
                  settled={item.state.settled}
                  onApprove={handleApprove}
                  onCancel={handleCancelPreview}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Input */}
      <ChatInput
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        onStop={handleStop}
        disabled={false}
        busy={busy}
      />
    </section>
  );
}

function EmptyDesk() {
  return (
    <div className="mx-auto flex max-w-[560px] flex-col items-center pt-16 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border-2 border-base-content/75 bg-base-100 shadow-[3px_3px_0_0_rgba(17,17,17,0.15)]">
        <Broadcast size={26} weight="duotone" />
      </div>
      <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-base-content/45">
        the desk is quiet
      </div>
      <h2
        className="mt-1 font-display text-[28px] font-semibold leading-tight text-base-content"
        style={{ fontFamily: "'Fraunces', serif", fontOpticalSizing: "auto" }}
      >
        File your first dispatch.
      </h2>
      <p
        className="mt-2 font-display text-[15px] italic leading-snug text-base-content/65"
        style={{ fontFamily: "'Fraunces', serif", fontStyle: "italic" }}
      >
        Ask the agent to draft a post, summarise the week’s usage, or run a skill. A proof sheet
        will come back to stamp before anything is pressed.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-base-content/50">
        <Suggestion label="今日の X 投稿を下書き" />
        <Suggestion label="LINE 予約の状態" />
        <Suggestion label="instagram 週次使用量" />
      </div>
      <div className="mt-8 flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.2em] text-base-content/35">
        <ArrowClockwise size={11} weight="bold" />
        type below · enter to file
      </div>
    </div>
  );
}

function Suggestion({ label }: { label: string }) {
  return (
    <span
      className="rounded-sm border border-base-content/25 bg-base-100 px-2 py-1"
      style={{ borderRadius: 2 }}
    >
      {label}
    </span>
  );
}
