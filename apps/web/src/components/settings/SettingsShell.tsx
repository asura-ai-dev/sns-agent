/**
 * SettingsShell - 設定画面共通シェル
 *
 * 左側にローカルナビ（カテゴリ）、右側に children の本文。
 * audit 画面と同じ紙面デザインを踏襲しつつ、設定専用のサイドバーを配置する。
 *
 * カテゴリ:
 *  - accounts: アカウント接続
 *  - users:    ユーザー管理
 *  - （後続: llm, budget, audit）
 *
 * モバイルでは上部のタブに変化する。
 */
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Plugs, UsersFour, Brain, Coins, FileText, CaretRight } from "@phosphor-icons/react";

interface NavItem {
  href: string;
  label: string;
  description: string;
  icon: typeof Plugs;
  disabled?: boolean;
  slug: string;
}

const SETTINGS_NAV: NavItem[] = [
  {
    href: "/settings/accounts",
    label: "アカウント接続",
    description: "X / LINE / Instagram",
    icon: Plugs,
    slug: "accounts",
  },
  {
    href: "/settings/users",
    label: "ユーザー管理",
    description: "メンバーとエージェント",
    icon: UsersFour,
    slug: "users",
  },
  {
    href: "/settings/audit",
    label: "監査ログ",
    description: "Operations Ledger",
    icon: FileText,
    slug: "audit",
  },
  {
    href: "/settings/llm",
    label: "LLM ルーティング",
    description: "Dispatch Roster",
    icon: Brain,
    slug: "llm",
  },
  {
    href: "/settings/budget",
    label: "予算ポリシー",
    description: "Allowances Register",
    icon: Coins,
    slug: "budget",
  },
];

interface SettingsShellProps {
  activeSlug: string;
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}

export function SettingsShell({
  activeSlug,
  eyebrow,
  title,
  description,
  actions,
  children,
}: SettingsShellProps) {
  const pathname = usePathname();

  return (
    <div className="space-y-6">
      {/* ────────── Header ────────── */}
      <header className="relative overflow-hidden rounded-box border border-base-300 bg-gradient-to-br from-base-100 via-base-100 to-base-200/60 px-6 py-6">
        {/* Paper grain */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(0deg, #000 0px, #000 1px, transparent 1px, transparent 28px)",
          }}
        />
        {/* Accent ruler */}
        <div className="pointer-events-none absolute inset-x-6 top-16 h-px bg-gradient-to-r from-transparent via-accent/40 to-transparent" />

        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-base-content/50">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary" />
              {eyebrow ?? "settings"}
            </p>
            <h1
              className="mt-2 font-display text-4xl font-semibold leading-none tracking-tight text-base-content"
              style={{ fontFamily: "'Fraunces', serif", fontFeatureSettings: "'ss01', 'ss02'" }}
            >
              {title}
            </h1>
            {description && (
              <p className="mt-2 max-w-2xl text-sm text-base-content/60">{description}</p>
            )}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      </header>

      {/* ────────── Main grid ────────── */}
      <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
        {/* Sidebar */}
        <nav
          aria-label="設定カテゴリ"
          className="sticky top-4 self-start rounded-box border border-base-300 bg-base-100"
        >
          <div className="border-b border-base-300/70 px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-base-content/50">
              categories
            </p>
          </div>
          <ul className="flex flex-col gap-0.5 p-2">
            {SETTINGS_NAV.map((item) => {
              const active = !item.disabled && (activeSlug === item.slug || pathname === item.href);
              const Icon = item.icon;
              if (item.disabled) {
                return (
                  <li key={item.slug}>
                    <div
                      aria-disabled
                      className="flex items-center gap-3 rounded-sm px-3 py-2.5 opacity-40"
                    >
                      <Icon size={16} weight="regular" className="text-base-content/60" />
                      <div className="flex min-w-0 flex-col leading-tight">
                        <span className="text-xs font-medium text-base-content/70">
                          {item.label}
                        </span>
                        <span className="font-mono text-[10px] uppercase tracking-wider text-base-content/40">
                          {item.description}
                        </span>
                      </div>
                    </div>
                  </li>
                );
              }
              return (
                <li key={item.slug}>
                  <Link
                    href={item.href}
                    data-active={active}
                    className="group flex items-center gap-3 rounded-sm px-3 py-2.5 transition-colors hover:bg-accent/5 data-[active=true]:border-l-2 data-[active=true]:border-l-primary data-[active=true]:bg-primary/5"
                  >
                    <Icon
                      size={16}
                      weight={active ? "fill" : "regular"}
                      className={
                        active ? "text-primary" : "text-base-content/60 group-hover:text-accent"
                      }
                    />
                    <div className="flex min-w-0 flex-1 flex-col leading-tight">
                      <span
                        className={`text-xs font-medium ${
                          active ? "text-primary" : "text-base-content"
                        }`}
                      >
                        {item.label}
                      </span>
                      <span className="font-mono text-[10px] uppercase tracking-wider text-base-content/50">
                        {item.description}
                      </span>
                    </div>
                    {active && <CaretRight size={12} weight="bold" className="text-primary" />}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Main content */}
        <main className="min-w-0 space-y-5">{children}</main>
      </div>
    </div>
  );
}
