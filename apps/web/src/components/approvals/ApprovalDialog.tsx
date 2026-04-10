"use client";

/**
 * 承認ダイアログ。対象の詳細（操作種別、リクエスト者、投稿内容プレビュー）を表示し、
 * Approve / Reject の二択を提供する。Native <dialog> を使う。
 */
import { useEffect, useRef, useState } from "react";
import { X, User, Robot } from "@phosphor-icons/react";
import { ApprovalStamp } from "./ApprovalStamp";
import type { ApprovalRequestDto } from "./types";

interface PostPreview {
  id: string;
  platform: string;
  contentText: string | null;
  mediaCount: number;
  status: string;
}

interface Props {
  request: ApprovalRequestDto | null;
  open: boolean;
  onClose: () => void;
  onApprove: (req: ApprovalRequestDto) => Promise<boolean>;
  onReject: (req: ApprovalRequestDto, reason?: string) => Promise<boolean>;
}

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

async function fetchPostPreview(id: string): Promise<PostPreview | null> {
  try {
    const res = await fetch(`${API_BASE}/api/posts/${id}`, { credentials: "include" });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      data: {
        id: string;
        platform: string;
        contentText: string | null;
        contentMedia: unknown[] | null;
        status: string;
      };
    };
    return {
      id: json.data.id,
      platform: json.data.platform,
      contentText: json.data.contentText,
      mediaCount: Array.isArray(json.data.contentMedia) ? json.data.contentMedia.length : 0,
      status: json.data.status,
    };
  } catch {
    return null;
  }
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function labelForResource(resourceType: string): string {
  switch (resourceType) {
    case "post":
      return "Publish post";
    case "post_delete":
      return "Delete post";
    case "line_broadcast":
      return "LINE broadcast";
    case "budget_exceed":
      return "Continue over budget";
    default:
      return resourceType;
  }
}

