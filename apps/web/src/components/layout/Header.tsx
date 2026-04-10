"use client";

import { Bell, List, CaretDown } from "@phosphor-icons/react";

export function Header() {
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
        {/* Notification bell */}
        <button className="btn btn-ghost btn-sm btn-square relative" aria-label="通知">
          <Bell size={20} />
          {/* Unread indicator */}
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-error" />
        </button>

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
    </header>
  );
}
