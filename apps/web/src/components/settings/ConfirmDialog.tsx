/**
 * ConfirmDialog - receipt 風の確認モーダル
 *
 * 破壊的操作（アカウント切断など）の確認に使う。
 * audit 画面の DetailModal と同じモーダルの枠組みに合わせる。
 */
"use client";

import { useEffect } from "react";
import { X, WarningCircle } from "@phosphor-icons/react";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  /** 確認タイプ: destructive は error 色、normal は primary 色 */
  tone?: "destructive" | "normal";
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}

export function ConfirmDialog({
  open,
  title,
  description,
  tone = "destructive",
  confirmLabel = "実行",
  cancelLabel = "キャンセル",
  onConfirm,
  onCancel,
  loading = false,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) onCancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, loading, onCancel]);

  if (!open) return null;

  const accentClass =
    tone === "destructive"
      ? "border-error/40 bg-error/10 text-error"
      : "border-primary/40 bg-primary/10 text-primary";
  const buttonClass =
    tone === "destructive"
      ? "bg-error text-error-content hover:bg-error/90"
      : "bg-primary text-primary-content hover:bg-primary/90";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        type="button"
        onClick={onCancel}
        disabled={loading}
        className="absolute inset-0 bg-secondary/60 backdrop-blur-sm"
        aria-label="閉じる"
      />

      <div
        className="relative w-full max-w-md overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-2xl"
        style={{ animation: "dialogIn 0.25s cubic-bezier(0.16, 1, 0.3, 1)" }}
      >
        <div className="relative border-b-2 border-dashed border-base-300 bg-gradient-to-b from-base-200/60 to-base-100 px-6 pb-5 pt-5">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="btn btn-sm btn-circle btn-ghost absolute right-3 top-3"
            aria-label="閉じる"
          >
            <X size={16} weight="bold" />
          </button>
          <div className="flex items-start gap-3 pr-10">
            <span
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border ${accentClass}`}
            >
              <WarningCircle size={18} weight="bold" />
            </span>
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-base-content/50">
                confirm action
              </div>
              <h2
                className="mt-1 font-display text-xl font-semibold leading-tight text-base-content"
                style={{ fontFamily: "'Fraunces', serif" }}
              >
                {title}
              </h2>
            </div>
          </div>
        </div>

        <div className="px-6 py-5">
          {description && (
            <p className="text-sm leading-relaxed text-base-content/70">{description}</p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-base-300 bg-base-200/40 px-6 py-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="btn btn-sm rounded-sm border-base-300 bg-base-100 font-mono text-xs uppercase tracking-wider hover:border-base-content/40"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={`btn btn-sm rounded-sm border-none font-mono text-xs uppercase tracking-wider ${buttonClass}`}
          >
            {loading ? "..." : confirmLabel}
          </button>
        </div>

        <style>{`
          @keyframes dialogIn {
            from {
              opacity: 0;
              transform: translateY(8px) scale(0.98);
            }
            to {
              opacity: 1;
              transform: translateY(0) scale(1);
            }
          }
        `}</style>
      </div>
    </div>
  );
}
