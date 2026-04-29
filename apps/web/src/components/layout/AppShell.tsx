"use client";

import { SidebarDesktop, SidebarDrawer } from "./Sidebar";
import { Header } from "./Header";

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="drawer lg:drawer-open">
      <input id="app-drawer" type="checkbox" className="drawer-toggle" />

      {/* Main area: sidebar (desktop) + header + content */}
      <div className="drawer-content flex min-h-screen">
        {/* Desktop sidebar (fixed, always visible at lg+) */}
        <SidebarDesktop />

        {/* Header + main content column */}
        <div className="flex min-w-0 flex-1 flex-col">
          <Header />
          <main className="min-w-0 flex-1 p-4 lg:p-6">{children}</main>
        </div>
      </div>

      {/* Mobile drawer sidebar */}
      <SidebarDrawer />
    </div>
  );
}
