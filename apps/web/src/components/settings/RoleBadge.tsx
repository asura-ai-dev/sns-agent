/**
 * RoleBadge - RBAC ロール用のスタンプ風バッジ
 *
 * Task 3008 の仕様に従い、6 ロールを色分け表示する。
 *   viewer(灰), operator(青), editor(緑), admin(橙), owner(赤), agent(紫)
 *
 * デザイン方針は audit 画面と統一（Fraunces/DM Sans、紙面、暖色）。
 * バッジは「打刻スタンプ」的な表現：薄い塗りつぶし + 同系統の濃色ボーダー、
 * モノスペースの uppercase ラベル。
 */
import type { CSSProperties } from "react";

export type Role = "viewer" | "operator" | "editor" | "admin" | "owner" | "agent";

interface RoleStyle {
  label: string;
  fg: string;
  bg: string;
  border: string;
}

const ROLE_STYLES: Record<Role, RoleStyle> = {
  viewer: {
    label: "viewer",
    fg: "#4B5563",
    bg: "rgba(107,114,128,0.10)",
    border: "rgba(107,114,128,0.45)",
  },
  operator: {
    label: "operator",
    fg: "#2F80ED",
    bg: "rgba(47,128,237,0.10)",
    border: "rgba(47,128,237,0.45)",
  },
  editor: {
    label: "editor",
    fg: "#059669",
    bg: "rgba(6,199,85,0.12)",
    border: "rgba(6,199,85,0.50)",
  },
  admin: {
    label: "admin",
    fg: "#C2410C",
    bg: "rgba(255,122,89,0.12)",
    border: "rgba(255,122,89,0.55)",
  },
  owner: {
    label: "owner",
    fg: "#B91C1C",
    bg: "rgba(229,72,77,0.12)",
    border: "rgba(229,72,77,0.55)",
  },
  agent: {
    label: "agent",
    fg: "#7C3AED",
    bg: "rgba(124,58,237,0.12)",
    border: "rgba(124,58,237,0.50)",
  },
};

interface RoleBadgeProps {
  role: Role;
  size?: "sm" | "md";
}

export function RoleBadge({ role, size = "sm" }: RoleBadgeProps) {
  const style = ROLE_STYLES[role];
  const dims: CSSProperties =
    size === "md"
      ? { height: "1.75rem", padding: "0 0.75rem", fontSize: "0.75rem" }
      : { height: "1.375rem", padding: "0 0.5rem", fontSize: "0.625rem" };

  return (
    <span
      data-testid={`role-badge-${role}`}
      className="inline-flex items-center gap-1.5 rounded-sm font-mono font-bold uppercase tracking-[0.15em]"
      style={{
        ...dims,
        color: style.fg,
        backgroundColor: style.bg,
        border: `1px solid ${style.border}`,
      }}
    >
      <span
        aria-hidden
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: style.fg }}
      />
      {style.label}
    </span>
  );
}

export { ROLE_STYLES };
