/**
 * ScheduleDetailModal
 *
 * Task 3007: 予約カレンダーの予約詳細モーダル
 *
 * - 情報表示: 投稿テキスト冒頭、SNS、アカウント、予約日時、ステータス
 * - アクション: 日時変更 (PATCH)、キャンセル (DELETE)、投稿詳細へのリンク
 *
 * Native <dialog> ベースの DaisyUI modal。
 * 既存の ApprovalDialog のエディトリアル質感に合わせ、
 * Fraunces 見出し + 細罫線 + 落ち着いたコントラストで構成する。
 */
"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  X,
  CalendarBlank,
  ArrowSquareOut,
  Trash,
  PencilSimpleLine,
  WarningCircle,
  CheckCircle,
  Clock,
} from "@phosphor-icons/react";
import { PlatformIcon, PLATFORM_VISUALS } from "@/components/settings/PlatformIcon";
import { getStatusStyle } from "./statusStyles";
import { formatDateTimeJa, toDatetimeLocalValue } from "./dateUtils";
import type { CalendarEntry } from "./types";

interface Props {
  entry: CalendarEntry | null;
  open: boolean;
  onClose: () => void;
  onReschedule: (entry: CalendarEntry, nextScheduledAt: Date) => Promise<boolean>;
  onCancel: (entry: CalendarEntry) => Promise<boolean>;
}

type Mode = "view" | "reschedule" | "confirm-cancel";

const PHASE_ICON: Record<string, typeof WarningCircle> = {
  queued: Clock,
  running: Clock,
  done: CheckCircle,
  fail: WarningCircle,
  retry: WarningCircle,
};

