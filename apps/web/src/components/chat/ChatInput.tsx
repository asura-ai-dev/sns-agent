/**
 * Task 5004: ChatInput.
 *
 * "Copy desk" ruled textarea. Enter sends, Shift+Enter inserts a newline.
 * Auto-grows up to a reasonable cap. While the wire is busy (streaming
 * or executing) the submit stamp is disabled and the textarea shows a
 * faint "hold the press" hint instead of the caret placeholder.
 */

"use client";

import { useCallback, useEffect, useRef } from "react";
import { PaperPlaneRight, StopCircle } from "@phosphor-icons/react";

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop?: () => void;
  disabled?: boolean;
  busy?: boolean;
  placeholder?: string;
}

const MAX_HEIGHT_PX = 220;

export function ChatInput({
  value,
  onChange,
  onSubmit,
  onStop,
  disabled,
  busy,
  placeholder,
}: ChatInputProps) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  // Auto-grow: reset then set height to scrollHeight capped at MAX_HEIGHT_PX.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, MAX_HEIGHT_PX);
    el.style.height = `${next}px`;
  }, [value]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Shift+Enter -> newline. Enter alone -> submit.
      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        if (!disabled && !busy && value.trim().length > 0) {
          onSubmit();
        }
      }
    },
    [disabled, busy, value, onSubmit],
  );

  const charCount = value.length;
  const canSend = !disabled && !busy && value.trim().length > 0;

  return (
    <div className="border-t-2 border-base-content/75 bg-base-100">
      <div className="border-t border-base-content/25 pt-3">
        <div className="flex items-start gap-3 px-4 pb-3">
          {/* Line number gutter — a ledger-style margin. */}
          <div
            aria-hidden
            className="select-none pt-[10px] font-mono text-[10px] uppercase tracking-[0.18em] text-base-content/40"
          >
            §<br />
            copy
            <br />
            desk
          </div>

          {/* Ruled textarea container */}
          <div className="relative flex-1">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 rounded-sm"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(to bottom, transparent 0, transparent 25px, rgba(17,17,17,0.06) 25px, rgba(17,17,17,0.06) 26px)",
              }}
            />
            <textarea
              ref={ref}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={2}
              disabled={disabled}
              placeholder={
                placeholder ??
                (busy
                  ? "hold the press — wire busy..."
                  : "file your dispatch… (Enter = send · Shift+Enter = newline)")
              }
              className="relative block w-full resize-none rounded-sm border border-base-content/20 bg-transparent px-3 py-2 font-display text-[15px] leading-[26px] text-base-content placeholder:text-base-content/35 focus:border-primary focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
              style={{
                fontFamily: "'Fraunces', serif",
                fontOpticalSizing: "auto",
                minHeight: 54,
                maxHeight: MAX_HEIGHT_PX,
              }}
            />
          </div>

          {/* Submit stamp */}
          <div className="flex flex-col items-end gap-1 pt-[2px]">
            {busy && onStop ? (
              <button
                type="button"
                onClick={onStop}
                className="group flex items-center gap-1.5 rounded-sm border-2 border-error/70 bg-error/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-error transition hover:bg-error/20"
              >
                <StopCircle size={13} weight="bold" />
                kill wire
              </button>
            ) : (
              <button
                type="button"
                onClick={() => canSend && onSubmit()}
                disabled={!canSend}
                className="wire-stamp group flex items-center gap-1.5 rounded-sm border-2 border-primary/80 bg-primary px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-primary-content shadow-[2px_2px_0_0_rgba(17,17,17,0.2)] transition hover:-translate-y-[1px] hover:shadow-[2px_3px_0_0_rgba(17,17,17,0.25)] active:translate-y-[1px] active:shadow-none disabled:cursor-not-allowed disabled:border-base-content/25 disabled:bg-base-200 disabled:text-base-content/40 disabled:shadow-none"
              >
                <PaperPlaneRight
                  size={13}
                  weight="fill"
                  className="transition group-hover:translate-x-[1px]"
                />
                file
              </button>
            )}

            <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-base-content/40 tabular-nums">
              {charCount} ch
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-dashed border-base-content/15 px-4 py-1 font-mono text-[9px] uppercase tracking-[0.2em] text-base-content/40">
          <span>enter — file dispatch</span>
          <span>shift + enter — new line</span>
          <span className="hidden sm:inline">esc — blur</span>
        </div>
      </div>
    </div>
  );
}