export function ApprovalDialog({ request, open, onClose, onApprove, onReject }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [preview, setPreview] = useState<PostPreview | null>(null);
  const [stampState, setStampState] = useState<"idle" | "approved" | "rejected">("idle");
  const [submitting, setSubmitting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [mode, setMode] = useState<"view" | "reject-form">("view");

  // dialog open / close 制御
  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (open && !dlg.open) {
      dlg.showModal();
      setStampState("idle");
      setMode("view");
      setRejectReason("");
    } else if (!open && dlg.open) {
      dlg.close();
    }
  }, [open]);

  // 投稿プレビュー取得（resourceType === "post" のみ）
  useEffect(() => {
    setPreview(null);
    if (!request || request.resourceType !== "post") return;
    let cancelled = false;
    void fetchPostPreview(request.resourceId).then((p) => {
      if (!cancelled) setPreview(p);
    });
    return () => {
      cancelled = true;
    };
  }, [request]);

  if (!request) {
    return (
      <dialog
        ref={dialogRef}
        className="modal bg-base-content/40 backdrop-blur-sm"
        onClose={onClose}
      />
    );
  }

  const isAgent =
    request.requestedBy.startsWith("agent_") || request.requestedBy.includes(":agent");
  const requestedDate = new Date(request.requestedAt);

  const handleApprove = async () => {
    setSubmitting(true);
    setStampState("approved");
    const ok = await onApprove(request);
    setSubmitting(false);
    if (ok) {
      window.setTimeout(() => onClose(), 700);
    } else {
      setStampState("idle");
    }
  };

  const handleReject = async () => {
    setSubmitting(true);
    setStampState("rejected");
    const ok = await onReject(request, rejectReason || undefined);
    setSubmitting(false);
    if (ok) {
      window.setTimeout(() => onClose(), 700);
    } else {
      setStampState("idle");
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="modal bg-base-content/40 backdrop-blur-sm"
      onClose={onClose}
      aria-labelledby="approval-dialog-title"
    >
      <div className="modal-box surface-grain max-w-2xl border-t-4 border-b-4 border-double border-base-300 bg-base-100 p-0">
        {/* Close */}
        <form method="dialog" className="absolute right-3 top-3">
          <button className="btn btn-ghost btn-sm btn-circle" aria-label="閉じる">
            <X size={16} />
          </button>
        </form>

        {/* Header */}
        <div className="px-8 pb-4 pt-8">
          <p className="font-display text-[11px] uppercase tracking-[0.22em] text-base-content/50">
            Writ of Approval
          </p>
          <h2
            id="approval-dialog-title"
            className="mt-1 font-display text-3xl font-semibold italic leading-tight text-base-content"
          >
            № {shortId(request.id)}
          </h2>
          <p className="mt-2 text-xs text-base-content/60">
            Filed{" "}
            {requestedDate.toLocaleString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        </div>

        <div className="mx-8 border-t border-dashed border-base-300" />

        {/* Body */}
        <div className="grid grid-cols-[1fr_auto] gap-6 px-8 py-6">
          <div className="space-y-5">
            {/* Subject */}
            <dl className="space-y-3">
              <div>
                <dt className="font-sans text-[10px] font-semibold uppercase tracking-[0.2em] text-base-content/50">
                  Subject
                </dt>
                <dd className="mt-1 font-display text-xl font-semibold text-base-content">
                  {labelForResource(request.resourceType)}
                </dd>
              </div>

              <div>
                <dt className="font-sans text-[10px] font-semibold uppercase tracking-[0.2em] text-base-content/50">
                  Requested by
                </dt>
                <dd className="mt-1 flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full border border-base-300 text-base-content/70">
                    {isAgent ? (
                      <Robot size={13} weight="duotone" className="text-accent" />
                    ) : (
                      <User size={13} weight="duotone" />
                    )}
                  </span>
                  <code className="font-sans text-sm text-base-content">{request.requestedBy}</code>
                  {isAgent ? (
                    <span className="badge badge-ghost badge-xs font-display italic">agent</span>
                  ) : null}
                </dd>
              </div>

              {request.reason ? (
                <div>
                  <dt className="font-sans text-[10px] font-semibold uppercase tracking-[0.2em] text-base-content/50">
                    Reason stated
                  </dt>
                  <dd className="mt-1 border-l-2 border-base-300 pl-3 font-display text-sm italic text-base-content/80">
                    &ldquo;{request.reason}&rdquo;
                  </dd>
                </div>
              ) : null}

              {preview ? (
                <div>
                  <dt className="font-sans text-[10px] font-semibold uppercase tracking-[0.2em] text-base-content/50">
                    Resource · {preview.platform}
                  </dt>
                  <dd className="mt-1 rounded-sm border border-dashed border-base-300 bg-base-200/40 px-3 py-2">
                    {preview.contentText ? (
                      <p className="whitespace-pre-wrap font-sans text-sm text-base-content">
                        {preview.contentText}
                      </p>
                    ) : (
                      <p className="text-sm italic text-base-content/50">(no text content)</p>
                    )}
                    {preview.mediaCount > 0 ? (
                      <p className="mt-1 text-[11px] text-base-content/50">
                        + {preview.mediaCount} media attachment
                        {preview.mediaCount > 1 ? "s" : ""}
                      </p>
                    ) : null}
                  </dd>
                </div>
              ) : request.resourceType === "post" ? (
                <p className="text-xs italic text-base-content/40">Loading resource…</p>
              ) : null}
            </dl>
          </div>

          {/* Stamp */}
          <div className="flex items-start justify-end">
            <ApprovalStamp state={stampState} />
          </div>
        </div>

        {/* Reject form */}
        {mode === "reject-form" ? (
          <div className="mx-8 mb-4 rounded-sm border border-dashed border-error/40 bg-error/5 px-4 py-3">
            <label className="block font-sans text-[10px] font-semibold uppercase tracking-[0.2em] text-error">
              Reason for rejection
            </label>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={2}
              placeholder="Provide context for the requester (optional)…"
              className="textarea textarea-bordered mt-2 w-full resize-none font-sans text-sm"
              disabled={submitting}
            />
          </div>
        ) : null}

        {/* Footer actions */}
        <div className="flex items-center justify-between gap-3 border-t border-dashed border-base-300 bg-base-200/40 px-8 py-4">
          <p className="font-display text-[11px] italic text-base-content/50">
            Your seal is final and will be written to the audit ledger.
          </p>
          <div className="flex gap-2">
            {mode === "view" ? (
              <>
                <button
                  type="button"
                  onClick={() => setMode("reject-form")}
                  disabled={submitting}
                  className="btn btn-outline btn-error btn-sm"
                >
                  Reject
                </button>
                <button
                  type="button"
                  onClick={handleApprove}
                  disabled={submitting}
                  className="btn btn-primary btn-sm"
                  autoFocus
                >
                  Approve & Execute
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
                  Back
                </button>
                <button
                  type="button"
                  onClick={handleReject}
                  disabled={submitting}
                  className="btn btn-error btn-sm"
                >
                  Confirm rejection
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* backdrop click closes */}
      <form method="dialog" className="modal-backdrop">
        <button aria-label="閉じる">close</button>
      </form>
    </dialog>
  );
}