export function ScheduleDetailModal({ entry, open, onClose, onReschedule, onCancel }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<Mode>("view");
  const [draftDatetime, setDraftDatetime] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // open / close 制御
  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (open && !dlg.open) {
      dlg.showModal();
      setMode("view");
      setError(null);
      if (entry) {
        setDraftDatetime(toDatetimeLocalValue(new Date(entry.job.scheduledAt)));
      }
    } else if (!open && dlg.open) {
      dlg.close();
    }
  }, [open, entry]);

  if (!entry) {
    return (
      <dialog
        ref={dialogRef}
        className="modal bg-base-content/40 backdrop-blur-sm"
        onClose={onClose}
      />
    );
  }

  const { job, post } = entry;
  const scheduledAt = new Date(job.scheduledAt);
  const status = getStatusStyle(job.status);
  const PhaseIcon = PHASE_ICON[status.phase] ?? Clock;
  const platformLabel = post ? (PLATFORM_VISUALS[post.platform]?.label ?? post.platform) : "—";

  // 投稿テキスト冒頭（最大 160 文字）
  const bodyPreview = (post?.contentText ?? "").trim();
  const bodySnippet =
    bodyPreview.length > 160 ? `${bodyPreview.slice(0, 160)}…` : bodyPreview || "(本文なし)";

  const handleReschedule = async () => {
    if (!draftDatetime) {
      setError("日時を指定してください");
      return;
    }
    const next = new Date(draftDatetime);
    if (Number.isNaN(next.getTime())) {
      setError("日時の形式が正しくありません");
      return;
    }
    setSubmitting(true);
    setError(null);
    const ok = await onReschedule(entry, next);
    setSubmitting(false);
    if (ok) {
      onClose();
    } else {
      setError("日時の変更に失敗しました");
    }
  };

  const handleCancel = async () => {
    setSubmitting(true);
    setError(null);
    const ok = await onCancel(entry);
    setSubmitting(false);
    if (ok) {
      onClose();
    } else {
      setError("キャンセルに失敗しました");
    }
  };

  const canMutate = job.status === "pending" || job.status === "retrying";

  return (
    <dialog
      ref={dialogRef}
      className="modal bg-base-content/40 backdrop-blur-sm"
      onClose={onClose}
      aria-labelledby="schedule-detail-title"
    >
      <div className="modal-box surface-grain max-w-xl border-t-4 border-b-4 border-double border-base-300 bg-base-100 p-0">
        {/* Close */}
        <form method="dialog" className="absolute right-3 top-3 z-10">
          <button className="btn btn-ghost btn-sm btn-circle" aria-label="閉じる">
            <X size={16} />
          </button>
        </form>

        {/* Header */}
        <div className="px-8 pb-4 pt-8">
          <p className="font-display text-[11px] uppercase tracking-[0.22em] text-base-content/50">
            Scheduled · 予約詳細
          </p>
          <h2
            id="schedule-detail-title"
            className="mt-1 font-display text-3xl font-semibold italic leading-tight text-base-content"
          >
            {formatDateTimeJa(scheduledAt)}
          </h2>
          <div className="mt-3 flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[0.7rem] font-medium uppercase tracking-wide ${status.chipClass}`}
            >
              <PhaseIcon size={12} weight="fill" />
              {status.label}
            </span>
            {job.attemptCount > 0 ? (
              <span className="text-[0.7rem] text-base-content/50">
                試行 {job.attemptCount}/{job.maxAttempts}
              </span>
            ) : null}
          </div>
        </div>

        <div className="mx-8 border-t border-dashed border-base-300" />

        {/* Body */}
        <div className="px-8 py-6">
          <dl className="space-y-4">
            {/* SNS / アカウント */}
            <div className="flex items-start gap-3">
              {post ? (
                <PlatformIcon platform={post.platform} size={36} />
              ) : (
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-sm border border-base-300 bg-base-200 text-base-content/30">
                  ?
                </span>
              )}
              <div className="min-w-0 flex-1">
                <dt className="font-sans text-[10px] font-semibold uppercase tracking-[0.18em] text-base-content/50">
                  Platform
                </dt>
                <dd className="mt-0.5 font-display text-base font-semibold text-base-content">
                  {platformLabel}
                </dd>
                {post ? (
                  <p className="mt-0.5 text-xs text-base-content/50">
                    Account · <code className="font-sans">{post.socialAccountId}</code>
                  </p>
                ) : (
                  <p className="mt-0.5 text-xs italic text-base-content/40">
                    投稿情報を取得できませんでした
                  </p>
                )}
              </div>
            </div>

            {/* 本文プレビュー */}
            <div>
              <dt className="font-sans text-[10px] font-semibold uppercase tracking-[0.18em] text-base-content/50">
                Content
              </dt>
              <dd className="mt-1.5 rounded-sm border border-dashed border-base-300 bg-base-200/40 px-4 py-3 font-sans text-sm leading-relaxed text-base-content">
                {bodyPreview ? (
                  <p className="whitespace-pre-wrap">{bodySnippet}</p>
                ) : (
                  <p className="italic text-base-content/40">{bodySnippet}</p>
                )}
              </dd>
            </div>

            {/* 予約日時 (view mode) */}
            {mode === "view" ? (
              <div>
                <dt className="font-sans text-[10px] font-semibold uppercase tracking-[0.18em] text-base-content/50">
                  Scheduled at
                </dt>
                <dd className="mt-1 flex items-center gap-2 text-base-content">
                  <CalendarBlank size={14} className="text-base-content/50" weight="duotone" />
                  <span className="font-display text-sm italic">
                    {formatDateTimeJa(scheduledAt)}
                  </span>
                </dd>
                {job.lastError ? (
                  <p className="mt-2 rounded-sm border border-error/30 bg-error/5 px-3 py-2 text-[0.7rem] text-error">
                    直近のエラー: {job.lastError}
                  </p>
                ) : null}
              </div>
            ) : null}

            {/* 予約日時 (reschedule mode) */}
            {mode === "reschedule" ? (
              <div>
                <dt className="font-sans text-[10px] font-semibold uppercase tracking-[0.18em] text-base-content/50">
                  New schedule
                </dt>
                <dd className="mt-1.5">
                  <input
                    type="datetime-local"
                    value={draftDatetime}
                    onChange={(e) => setDraftDatetime(e.target.value)}
                    disabled={submitting}
                    className="input input-bordered w-full font-sans text-sm"
                  />
                </dd>
              </div>
            ) : null}

            {/* キャンセル確認 */}
            {mode === "confirm-cancel" ? (
              <div className="rounded-sm border border-dashed border-error/40 bg-error/5 px-4 py-3">
                <p className="font-display text-sm font-semibold italic text-error">
                  この予約をキャンセルしますか？
                </p>
                <p className="mt-1 text-xs text-base-content/60">
                  キャンセル後、この予約は実行されません。投稿自体は下書きとして残ります。
                </p>
              </div>
            ) : null}
          </dl>

          {error ? (
            <p className="mt-4 rounded-sm border border-error/30 bg-error/5 px-3 py-2 text-xs text-error">
              {error}
            </p>
          ) : null}
        </div>

        {/* Footer actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-dashed border-base-300 bg-base-200/40 px-8 py-4">
          {post ? (
            <Link
              href={`/posts/${post.id}`}
              className="inline-flex items-center gap-1.5 font-sans text-xs text-base-content/70 hover:text-base-content"
            >
              <ArrowSquareOut size={13} weight="bold" />
              投稿詳細へ
            </Link>
          ) : (
            <span />
          )}

          <div className="flex flex-wrap gap-2">
            {mode === "view" ? (
              <>
                <button
                  type="button"
                  onClick={() => setMode("confirm-cancel")}
                  disabled={submitting || !canMutate}
                  className="btn btn-outline btn-error btn-sm"
                  title={
                    canMutate ? "この予約をキャンセル" : "完了・実行中の予約はキャンセルできません"
                  }
                >
                  <Trash size={13} />
                  キャンセル
                </button>
                <button
                  type="button"
                  onClick={() => setMode("reschedule")}
                  disabled={submitting || !canMutate}
                  className="btn btn-primary btn-sm"
                  title={canMutate ? "予約日時を変更" : "完了・実行中の予約は変更できません"}
                >
                  <PencilSimpleLine size={13} />
                  日時変更
                </button>
              </>
            ) : mode === "reschedule" ? (
              <>
                <button
                  type="button"
                  onClick={() => setMode("view")}
                  disabled={submitting}
                  className="btn btn-ghost btn-sm"
                >
                  戻る
                </button>
                <button
                  type="button"
                  onClick={handleReschedule}
                  disabled={submitting}
                  className="btn btn-primary btn-sm"
                >
                  変更を保存
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setMode("view")}
                  disabled={submitting}
                  className="btn btn-ghost btn-sm"
                >
                  戻る
                </button>
                <button
                  type="button"
                  onClick={handleCancel}
                  disabled={submitting}
                  className="btn btn-error btn-sm"
                >
                  キャンセルを確定
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <form method="dialog" className="modal-backdrop">
        <button aria-label="閉じる">close</button>
      </form>
    </dialog>
  );
}
