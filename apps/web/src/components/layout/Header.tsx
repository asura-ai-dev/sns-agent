"use client";

import { useState } from "react";
import { Bell, List, CaretDown } from "@phosphor-icons/react";
import { NotificationDropdown } from "../approvals/NotificationDropdown";
import { ApprovalDialog } from "../approvals/ApprovalDialog";
import { useApprovals } from "../approvals/useApprovals";
import type { ApprovalRequestDto } from "../approvals/types";

export function Header() {
  const { data, pendingCount, loading, approve, reject } = useApprovals();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [dialogRequest, setDialogRequest] = useState<ApprovalRequestDto | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const openDialog = (req: ApprovalRequestDto) => {
    setDialogRequest(req);
    setDialogOpen(true);
    setDropdownOpen(false);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    // Keep the request briefly so the close animation can reference it
    window.setTimeout(() => setDialogRequest(null), 200);
  };

  const handleApprove = async (req: ApprovalRequestDto): Promise<boolean> => {
    return approve(req.id);
  };

  const handleReject = async (req: ApprovalRequestDto, reason?: string): Promise<boolean> => {
    return reject(req.id, reason);
  };

  const badgeLabel = pendingCount > 0 ? `承認待ち ${pendingCount} 件` : "通知";

  return (
    <header className="surface-grain sticky top-0 z-20 flex h-16 items-center justify-between border-b border-base-300 bg-base-100 px-4 lg:px-6">
      {/* Left: hamburger (mobile) + workspace name */}
      <div className="flex items-center gap-3">
        {/* Hamburger -- only on mobile */}
        <label
          htmlFor="app-drawer"
          className="btn btn-ghost btn-sm btn-square lg:hidden"
          aria-label="メニューを開く"
        >
          <List size={22} />
        </label>

        <div className="flex items-center gap-2">
          <h1 className="text-sm font-semibold text-base-content">My Workspace</h1>
          <CaretDown size={14} className="text-base-content/50" />
        </div>
      </div>

      {/* Right: notifications + avatar */}
      <div className="flex items-center gap-2">
        {/* Notification bell + dropdown */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setDropdownOpen((v) => !v)}
            className="bell-btn btn btn-ghost btn-sm btn-square relative"
            aria-label={badgeLabel}
            aria-haspopup="menu"
            aria-expanded={dropdownOpen}
            data-pending={pendingCount > 0 ? "true" : "false"}
          >
            <Bell size={20} weight={pendingCount > 0 ? "duotone" : "regular"} />
            {pendingCount > 0 ? (
              <span
                className="absolute -right-0.5 -top-0.5 inline-flex min-w-[18px] items-center justify-center rounded-full bg-accent px-1 font-display text-[10px] font-semibold italic leading-none text-accent-content ring-2 ring-base-100"
                aria-live="polite"
              >
                {pendingCount > 99 ? "99+" : pendingCount}
              </span>
            ) : null}
          </button>

          <NotificationDropdown
            open={dropdownOpen}
            requests={data}
            pendingCount={pendingCount}
            loading={loading}
            onClose={() => setDropdownOpen(false)}
            onApprove={(req) => {
              void handleApprove(req);
            }}
            onReject={(req) => {
              // Open detail dialog in reject mode if inline reject is desired
              openDialog(req);
            }}
            onOpenDetail={openDialog}
          />
        </div>

        {/* User avatar + dropdown */}
        <div className="dropdown dropdown-end">
          <div tabIndex={0} role="button" className="btn btn-ghost btn-sm gap-2 px-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-content">
              U
            </div>
            <CaretDown size={12} className="text-base-content/50" />
          </div>
          <ul
            tabIndex={0}
            className="dropdown-content menu z-50 mt-2 w-48 rounded-box border border-base-300 bg-base-100 p-2 shadow-lg"
          >
            <li>
              <a>プロフィール</a>
            </li>
            <li>
              <a>設定</a>
            </li>
            <li className="border-t border-base-300 pt-1 mt-1">
              <a>ログアウト</a>
            </li>
          </ul>
        </div>
      </div>

      {/* Approval dialog (rendered once, reused) */}
      <ApprovalDialog
        request={dialogRequest}
        open={dialogOpen}
        onClose={closeDialog}
        onApprove={handleApprove}
        onReject={handleReject}
      />

      <style jsx>{`
        .bell-btn[data-pending="true"] {
          animation: bellWobble 3.4s ease-in-out infinite;
        }
        @keyframes bellWobble {
          0%,
          92%,
          100% {
            transform: rotate(0);
          }
          94% {
            transform: rotate(-6deg);
          }
          96% {
            transform: rotate(5deg);
          }
          98% {
            transform: rotate(-3deg);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .bell-btn[data-pending="true"] {
            animation: none;
          }
        }
      `}</style>
    </header>
  );
}
