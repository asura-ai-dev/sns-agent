/**
 * 設定: ユーザー管理 / エージェント ID 管理
 *
 * Task 3008 (settings/users):
 *  - ユーザー一覧（名前 / email / role / 作成日）
 *  - ロール変更ドロップダウン（admin/owner のみ）
 *  - ユーザー招待（メール + ロール指定）
 *  - エージェント ID 一覧（API キーをマスク表示）
 *  - エージェント ID 作成
 *
 * API（Phase 3 時点では /api/users, /api/agent-identities が未実装のため、
 *      404 の場合は localStorage ベースのデモデータにフォールバックする）:
 *  - GET    /api/users
 *  - POST   /api/users/invite
 *  - PATCH  /api/users/:id/role
 *  - GET    /api/agent-identities
 *  - POST   /api/agent-identities
 *
 * デザイン方針: SettingsShell 準拠（Fraunces + DM Sans、紙面、暖色）。
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Plus,
  ArrowsClockwise,
  WarningOctagon,
  X,
  Lock,
  Envelope,
  Robot,
  User,
  Copy,
  CheckCircle,
  Eye,
  EyeSlash,
  Key,
} from "@phosphor-icons/react";

import { SettingsShell } from "@/components/settings/SettingsShell";
import { ConfirmDialog } from "@/components/settings/ConfirmDialog";
import { useCurrentRole } from "@/components/settings/useCurrentRole";
import { RoleBadge, type Role } from "@/components/settings/RoleBadge";
import { SECTION_KICKERS } from "@/lib/i18n/labels";

// ───────────────────────────────────────────
// 型
// ───────────────────────────────────────────

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  createdAt: string;
}

interface AgentIdentityRow {
  id: string;
  name: string;
  role: Role;
  apiKeyMasked: string;
  apiKeyPlain?: string; // 作成直後のみ返る
  createdAt: string;
}

const USER_ROLES: Role[] = ["viewer", "operator", "editor", "admin", "owner"];
const AGENT_ROLES: Role[] = ["viewer", "operator", "editor", "agent"];

const DEMO_USERS_KEY = "sns-agent:demo-users";
const DEMO_AGENTS_KEY = "sns-agent:demo-agents";

// ───────────────────────────────────────────
// ユーティリティ
// ───────────────────────────────────────────

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
}

function maskKey(key: string): string {
  if (key.length <= 8) return "••••••••";
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

function uuid(): string {
  if (globalThis.crypto && "randomUUID" in globalThis.crypto) {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function generateApiKey(): string {
  // "sk_" + 32 文字の疑似乱数（デモ用、実 API は api 側で生成）
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "sk_";
  for (let i = 0; i < 32; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

// ───────────────────────────────────────────
// デモデータ (Phase 3 時点で users/agents API が未実装のためのフォールバック)
// ───────────────────────────────────────────

function seedDemoUsers(): UserRow[] {
  return [
    {
      id: uuid(),
      name: "Owner Sato",
      email: "owner@example.com",
      role: "owner",
      createdAt: new Date("2025-09-01T09:00:00").toISOString(),
    },
    {
      id: uuid(),
      name: "Admin Suzuki",
      email: "admin@example.com",
      role: "admin",
      createdAt: new Date("2025-10-12T14:30:00").toISOString(),
    },
    {
      id: uuid(),
      name: "Editor Yamada",
      email: "editor@example.com",
      role: "editor",
      createdAt: new Date("2025-11-05T10:15:00").toISOString(),
    },
    {
      id: uuid(),
      name: "Viewer Takeda",
      email: "viewer@example.com",
      role: "viewer",
      createdAt: new Date("2026-01-20T16:45:00").toISOString(),
    },
  ];
}

function seedDemoAgents(): AgentIdentityRow[] {
  return [
    {
      id: uuid(),
      name: "scheduled-poster",
      role: "editor",
      apiKeyMasked: maskKey("sk_abcdEFGH1234ijklMNOP5678qrstUVWX"),
      createdAt: new Date("2026-02-10T08:00:00").toISOString(),
    },
    {
      id: uuid(),
      name: "inbox-responder",
      role: "operator",
      apiKeyMasked: maskKey("sk_zzzzYYYY9999xxxxWWWW8888vvvvUUUU"),
      createdAt: new Date("2026-03-01T12:30:00").toISOString(),
    },
  ];
}

function loadDemoUsers(): UserRow[] {
  try {
    const raw = window.localStorage.getItem(DEMO_USERS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as UserRow[];
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // noop
  }
  const fresh = seedDemoUsers();
  try {
    window.localStorage.setItem(DEMO_USERS_KEY, JSON.stringify(fresh));
  } catch {
    // noop
  }
  return fresh;
}

function loadDemoAgents(): AgentIdentityRow[] {
  try {
    const raw = window.localStorage.getItem(DEMO_AGENTS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AgentIdentityRow[];
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // noop
  }
  const fresh = seedDemoAgents();
  try {
    window.localStorage.setItem(DEMO_AGENTS_KEY, JSON.stringify(fresh));
  } catch {
    // noop
  }
  return fresh;
}

function saveDemoUsers(users: UserRow[]) {
  try {
    window.localStorage.setItem(DEMO_USERS_KEY, JSON.stringify(users));
  } catch {
    // noop
  }
}

function saveDemoAgents(agents: AgentIdentityRow[]) {
  try {
    window.localStorage.setItem(DEMO_AGENTS_KEY, JSON.stringify(agents));
  } catch {
    // noop
  }
}

// ───────────────────────────────────────────
// Invite User Modal
// ───────────────────────────────────────────

function InviteUserModal({
  open,
  onClose,
  onInvite,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  onInvite: (email: string, name: string, role: Role) => Promise<void>;
  busy: boolean;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("editor");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setEmail("");
      setName("");
      setRole("editor");
      setErr(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, busy, onClose]);

  if (!open) return null;

  const submit = async () => {
    setErr(null);
    const trimmed = email.trim();
    if (!trimmed || !trimmed.includes("@")) {
      setErr("有効なメールアドレスを入力してください");
      return;
    }
    if (!name.trim()) {
      setErr("名前を入力してください");
      return;
    }
    try {
      await onInvite(trimmed, name.trim(), role);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "招待に失敗しました");
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="ユーザー招待"
    >
      <button
        type="button"
        onClick={onClose}
        disabled={busy}
        className="absolute inset-0 bg-secondary/60 backdrop-blur-sm"
        aria-label="閉じる"
      />
      <div
        className="relative w-full max-w-md overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-2xl"
        style={{ animation: "inviteIn 0.25s cubic-bezier(0.16, 1, 0.3, 1)" }}
      >
        <div className="relative border-b-2 border-dashed border-base-300 bg-gradient-to-b from-base-200/60 to-base-100 px-6 pb-5 pt-5">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="btn btn-sm btn-circle btn-ghost absolute right-3 top-3"
            aria-label="閉じる"
          >
            <X size={16} weight="bold" />
          </button>
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-base-content/50">
            invite user
          </div>
          <h2
            className="mt-1 font-display text-2xl font-semibold leading-tight text-base-content"
            style={{ fontFamily: "'Fraunces', serif" }}
          >
            ユーザーを招待
          </h2>
          <p className="mt-2 text-sm text-base-content/60">
            指定したメールアドレスに招待リンクを送信します。招待対象のロールは後からも変更できます。
          </p>
        </div>

        <div className="space-y-4 px-6 py-5">
          <div>
            <label
              htmlFor="invite-name"
              className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-base-content/50"
            >
              名前
            </label>
            <input
              id="invite-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例: 山田 太郎"
              className="input input-sm w-full rounded-sm border-base-300 bg-base-100 focus:border-primary focus:outline-none"
            />
          </div>
          <div>
            <label
              htmlFor="invite-email"
              className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-base-content/50"
            >
              メールアドレス
            </label>
            <div className="relative">
              <Envelope
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base-content/40"
              />
              <input
                id="invite-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="例: user@example.com"
                className="input input-sm w-full rounded-sm border-base-300 bg-base-100 pl-8 font-mono text-xs focus:border-primary focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label
              htmlFor="invite-role"
              className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-base-content/50"
            >
              ロール
            </label>
            <select
              id="invite-role"
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              className="select select-sm w-full rounded-sm border-base-300 bg-base-100 font-mono text-xs focus:border-primary focus:outline-none"
            >
              {USER_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <div className="mt-2">
              <RoleBadge role={role} />
            </div>
          </div>

          {err && (
            <div className="flex items-center gap-2 rounded-sm border border-error/40 bg-error/10 px-3 py-2 text-xs text-error">
              <WarningOctagon size={14} weight="bold" />
              {err}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-base-300 bg-base-200/40 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="btn btn-sm rounded-sm border-base-300 bg-base-100 font-mono text-xs uppercase tracking-wider"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy}
            className="btn btn-sm rounded-sm border-none bg-primary font-mono text-xs uppercase tracking-wider text-primary-content hover:bg-primary/90"
          >
            {busy ? "..." : "招待を送信"}
          </button>
        </div>

        <style jsx>{`
          @keyframes inviteIn {
            from {
              opacity: 0;
              transform: translateY(8px) scale(0.98);
            }
            to {
              opacity: 1;
              transform: translateY(0) scale(1);
            }
          }
        `}</style>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────
// Agent Identity 作成モーダル
// ───────────────────────────────────────────

function CreateAgentModal({
  open,
  onClose,
  onCreate,
  createdAgent,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, role: Role) => Promise<void>;
  createdAgent: AgentIdentityRow | null;
  busy: boolean;
}) {
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("editor");
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revealed, setRevealed] = useState(true);

  useEffect(() => {
    if (!open) {
      setName("");
      setRole("editor");
      setErr(null);
      setCopied(false);
      setRevealed(true);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, busy, onClose]);

  if (!open) return null;

  const submit = async () => {
    setErr(null);
    if (!name.trim()) {
      setErr("名前を入力してください");
      return;
    }
    try {
      await onCreate(name.trim(), role);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "作成に失敗しました");
    }
  };

  const copyKey = async () => {
    if (!createdAgent?.apiKeyPlain) return;
    try {
      await navigator.clipboard.writeText(createdAgent.apiKeyPlain);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // noop
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="エージェント ID 作成"
    >
      <button
        type="button"
        onClick={onClose}
        disabled={busy}
        className="absolute inset-0 bg-secondary/60 backdrop-blur-sm"
        aria-label="閉じる"
      />
      <div
        className="relative w-full max-w-md overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-2xl"
        style={{ animation: "agentIn 0.25s cubic-bezier(0.16, 1, 0.3, 1)" }}
      >
        <div className="relative border-b-2 border-dashed border-base-300 bg-gradient-to-b from-base-200/60 to-base-100 px-6 pb-5 pt-5">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="btn btn-sm btn-circle btn-ghost absolute right-3 top-3"
            aria-label="閉じる"
          >
            <X size={16} weight="bold" />
          </button>
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-base-content/50">
            new agent identity
          </div>
          <h2
            className="mt-1 font-display text-2xl font-semibold leading-tight text-base-content"
            style={{ fontFamily: "'Fraunces', serif" }}
          >
            エージェント ID を作成
          </h2>
          <p className="mt-2 text-sm text-base-content/60">
            AI エージェント用の API
            キーを発行します。キーは作成直後のみ表示されるため、必ず控えてください。
          </p>
        </div>

        {createdAgent?.apiKeyPlain ? (
          <div className="px-6 py-5">
            <div className="rounded-sm border border-primary/40 bg-primary/5 px-4 py-3">
              <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-primary">
                <CheckCircle size={12} weight="fill" />
                発行完了
              </div>
              <div className="mt-2 text-sm text-base-content/80">
                <span className="font-semibold">{createdAgent.name}</span> を発行しました。
              </div>
              <div className="mt-3">
                <div className="mb-1 flex items-center justify-between">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-base-content/50">
                    api key
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setRevealed((v) => !v)}
                      className="btn btn-xs rounded-sm border-base-300 bg-base-100 font-mono text-[10px] uppercase tracking-wider"
                    >
                      {revealed ? (
                        <EyeSlash size={11} weight="bold" />
                      ) : (
                        <Eye size={11} weight="bold" />
                      )}
                      {revealed ? "隠す" : "表示"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void copyKey()}
                      className="btn btn-xs rounded-sm border-base-300 bg-base-100 font-mono text-[10px] uppercase tracking-wider"
                    >
                      <Copy size={11} weight="bold" />
                      {copied ? "コピー済み" : "コピー"}
                    </button>
                  </div>
                </div>
                <pre className="overflow-x-auto rounded-sm border border-base-300 bg-secondary/95 px-3 py-2 font-mono text-[11px] leading-relaxed text-secondary-content">
                  <code>
                    {revealed
                      ? createdAgent.apiKeyPlain
                      : "•".repeat(createdAgent.apiKeyPlain.length)}
                  </code>
                </pre>
                <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-error">
                  この画面を閉じると、このキーは再表示できません
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4 px-6 py-5">
            <div>
              <label
                htmlFor="agent-name"
                className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-base-content/50"
              >
                名前
              </label>
              <input
                id="agent-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例: scheduled-poster"
                className="input input-sm w-full rounded-sm border-base-300 bg-base-100 font-mono text-xs focus:border-primary focus:outline-none"
              />
            </div>
            <div>
              <label
                htmlFor="agent-role"
                className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-base-content/50"
              >
                ロール
              </label>
              <select
                id="agent-role"
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
                className="select select-sm w-full rounded-sm border-base-300 bg-base-100 font-mono text-xs focus:border-primary focus:outline-none"
              >
                {AGENT_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <div className="mt-2">
                <RoleBadge role={role} />
              </div>
            </div>

            {err && (
              <div className="flex items-center gap-2 rounded-sm border border-error/40 bg-error/10 px-3 py-2 text-xs text-error">
                <WarningOctagon size={14} weight="bold" />
                {err}
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-base-300 bg-base-200/40 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="btn btn-sm rounded-sm border-base-300 bg-base-100 font-mono text-xs uppercase tracking-wider"
          >
            {createdAgent?.apiKeyPlain ? "閉じる" : "キャンセル"}
          </button>
          {!createdAgent?.apiKeyPlain && (
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy}
              className="btn btn-sm rounded-sm border-none bg-primary font-mono text-xs uppercase tracking-wider text-primary-content hover:bg-primary/90"
            >
              {busy ? "..." : "キーを発行"}
            </button>
          )}
        </div>

        <style jsx>{`
          @keyframes agentIn {
            from {
              opacity: 0;
              transform: translateY(8px) scale(0.98);
            }
            to {
              opacity: 1;
              transform: translateY(0) scale(1);
            }
          }
        `}</style>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────
// Role select (inline)
// ───────────────────────────────────────────

function RoleSelect({
  value,
  options,
  disabled,
  onChange,
}: {
  value: Role;
  options: Role[];
  disabled?: boolean;
  onChange: (v: Role) => void;
}) {
  if (disabled) {
    return <RoleBadge role={value} />;
  }
  return (
    <div className="flex items-center gap-2">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as Role)}
        className="select select-xs h-7 min-h-7 rounded-sm border-base-300 bg-base-100 font-mono text-[11px] focus:border-primary focus:outline-none"
        aria-label="ロールを変更"
      >
        {options.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      <RoleBadge role={value} />
    </div>
  );
}

// ───────────────────────────────────────────
// メインページ
// ───────────────────────────────────────────

export default function UsersSettingsPage() {
  const { role: currentRole, isAdmin } = useCurrentRole();

  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [agents, setAgents] = useState<AgentIdentityRow[] | null>(null);
  const [usingDemoData, setUsingDemoData] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);

  const [createAgentOpen, setCreateAgentOpen] = useState(false);
  const [createdAgent, setCreatedAgent] = useState<AgentIdentityRow | null>(null);
  const [createAgentBusy, setCreateAgentBusy] = useState(false);

  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionTone, setActionTone] = useState<"info" | "error">("info");

  const [pendingRoleChange, setPendingRoleChange] = useState<{
    user: UserRow;
    nextRole: Role;
  } | null>(null);

  // ───────── fetch ─────────
  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    let demo = false;
    try {
      const [usersRes, agentsRes] = await Promise.all([
        fetch("/api/users", { credentials: "include" }).catch(() => null),
        fetch("/api/agent-identities", { credentials: "include" }).catch(() => null),
      ]);

      let usersList: UserRow[] = [];
      if (usersRes && usersRes.ok) {
        const body = (await usersRes.json()) as { data: UserRow[] };
        usersList = body.data ?? [];
      } else {
        demo = true;
        usersList = loadDemoUsers();
      }

      let agentsList: AgentIdentityRow[] = [];
      if (agentsRes && agentsRes.ok) {
        const body = (await agentsRes.json()) as { data: AgentIdentityRow[] };
        agentsList = body.data ?? [];
      } else {
        demo = true;
        agentsList = loadDemoAgents();
      }

      setUsers(usersList);
      setAgents(agentsList);
      setUsingDemoData(demo);
    } catch (err) {
      setError(err instanceof Error ? err.message : "メンバー情報の取得に失敗しました");
      setUsers(loadDemoUsers());
      setAgents(loadDemoAgents());
      setUsingDemoData(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  // ───────── actions ─────────
  const changeRole = async (user: UserRow, nextRole: Role) => {
    if (!isAdmin) return;
    if (user.role === nextRole) return;
    setPendingRoleChange({ user, nextRole });
  };

  const confirmRoleChange = async () => {
    if (!pendingRoleChange) return;
    const { user, nextRole } = pendingRoleChange;
    try {
      // 実 API を試みる
      const res = await fetch(`/api/users/${user.id}/role`, {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-Idempotency-Key": uuid(),
        },
        body: JSON.stringify({ role: nextRole }),
      }).catch(() => null);

      const next = (users ?? []).map((u) => (u.id === user.id ? { ...u, role: nextRole } : u));
      setUsers(next);

      if (!res || !res.ok) {
        saveDemoUsers(next);
        setUsingDemoData(true);
      }

      setActionTone("info");
      setActionMessage(`${user.name} のロールを ${nextRole} に変更しました`);
    } catch (err) {
      setActionTone("error");
      setActionMessage(err instanceof Error ? err.message : "ロール変更に失敗しました");
    } finally {
      setPendingRoleChange(null);
    }
  };

  const invite = async (email: string, name: string, role: Role) => {
    if (!isAdmin) return;
    setInviteBusy(true);
    try {
      const res = await fetch("/api/users/invite", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-Idempotency-Key": uuid(),
        },
        body: JSON.stringify({ email, name, role }),
      }).catch(() => null);

      const newUser: UserRow = {
        id: uuid(),
        name,
        email,
        role,
        createdAt: new Date().toISOString(),
      };
      const next = [...(users ?? []), newUser];
      setUsers(next);

      if (!res || !res.ok) {
        saveDemoUsers(next);
        setUsingDemoData(true);
      }

      setActionTone("info");
      setActionMessage(`${email} に招待を送信しました`);
      setInviteOpen(false);
    } finally {
      setInviteBusy(false);
    }
  };

  const createAgent = async (name: string, role: Role) => {
    if (!isAdmin) return;
    setCreateAgentBusy(true);
    try {
      const res = await fetch("/api/agent-identities", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-Idempotency-Key": uuid(),
        },
        body: JSON.stringify({ name, role }),
      }).catch(() => null);

      let created: AgentIdentityRow;
      if (res && res.ok) {
        const body = (await res.json()) as { data: AgentIdentityRow };
        created = body.data;
      } else {
        const plain = generateApiKey();
        created = {
          id: uuid(),
          name,
          role,
          apiKeyMasked: maskKey(plain),
          apiKeyPlain: plain,
          createdAt: new Date().toISOString(),
        };
        const next = [...(agents ?? []), { ...created, apiKeyPlain: undefined }];
        saveDemoAgents(next);
        setUsingDemoData(true);
      }

      const nextAgents = [...(agents ?? []), created];
      setAgents(nextAgents);
      setCreatedAgent(created);
      setActionTone("info");
      setActionMessage(`エージェント ${name} を作成しました`);
    } finally {
      setCreateAgentBusy(false);
    }
  };

  const closeCreateAgent = () => {
    if (createAgentBusy) return;
    setCreateAgentOpen(false);
    // モーダルを閉じたら apiKeyPlain を落とす（UI 上からも消す）
    setCreatedAgent(null);
    setAgents((prev) => (prev ? prev.map((a) => ({ ...a, apiKeyPlain: undefined })) : prev));
  };

  // ───────── render ─────────
  const userCount = users?.length ?? 0;
  const agentCount = agents?.length ?? 0;

  return (
    <SettingsShell
      activeSlug="users"
      eyebrow={SECTION_KICKERS.settingsUsers}
      title="Members & Agents"
      description="ワークスペースのメンバーとエージェント ID を管理します。ロール変更・招待・API キー発行は admin / owner のみ実行できます。"
      actions={
        <>
          <div className="rounded-sm border border-base-300 bg-base-100 px-4 py-2.5 text-right leading-tight">
            <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-base-content/50">
              users / agents
            </div>
            <div
              className="mt-0.5 font-display text-2xl font-semibold tabular-nums text-base-content"
              style={{ fontFamily: "'Fraunces', serif" }}
            >
              {userCount}
              <span className="mx-1 text-base-content/30">/</span>
              {agentCount}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void fetchAll()}
            disabled={loading}
            className="btn btn-sm gap-2 rounded-sm border-base-300 bg-base-100 font-mono text-xs uppercase tracking-wider hover:border-primary hover:bg-primary/5"
            aria-label="再読み込み"
          >
            <ArrowsClockwise size={14} weight="bold" className={loading ? "animate-spin" : ""} />
            再読み込み
          </button>
        </>
      }
    >
      {/* role notice */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-base-300/70 bg-base-200/40 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-base-content/50">
            current role
          </span>
          <RoleBadge role={currentRole} />
          {!isAdmin && (
            <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-base-content/50">
              <Lock size={11} weight="bold" />
              閲覧専用
            </span>
          )}
        </div>
        <p className="font-mono text-[10px] uppercase tracking-wider text-base-content/40">
          {isAdmin ? "すべての管理操作が可能です" : "管理操作は admin / owner のみ実行できます"}
        </p>
      </div>

      {/* demo data notice */}
      {usingDemoData && (
        <div className="rounded-sm border border-info/40 bg-info/10 px-4 py-3 text-xs text-info">
          <span className="font-mono uppercase tracking-wider">demo mode</span> · users /
          agent-identities の API が未接続のため、ローカル保存のデモデータを表示しています。 API
          実装後は自動的にライブデータへ切り替わります。
        </div>
      )}

      {/* action message */}
      {actionMessage && (
        <div
          className={`flex items-center justify-between gap-3 rounded-sm border px-4 py-3 text-sm ${
            actionTone === "error"
              ? "border-error/40 bg-error/10 text-error"
              : "border-info/40 bg-info/10 text-info"
          }`}
          role="status"
        >
          <span>{actionMessage}</span>
          <button
            type="button"
            onClick={() => setActionMessage(null)}
            className="btn btn-xs btn-ghost"
            aria-label="閉じる"
          >
            <X size={12} weight="bold" />
          </button>
        </div>
      )}

      {/* Users section */}
      <section className="overflow-hidden rounded-box border border-base-300 bg-base-100">
        <div className="flex items-center justify-between border-b border-base-300/70 px-5 py-3">
          <div className="flex items-center gap-2">
            <User size={16} weight="bold" className="text-accent" />
            <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-base-content/70">
              users
            </h2>
          </div>
          {isAdmin && (
            <button
              type="button"
              onClick={() => setInviteOpen(true)}
              className="btn btn-xs gap-1 rounded-sm border-none bg-primary font-mono text-[10px] uppercase tracking-wider text-primary-content hover:bg-primary/90"
            >
              <Plus size={11} weight="bold" />
              ユーザー招待
            </button>
          )}
        </div>

        <div className="grid grid-cols-12 gap-4 border-b border-base-300 bg-base-200/50 px-5 py-3 font-mono text-[10px] uppercase tracking-[0.15em] text-base-content/60">
          <div className="col-span-3">name</div>
          <div className="col-span-4">email</div>
          <div className="col-span-3">role</div>
          <div className="col-span-2 text-right">created</div>
        </div>

        <div className="divide-y divide-base-300/60">
          {loading && !users && (
            <div className="px-5 py-12 text-center font-mono text-xs uppercase tracking-wider text-base-content/50">
              <ArrowsClockwise size={14} className="mr-2 inline animate-spin" />
              ユーザーを読み込んでいます…
            </div>
          )}
          {error && (
            <div className="px-5 py-12 text-center">
              <WarningOctagon size={28} weight="duotone" className="mx-auto text-error" />
              <p className="mt-2 font-mono text-xs text-error">{error}</p>
            </div>
          )}
          {!loading && users && users.length === 0 && (
            <div className="px-5 py-12 text-center">
              <p
                className="font-display text-lg text-base-content/40"
                style={{ fontFamily: "'Fraunces', serif" }}
              >
                ユーザーはまだ登録されていません
              </p>
              <p className="mt-1 font-mono text-xs text-base-content/40">
                招待したメンバーがここに表示されます
              </p>
            </div>
          )}
          {users?.map((u, idx) => (
            <div
              key={u.id}
              className="grid grid-cols-12 items-center gap-4 px-5 py-3"
              style={{
                animation: `fadeInUp 0.4s ease-out ${Math.min(idx * 25, 250)}ms backwards`,
              }}
            >
              <div className="col-span-3 flex min-w-0 items-center gap-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-primary">
                  <User size={13} weight="bold" />
                </span>
                <span className="truncate text-sm text-base-content">{u.name}</span>
              </div>
              <div className="col-span-4 min-w-0 truncate font-mono text-xs text-base-content/70">
                {u.email}
              </div>
              <div className="col-span-3">
                <RoleSelect
                  value={u.role}
                  options={USER_ROLES}
                  disabled={!isAdmin || u.role === "owner"}
                  onChange={(next) => void changeRole(u, next)}
                />
              </div>
              <div className="col-span-2 text-right font-mono text-xs text-base-content/50">
                {formatDate(u.createdAt)}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Agents section */}
      <section className="overflow-hidden rounded-box border border-base-300 bg-base-100">
        <div className="flex items-center justify-between border-b border-base-300/70 px-5 py-3">
          <div className="flex items-center gap-2">
            <Robot size={16} weight="bold" className="text-accent" />
            <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-base-content/70">
              agent identities
            </h2>
          </div>
          {isAdmin && (
            <button
              type="button"
              onClick={() => {
                setCreatedAgent(null);
                setCreateAgentOpen(true);
              }}
              className="btn btn-xs gap-1 rounded-sm border-none bg-accent font-mono text-[10px] uppercase tracking-wider text-accent-content hover:bg-accent/90"
            >
              <Key size={11} weight="bold" />
              エージェント ID 発行
            </button>
          )}
        </div>

        <div className="grid grid-cols-12 gap-4 border-b border-base-300 bg-base-200/50 px-5 py-3 font-mono text-[10px] uppercase tracking-[0.15em] text-base-content/60">
          <div className="col-span-3">name</div>
          <div className="col-span-2">role</div>
          <div className="col-span-5">api key</div>
          <div className="col-span-2 text-right">created</div>
        </div>

        <div className="divide-y divide-base-300/60">
          {loading && !agents && (
            <div className="px-5 py-12 text-center font-mono text-xs uppercase tracking-wider text-base-content/50">
              <ArrowsClockwise size={14} className="mr-2 inline animate-spin" />
              エージェント ID を読み込んでいます…
            </div>
          )}
          {!loading && agents && agents.length === 0 && (
            <div className="px-5 py-12 text-center">
              <p
                className="font-display text-lg text-base-content/40"
                style={{ fontFamily: "'Fraunces', serif" }}
              >
                エージェント ID はまだありません
              </p>
              {isAdmin && (
                <p className="mt-1 font-mono text-xs text-base-content/40">
                  「エージェント ID 発行」から作成してください
                </p>
              )}
            </div>
          )}
          {agents?.map((a, idx) => (
            <div
              key={a.id}
              className="grid grid-cols-12 items-center gap-4 px-5 py-3"
              style={{
                animation: `fadeInUp 0.4s ease-out ${Math.min(idx * 25, 250)}ms backwards`,
              }}
            >
              <div className="col-span-3 flex min-w-0 items-center gap-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border border-accent/30 bg-accent/10 text-accent">
                  <Robot size={13} weight="bold" />
                </span>
                <span className="truncate font-mono text-xs text-base-content">{a.name}</span>
              </div>
              <div className="col-span-2">
                <RoleBadge role={a.role} />
              </div>
              <div className="col-span-5 min-w-0">
                <span className="inline-flex items-center gap-2 rounded-sm border border-base-300 bg-base-200/50 px-2 py-1 font-mono text-[11px] text-base-content/80">
                  <Key size={11} weight="bold" className="text-base-content/50" />
                  {a.apiKeyMasked}
                </span>
              </div>
              <div className="col-span-2 text-right font-mono text-xs text-base-content/50">
                {formatDate(a.createdAt)}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Modals */}
      <InviteUserModal
        open={inviteOpen}
        onClose={() => !inviteBusy && setInviteOpen(false)}
        onInvite={invite}
        busy={inviteBusy}
      />
      <CreateAgentModal
        open={createAgentOpen}
        onClose={closeCreateAgent}
        onCreate={createAgent}
        createdAgent={createdAgent}
        busy={createAgentBusy}
      />

      {/* Role change confirm */}
      <ConfirmDialog
        open={!!pendingRoleChange}
        tone="normal"
        title={pendingRoleChange ? `${pendingRoleChange.user.name} のロールを変更しますか？` : ""}
        description={
          pendingRoleChange
            ? `現在のロール「${pendingRoleChange.user.role}」を「${pendingRoleChange.nextRole}」に変更します。該当ユーザーの操作権限が即時に更新されます。`
            : undefined
        }
        confirmLabel="変更する"
        cancelLabel="キャンセル"
        onConfirm={() => void confirmRoleChange()}
        onCancel={() => setPendingRoleChange(null)}
      />

      <style jsx>{`
        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(4px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </SettingsShell>
  );
}
