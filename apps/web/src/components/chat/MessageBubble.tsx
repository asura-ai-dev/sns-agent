/**
 * Task 5004: MessageBubble.
 *
 * Wire Room aesthetic: each chat message is rendered as a "telegram slip"
 * — a narrow card with a ruled border, a monospace metadata strip
 * (operator / filed-at / wire reference) and a Fraunces body.
 *
 * User messages sit flush right with a primary accent rule; AI messages
 * sit flush left with a neutral slate rule. A streaming AI message
 * swaps its body for a dot-ticker typing indicator that morphs into the
 * streamed content as tokens arrive.
 */

"use client";

import { PaperPlaneTilt, Broadcast, Warning } from "@phosphor-icons/react";

export type MessageRole = "user" | "agent" | "system";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  /** Fully rendered text. Streaming messages update this live. */
  content: string;
  /** ISO timestamp the message was filed. */
  createdAt: string;
  /** When true, the ticker shows and the border pulses. */
  streaming?: boolean;
  /** Attached execution outcome rendered under the slip. */
  executionNote?: string | null;
  /** True = this was produced by the offline fallback path. */
  fallback?: boolean;
}

interface MessageBubbleProps {
  message: ChatMessage;
  /** Monotonic sequence number within the conversation, for the slip header. */
  index: number;
}

function formatWireTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "--:--";
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  } catch {
    return "--:--";
  }
}

function wireRef(id: string, index: number): string {
  const clean =
    id
      .replace(/[^a-z0-9]/gi, "")
      .slice(-4)
      .toUpperCase() || "0000";
  return `WR-${String(index).padStart(3, "0")}-${clean}`;
}

export function MessageBubble({ message, index }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  if (isSystem) {
    return (
      <div className="my-3 flex justify-center">
        <div className="flex items-center gap-2 rounded-sm border border-dashed border-base-content/30 bg-base-200/40 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-base-content/55">
          <Warning size={11} weight="bold" />
          <span>{message.content}</span>
        </div>
      </div>
    );
  }

  const align = isUser ? "justify-end" : "justify-start";
  const slipTone = isUser ? "border-primary/70 bg-primary/5" : "border-neutral/40 bg-base-100";
  const accentRule = isUser ? "bg-primary" : "bg-neutral/70";
  const metaTone = isUser ? "text-primary/80" : "text-base-content/55";
  const bodyTone = isUser ? "text-base-content" : "text-base-content";
  const Icon = isUser ? PaperPlaneTilt : Broadcast;
  const operator = isUser ? "editor.desk" : "wire.agent";

  return (
    <div className={`my-3 flex ${align} animate-wire-slip-in`}>
      <article
        className={`relative max-w-[82%] shrink border bg-clip-padding px-4 pb-3 pt-2 shadow-[2px_2px_0_0_rgba(17,17,17,0.08)] ${slipTone} ${
          message.streaming ? "wire-slip-pulse" : ""
        }`}
        style={{ borderRadius: 2 }}
      >
        {/* Left accent rule (AI) or right accent rule (user) */}
        <span
          aria-hidden
          className={`absolute top-2 bottom-2 w-[3px] ${accentRule} ${
            isUser ? "right-[-3px]" : "left-[-3px]"
          }`}
        />

        {/* Metadata strip */}
        <header
          className={`flex items-center gap-2 border-b border-dashed border-base-content/15 pb-1.5 font-mono text-[9px] uppercase tracking-[0.2em] ${metaTone}`}
        >
          <Icon size={11} weight="bold" />
          <span className="font-semibold">{operator}</span>
          <span className="opacity-40">·</span>
          <span className="tabular-nums">{formatWireTime(message.createdAt)}</span>
          <span className="opacity-40">·</span>
          <span className="tabular-nums">{wireRef(message.id, index)}</span>
          {message.fallback && (
            <>
              <span className="opacity-40">·</span>
              <span className="text-warning">offline</span>
            </>
          )}
        </header>

        {/* Body */}
        <div
          className={`mt-2 whitespace-pre-wrap break-words font-display text-[15px] leading-[1.55] ${bodyTone}`}
          style={{ fontFamily: "'Fraunces', serif", fontOpticalSizing: "auto" }}
        >
          {message.content}
          {message.streaming && (
            <span
              aria-live="polite"
              aria-label="Streaming"
              className="ml-1 inline-flex items-baseline gap-[2px] align-baseline font-mono text-[12px] text-base-content/60"
            >
              <span className="wire-dot" />
              <span className="wire-dot" style={{ animationDelay: "0.15s" }} />
              <span className="wire-dot" style={{ animationDelay: "0.3s" }} />
            </span>
          )}
        </div>

        {/* Execution note (appears once a skill was executed) */}
        {message.executionNote && (
          <div className="mt-2 border-t border-dashed border-base-content/15 pt-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-base-content/55">
            press log · {message.executionNote}
          </div>
        )}
      </article>
    </div>
  );
}

/** Standalone typing-only slip rendered when a brand-new AI reply is inbound. */
export function TypingSlip() {
  return (
    <div className="my-3 flex justify-start">
      <div
        className="relative border border-neutral/40 bg-base-100 px-4 pb-3 pt-2 shadow-[2px_2px_0_0_rgba(17,17,17,0.08)]"
        style={{ borderRadius: 2 }}
      >
        <span aria-hidden className="absolute left-[-3px] top-2 bottom-2 w-[3px] bg-neutral/70" />
        <header className="flex items-center gap-2 border-b border-dashed border-base-content/15 pb-1.5 font-mono text-[9px] uppercase tracking-[0.2em] text-base-content/55">
          <Broadcast size={11} weight="bold" />
          <span className="font-semibold">wire.agent</span>
          <span className="opacity-40">·</span>
          <span>incoming</span>
        </header>
        <div className="mt-2 flex items-center gap-1 font-mono text-[13px] text-base-content/50">
          <span className="wire-dot" />
          <span className="wire-dot" style={{ animationDelay: "0.15s" }} />
          <span className="wire-dot" style={{ animationDelay: "0.3s" }} />
          <span className="ml-2 text-[10px] uppercase tracking-[0.2em]">teletype inbound</span>
        </div>
      </div>
    </div>
  );
}
