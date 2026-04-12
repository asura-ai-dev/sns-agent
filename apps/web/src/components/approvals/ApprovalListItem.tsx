"use client";

/**
 * 承認待ち 1 件分の紙片 item（dropdown 内で使用）。
 */
import { User, Robot, Check, X } from "@phosphor-icons/react";
import type { ApprovalRequestDto } from "./types";

interface Props {
  request: ApprovalRequestDto;
  index: number;
  onApprove: (req: ApprovalRequestDto) => void;
  onReject: (req: ApprovalRequestDto) => void;
  onOpenDetail: (req: ApprovalRequestDto) => void;
}

function formatMonthDay(iso: string): { month: string; day: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { month: "—", day: "—" };
  const month = d.toLocaleString("en-US", { month: "short" }).toUpperCase();
  const day = d.getDate().toString().padStart(2, "0");
  return { month, day };
}

function formatActor(actorId: string): { label: string; isAgent: boolean } {
  // 簡易判定: id prefix で推定（本番は /api/users/:id の metadata を使う）
  const isAgent = actorId.startsWith("agent_") || actorId.includes(":agent");
  const short = actorId.length > 18 ? `${actorId.slice(0, 8)}…${actorId.slice(-4)}` : actorId;
  return { label: short, isAgent };
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

export function ApprovalListItem({ request, index, onApprove, onReject, onOpenDetail }: Props) {
  const { month, day } = formatMonthDay(request.requestedAt);
  const { label: actorLabel, isAgent } = formatActor(request.requestedBy);

  return (
    <article
      className="approval-item grid grid-cols-[auto_1fr] gap-3 border-b border-dashed border-base-300 px-4 py-3 last:border-b-0"
      style={{ animationDelay: `${index * 50}ms` }}
      role="menuitem"
    >
      {/* Date stub */}
      <button
        type="button"
        onClick={() => onOpenDetail(request)}
        className="flex h-14 w-12 flex-col items-center justify-center rounded-sm border border-dashed border-base-300 bg-base-200/60 font-display leading-none text-base-content/80 hover:border-primary/60 hover:text-primary"
        aria-label={`詳細を開く: ${labelForResource(request.resourceType)}`}
      >
        <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-base-content/50">
          {month}
        </span>
        <span className="mt-0.5 text-lg font-semibold tabular-nums">{day}</span>
      </button>

      {/* Body */}
      <div className="min-w-0">
        <button
          type="button"
          onClick={() => onOpenDetail(request)}
          className="block w-full text-left"
        >
          <h4 className="truncate font-sans text-sm font-medium text-base-content">
            {labelForResource(request.resourceType)}
          </h4>
          <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-base-content/60">
            {isAgent ? (
              <Robot size={11} weight="duotone" className="text-accent" />
            ) : (
              <User size={11} weight="duotone" />
            )}
            <span className="truncate">by {actorLabel}</span>
          </p>
          {request.reason ? (
            <p className="mt-1 truncate font-display text-xs italic text-base-content/70">
              &ldquo;{request.reason}&rdquo;
            </p>
          ) : null}
        </button>

        {/* Action row */}
        <div className="mt-2 flex items-center gap-3 text-[11px]">
          <button
            type="button"
            onClick={() => onApprove(request)}
            className="inline-flex items-center gap-1 font-medium text-primary underline decoration-dashed decoration-primary/40 underline-offset-4 hover:decoration-primary"
          >
            <Check size={11} weight="bold" /> Approve
          </button>
          <span className="text-base-content/20">|</span>
          <button
            type="button"
            onClick={() => onReject(request)}
            className="inline-flex items-center gap-1 font-medium text-error underline decoration-dashed decoration-error/40 underline-offset-4 hover:decoration-error"
          >
            <X size={11} weight="bold" /> Reject
          </button>
        </div>
      </div>

      <style>{`
        .approval-item {
          opacity: 0;
          transform: translateY(4px);
          animation: itemIn 260ms ease-out forwards;
        }
        @keyframes itemIn {
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .approval-item {
            animation: none;
            opacity: 1;
            transform: none;
          }
        }
      `}</style>
    </article>
  );
}
