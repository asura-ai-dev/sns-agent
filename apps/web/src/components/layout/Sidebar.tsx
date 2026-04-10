"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  House,
  PaperPlaneTilt,
  CalendarBlank,
  Tray,
  ChartBar,
  Package,
  ChatCircle,
  GearSix,
} from "@phosphor-icons/react";

const NAV_ITEMS = [
  { href: "/", label: "ダッシュボード", icon: House },
  { href: "/posts", label: "投稿", icon: PaperPlaneTilt },
  { href: "/calendar", label: "カレンダー", icon: CalendarBlank },
  { href: "/inbox", label: "受信トレイ", icon: Tray },
  { href: "/usage", label: "使用量", icon: ChartBar },
  { href: "/skills", label: "Skills", icon: Package },
  { href: "/agents", label: "チャット", icon: ChatCircle },
  { href: "/settings", label: "設定", icon: GearSix },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname.startsWith(href);
}

interface SidebarContentProps {
  pathname: string;
  onNavigate?: () => void;
}

function SidebarContent({ pathname, onNavigate }: SidebarContentProps) {
  return (
    <div className="flex h-full flex-col bg-secondary text-secondary-content">
      {/* Brand */}
      <div className="flex h-16 items-center gap-2.5 px-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
          <span className="font-display text-sm font-bold text-primary-content">S</span>
        </div>
        <span className="font-display text-lg font-semibold tracking-tight">SNS Agent</span>
      </div>

      {/* Navigation */}
      <nav className="mt-2 flex flex-1 flex-col gap-0.5 px-3">
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              data-active={active}
              className="sidebar-nav-item flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-secondary-content/70 transition-colors hover:bg-white/5 hover:text-secondary-content"
            >
              <Icon size={22} weight={active ? "fill" : "regular"} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-white/10 px-5 py-4">
        <p className="text-xs text-secondary-content/40">v1.0.0</p>
      </div>
    </div>
  );
}

/** Desktop sidebar -- always visible at lg (1024px+) */
export function SidebarDesktop() {
  const pathname = usePathname();
  return (
    <aside className="hidden w-60 shrink-0 lg:block">
      <div className="fixed inset-y-0 left-0 z-30 w-60">
        <SidebarContent pathname={pathname} />
      </div>
    </aside>
  );
}

/** Mobile drawer sidebar -- visible below lg */
export function SidebarDrawer() {
  const pathname = usePathname();

  const closeDrawer = () => {
    const checkbox = document.getElementById("app-drawer") as HTMLInputElement | null;
    if (checkbox) checkbox.checked = false;
  };

  return (
    <div className="drawer-side z-40">
      <label htmlFor="app-drawer" aria-label="メニューを閉じる" className="drawer-overlay" />
      <div className="h-full w-60">
        <SidebarContent pathname={pathname} onNavigate={closeDrawer} />
      </div>
    </div>
  );
}
