"use client";

/**
 * Header ベルから展開する承認待ち通知ドロップダウン。
 * "Writ of Approval" 紙片メタファー。
 */
import { useEffect, useRef } from "react";
import { CaretRight, Stamp } from "@phosphor-icons/react";
import { ApprovalListItem } from "./ApprovalListItem";
import type { ApprovalRequestDto } from "./types";

interface Props {
  open: boolean;
  requests: ApprovalRequestDto[];
  pendingCount: number;
  loading: boolean;
  onClose: () => void;
  onApprove: (req: ApprovalRequestDto) => void;
  onReject: (req: ApprovalRequestDto) => void;
  onOpenDetail: (req: ApprovalRequestDto) => void;
}

export function NotificationDropdown({
  open,
  requests,
  pendingCount,
  loading,
  onClose,
  onApprove,
  onReject,
  onOpenDetail,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);

  // Outside click + Esc
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const visible = requests.slice(0, 5);
  const overflow = Math.max(0, pendingCount - visible.length);

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="承認待ち通知"
      className="notif-sheet surface-grain absolute right-0 top-12 z-50 w-[22rem] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-md border border-base-300 border-t-2 border-t-primary/70 bg-base-100"
    >
      {/* Header */}
      <div className="flex items-start justify-between px-4 pb-2 pt-4">
        <div>
          <h3 className="font-display text-2xl font-semibold italic leading-none text-base-content">
            Writ of Approval
          </h3>
          <p className="mt-1 font-display text-xs uppercase tracking-[0.18em] text-base-content/50">
            {pendingCount === 0 ? "all clear" : `${pendingCount} pending`}
          </p>
        </div>
        <div className="flex h-9 w-9 items-center justify-center rounded-full border border-dashed border-base-300 text-base-content/40">
          <Stamp size={18} weight="duotone" />
        </div>
      </div>

      <div className="mx-4 border-t border-dashed border-base-300" />

      {/* List */}
      {loading ? (
        <div className="px-4 py-8 text-center font-display text-sm italic text-base-content/50">
          Fetching writs…
        </div>
      ) : visible.length === 0 ? (
        <div className="px-4 py-10 text-center">
          <p className="font-display text-base italic text-base-content/60">
            No writs awaiting your seal.
          </p>
          <p className="mt-1 text-xs text-base-content/40">The bench is quiet.</p>
        </div>
      ) : (
        <div className="max-h-[26rem] overflow-y-auto">
          {visible.map((req, idx) => (
            <ApprovalListItem
              key={req.id}
              request={req}
              index={idx}
              onApprove={onApprove}
              onReject={onReject}
              onOpenDetail={onOpenDetail}
            />
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="border-t border-dashed border-base-300 px-4 py-2">
        {overflow > 0 ? (
          <p className="mb-1 text-[11px] text-base-content/50">+ {overflow} more not shown</p>
        ) : null}
        <a
          href="/settings/approvals"
          className="inline-flex items-center gap-1 font-sans text-xs font-medium text-base-content hover:text-primary"
        >
          View all approvals
          <CaretRight size={11} weight="bold" />
        </a>
      </div>

      <style>{`
        .notif-sheet {
          box-shadow:
            0 1px 0 rgba(0, 0, 0, 0.04),
            0 18px 42px -18px rgba(120, 80, 30, 0.24);
          animation: dropSheet 200ms cubic-bezier(0.2, 1, 0.2, 1) both;
        }
        @keyframes dropSheet {
          from {
            opacity: 0;
            transform: translateY(-6px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .notif-sheet {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}
