/**
 * RBAC ポリシー定義
 *
 * design.md セクション 7 の権限マトリクスに準拠。
 * Role は @sns-agent/config から import する。
 */
import type { Role } from "@sns-agent/config";

// ───────────────────────────────────────────
// Permission 型
// ───────────────────────────────────────────

export const PERMISSIONS = [
  // アカウント
  "account:read",
  "account:connect",
  "account:disconnect",
  // 投稿
  "post:read",
  "post:create",
  "post:publish",
  "post:delete",
  // 予約
  "schedule:read",
  "schedule:create",
  "schedule:update",
  "schedule:delete",
  // 使用量
  "usage:read",
  // 予算
  "budget:read",
  "budget:manage",
  // LLM ルーティング
  "llm:read",
  "llm:manage",
  // Skills
  "skills:read",
  "skills:manage",
  // ユーザー管理
  "user:read",
  "user:manage",
  // ワークスペース
  "workspace:manage",
  // 監査ログ
  "audit:read",
  // チャット
  "chat:use",
  // 承認
  "approval:review",
  "approval:manage",
  // 受信トレイ (Inbox)
  "inbox:read",
  "inbox:reply",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

// ───────────────────────────────────────────
// Role -> Permission マッピング
// ───────────────────────────────────────────

/**
 * 各ロールに付与される権限の一覧。
 * design.md セクション 7 の権限マトリクスに準拠。
 *
 * agent ロールは skill の permission scope に従うため、
 * ここでは基本的な読み取り権限 + post:create のみ付与。
 * 実際の agent の権限は skill manifest の scope で制限される。
 */
export const rolePermissions: Record<Role, readonly Permission[]> = {
  viewer: ["account:read", "post:read", "schedule:read", "usage:read", "inbox:read"],

  operator: [
    "account:read",
    "post:read",
    "post:create",
    "schedule:read",
    "usage:read",
    "chat:use",
    "inbox:read",
  ],

  editor: [
    "account:read",
    "post:read",
    "post:create",
    "post:publish",
    "post:delete",
    "schedule:read",
    "schedule:create",
    "schedule:update",
    "schedule:delete",
    "usage:read",
    "chat:use",
    "inbox:read",
    "inbox:reply",
  ],

  admin: [
    "account:read",
    "account:connect",
    "account:disconnect",
    "post:read",
    "post:create",
    "post:publish",
    "post:delete",
    "schedule:read",
    "schedule:create",
    "schedule:update",
    "schedule:delete",
    "usage:read",
    "budget:read",
    "budget:manage",
    "llm:read",
    "llm:manage",
    "skills:read",
    "skills:manage",
    "user:read",
    "user:manage",
    "audit:read",
    "chat:use",
    "approval:review",
    "approval:manage",
    "inbox:read",
    "inbox:reply",
  ],

  owner: [
    "account:read",
    "account:connect",
    "account:disconnect",
    "post:read",
    "post:create",
    "post:publish",
    "post:delete",
    "schedule:read",
    "schedule:create",
    "schedule:update",
    "schedule:delete",
    "usage:read",
    "budget:read",
    "budget:manage",
    "llm:read",
    "llm:manage",
    "skills:read",
    "skills:manage",
    "user:read",
    "user:manage",
    "workspace:manage",
    "audit:read",
    "chat:use",
    "approval:review",
    "approval:manage",
    "inbox:read",
    "inbox:reply",
  ],

  agent: [
    "account:read",
    "post:read",
    "post:create",
    "schedule:read",
    "usage:read",
    "inbox:read",
    "inbox:reply",
  ],
};

// ───────────────────────────────────────────
// ヘルパー関数
// ───────────────────────────────────────────

/**
 * 指定ロールが指定権限を持つか判定する。
 */
export function checkPermission(role: Role, permission: Permission): boolean {
  const permissions = rolePermissions[role];
  return permissions.includes(permission);
}
