"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  House,
  PaperPlaneTilt,
  CalendarBlank,
  Tray,
  ChartBar,
  ChartLineUp,
  Package,
  ChatCircle,
  Question,
  GearSix,
  Quotes,
} from "@phosphor-icons/react";
import { NAV_LABELS } from "@/lib/i18n/labels";

const NAV_ICONS: Record<string, typeof House> = {
  "/": House,
  "/posts": PaperPlaneTilt,
  "/calendar": CalendarBlank,
  "/inbox": Tray,
  "/quotes": Quotes,
  "/analytics": ChartLineUp,
  "/usage": ChartBar,
  "/skills": Package,
  "/agents": ChatCircle,
  "/help": Question,
  "/settings": GearSix,
};

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname.startsWith(href);
}

interface SidebarContentProps {
  pathname: string;
  onNavigate?: () => void;
  collapsible?: boolean;
}

function SidebarContent({ pathname, onNavigate, collapsible = false }: SidebarContentProps) {
  return (
    <div className="flex h-full flex-col bg-base-100 text-base-content">
      {/* Brand */}
      <div className="flex h-16 items-center gap-2.5 px-5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary">
          <span className="font-display text-sm font-bold text-primary-content">S</span>
        </div>
        <span
          className={[
            "font-display text-lg font-semibold tracking-tight",
            collapsible
              ? "sidebar-collapsible-label sidebar-fade whitespace-nowrap opacity-100 lg:opacity-0"
              : "",
          ].join(" ")}
        >
          SNS Agent
        </span>
      </div>

      {/* Navigation */}
      <nav className="mt-2 flex flex-1 flex-col gap-0.5 px-3">
        {NAV_LABELS.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = NAV_ICONS[item.href];
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-label={item.en}
              onClick={onNavigate}
              data-active={active}
              className="sidebar-nav-item flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-base-content/70 transition-colors hover:bg-base-200/60 hover:text-base-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <Icon size={22} weight={active ? "fill" : "regular"} className="shrink-0" />
              <span
                className={[
                  "min-w-0 whitespace-nowrap",
                  collapsible
                    ? "sidebar-collapsible-label sidebar-fade opacity-100 lg:opacity-0"
                    : "",
                ].join(" ")}
              >
                {item.en}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-base-300 px-5 py-4">
        <p
          className={[
            "text-xs text-base-content/50",
            collapsible
              ? "sidebar-collapsible-label sidebar-fade whitespace-nowrap opacity-100 lg:opacity-0"
              : "",
          ].join(" ")}
        >
          v1.0.0
        </p>
      </div>
    </div>
  );
}

/** Desktop sidebar -- always visible at lg (1024px+) */
export function SidebarDesktop() {
  const pathname = usePathname();
  return (
    <>
      <div aria-hidden="true" className="hidden w-16 shrink-0 lg:block" />
      <aside className="sidebar-desktop-root sidebar-expand hidden overflow-hidden border-r border-base-300 bg-base-100 transition-[width] duration-200 ease-out lg:fixed lg:inset-y-0 lg:left-0 lg:z-30 lg:block lg:w-16">
        <SidebarContent pathname={pathname} collapsible />
      </aside>
    </>
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
    <div className="drawer-side z-40 lg:hidden">
      <label htmlFor="app-drawer" aria-label="メニューを閉じる" className="drawer-overlay" />
      <div className="h-full w-60">
        <SidebarContent pathname={pathname} onNavigate={closeDrawer} />
      </div>
    </div>
  );
}
