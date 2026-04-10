/**
 * 設定: アカウント接続管理
 *
 * Task 3008 (settings/accounts): X / LINE / Instagram のアカウント接続・切断・再接続 UI。
 *
 * 機能:
 *  - 接続済みアカウント一覧（platform icon / 名前 / status / expiry / actions）
 *  - expired 警告 + 再接続ボタン
 *  - 新規接続（プラットフォーム選択 → OAuth URL を新しいウィンドウで開く）
 *  - 切断（確認ダイアログ）
 *  - RBAC: viewer/operator/editor は読み取り専用、admin/owner は全操作
 *
 * API:
 *  - GET    /api/accounts
 *  - POST   /api/accounts  { platform }  → { data: { authorizationUrl, state } }
 *  - DELETE /api/accounts/:id
 *  - POST   /api/accounts/:id/refresh
 *
 * デザイン方針: 「Operations Ledger」系紙面デザイン（Fraunces + DM Sans、暖色、罫線）。
 */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Plus,
  ArrowsClockwise,
  Warning,
  WarningOctagon,
  CheckCircle,
  Clock,
  LinkBreak,
  X,
  Lock,
  ArrowSquareOut,
} from "@phosphor-icons/react";

import { SettingsShell } from "@/components/settings/SettingsShell";
import { PlatformIcon, PLATFORM_VISUALS } from "@/components/settings/PlatformIcon";
import type { Platform } from "@/components/settings/PlatformIcon";
import { ConfirmDialog } from "@/components/settings/ConfirmDialog";
import { useCurrentRole } from "@/components/settings/useCurrentRole";
import { RoleBadge } from "@/components/settings/RoleBadge";

// ───────────────────────────────────────────
// 型
// ───────────────────────────────────────────

type AccountStatus = "active" | "expired" | "revoked" | "error";

interface SocialAccount {
  id: string;
  workspaceId: string;
  platform: Platform;
  displayName: string;
  externalAccountId: string;
  tokenExpiresAt: string | null;
  status: AccountStatus;
  createdAt: string;
  updatedAt: string;
}

interface ListResponse {
  data: SocialAccount[];
}

interface ConnectResponse {
  data: {
    authorizationUrl?: string;
    state?: string;
  };
}

// ───────────────────────────────────────────
// ユーティリティ
// ───────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
}

function timeUntil(iso: string | null): { label: string; critical: boolean } {
  if (!iso) return { label: "—", critical: false };
  const d = new Date(iso).getTime();
  const now = Date.now();
  const diff = d - now;
  if (Number.isNaN(d)) return { label: "—", critical: false };
  if (diff < 0) return { label: "期限切れ", critical: true };
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days > 30) return { label: `${days} 日後`, critical: false };
  if (days > 7) return { label: `${days} 日後`, critical: false };
  if (days >= 1) return { label: `${days} 日後`, critical: true };
  const hours = Math.floor(diff / (1000 * 60 * 60));
  return { label: `${hours} 時間後`, critical: true };
}

// ───────────────────────────────────────────
// Status badge
// ───────────────────────────────────────────

function StatusBadge({ status }: { status: AccountStatus }) {
  const map: Record<AccountStatus, { label: string; cls: string; Icon: typeof CheckCircle }> = {
    active: {
      label: "active",
      cls: "border-primary/40 bg-primary/10 text-primary",
      Icon: CheckCircle,
    },
    expired: {
      label: "expired",
      cls: "border-warning/50 bg-warning/15 text-[#7a4b00]",
      Icon: Clock,
    },
    revoked: {
      label: "revoked",
      cls: "border-base-content/30 bg-base-content/10 text-base-content/70",
      Icon: LinkBreak,
    },
    error: {
      label: "error",
      cls: "border-error/40 bg-error/10 text-error",
      Icon: WarningOctagon,
    },
  };
  const entry = map[status];
  const Icon = entry.Icon;
  return (
    <span
      className={`inline-flex h-6 items-center gap-1 rounded-sm border px-2 font-mono text-[10px] font-bold uppercase tracking-[0.15em] ${entry.cls}`}
    >
      <Icon size={11} weight="bold" />
      {entry.label}
    </span>
  );
}

// ───────────────────────────────────────────
// 新規接続モーダル
// ───────────────────────────────────────────

function ConnectModal({
  open,
  onClose,
  onSelect,
  loadingPlatform,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (platform: Platform) => void;
  loadingPlatform: Platform | null;
}) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  const platforms: Platform[] = ["x", "line", "instagram"];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="新規アカウント接続"
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute inset-0 bg-secondary/60 backdrop-blur-sm"
        aria-label="閉じる"
      />
      <div
        className="relative w-full max-w-2xl overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-2xl"
        style={{ animation: "connectIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)" }}
      >
        <div className="relative border-b-2 border-dashed border-base-300 bg-gradient-to-b from-base-200/60 to-base-100 px-6 pb-5 pt-5">
          <button
            type="button"
            onClick={onClose}
            className="btn btn-sm btn-circle btn-ghost absolute right-3 top-3"
            aria-label="閉じる"
          >
            <X size={16} weight="bold" />
          </button>
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-base-content/50">
            connect new account
          </div>
          <h2
            className="mt-1 font-display text-2xl font-semibold leading-tight text-base-content"
            style={{ fontFamily: "'Fraunces', serif" }}
          >
            接続するプラットフォームを選択
          </h2>
          <p className="mt-2 text-sm text-base-content/60">
            OAuth
            認証は新しいウィンドウで実行されます。認証完了後、自動的にアカウントが一覧に追加されます。
          </p>
        </div>
        <div className="grid gap-4 px-6 py-6 sm:grid-cols-3">
          {platforms.map((p) => {
            const visual = PLATFORM_VISUALS[p];
            const loading = loadingPlatform === p;
            return (
              <button
                key={p}
                type="button"
                onClick={() => onSelect(p)}
                disabled={!!loadingPlatform}
                className="group relative flex flex-col items-start gap-3 rounded-sm border border-base-300 bg-base-100 p-5 text-left transition-all hover:-translate-y-0.5 hover:border-accent/60 hover:shadow-lg disabled:opacity-60"
              >
                <PlatformIcon platform={p} size={48} />
                <div>
                  <div
                    className="font-display text-lg font-semibold text-base-content"
                    style={{ fontFamily: "'Fraunces', serif" }}
                  >
                    {visual.label}
                  </div>
                  <div className="font-mono text-[10px] uppercase tracking-wider text-base-content/50">
                    {p}
                  </div>
                </div>
                <div className="mt-1 flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-base-content/60 group-hover:text-accent">
                  {loading ? (
                    <>
                      <ArrowsClockwise size={11} className="animate-spin" />
                      opening…
                    </>
                  ) : (
                    <>
                      <ArrowSquareOut size={11} weight="bold" />
                      open oauth
                    </>
                  )}
                </div>
              </button>
            );
          })}
        </div>
        <style jsx>{`
          @keyframes connectIn {
            from {
              opacity: 0;
              transform: translateY(12px) scale(0.98);
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
// メインページ
// ───────────────────────────────────────────

export default function AccountsSettingsPage() {
  const { role, isAdmin } = useCurrentRole();

  const [accounts, setAccounts] = useState<SocialAccount[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [connectOpen, setConnectOpen] = useState(false);
  const [connectLoading, setConnectLoading] = useState<Platform | null>(null);

  const [disconnectTarget, setDisconnectTarget] = useState<SocialAccount | null>(null);
  const [disconnectLoading, setDisconnectLoading] = useState(false);

  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionTone, setActionTone] = useState<"info" | "error">("info");

  // ───────── fetch accounts ─────────
  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/accounts", { credentials: "include" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: { message?: string } })?.error?.message ??
            `Failed to fetch accounts (status ${res.status})`,
        );
      }
      const json = (await res.json()) as ListResponse;
      setAccounts(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAccounts();
  }, [fetchAccounts]);

  // ───────── actions ─────────
  const startConnect = async (platform: Platform) => {
    if (!isAdmin) return;
    setConnectLoading(platform);
    setActionMessage(null);
    try {
      const res = await fetch("/api/accounts", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-Idempotency-Key":
            globalThis.crypto && "randomUUID" in globalThis.crypto
              ? globalThis.crypto.randomUUID()
              : `connect-${Date.now()}`,
        },
        body: JSON.stringify({ platform }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: { message?: string } })?.error?.message ??
            `Failed to start OAuth (status ${res.status})`,
        );
      }
      const json = (await res.json()) as ConnectResponse;
      const url = json.data?.authorizationUrl;
      if (url) {
        // 新しいウィンドウで OAuth URL を開く
        window.open(url, "_blank", "noopener,noreferrer");
        setActionTone("info");
        setActionMessage(
          `${PLATFORM_VISUALS[platform].label} の OAuth ウィンドウを開きました。認証完了後にこのページを再読み込みしてください。`,
        );
      } else {
        setActionTone("error");
        setActionMessage("OAuth URL が返却されませんでした。");
      }
      setConnectOpen(false);
    } catch (err) {
      setActionTone("error");
      setActionMessage(err instanceof Error ? err.message : "接続開始に失敗しました");
    } finally {
      setConnectLoading(null);
    }
  };

  const reconnect = async (account: SocialAccount) => {
    if (!isAdmin) return;
    // 既存アカウントの再接続も「新規接続フロー」と同じ OAuth URL 取得経路を使う
    await startConnect(account.platform);
  };

  const performDisconnect = async () => {
    if (!disconnectTarget) return;
    setDisconnectLoading(true);
    setActionMessage(null);
    try {
      const res = await fetch(`/api/accounts/${disconnectTarget.id}`, {
        method: "DELETE",
        credentials: "include",
        headers: {
          "X-Idempotency-Key":
            globalThis.crypto && "randomUUID" in globalThis.crypto
              ? globalThis.crypto.randomUUID()
              : `disconnect-${Date.now()}`,
        },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: { message?: string } })?.error?.message ??
            `Failed to disconnect (status ${res.status})`,
        );
      }
      setActionTone("info");
      setActionMessage(`${disconnectTarget.displayName} を切断しました。`);
      setDisconnectTarget(null);
      await fetchAccounts();
    } catch (err) {
      setActionTone("error");
      setActionMessage(err instanceof Error ? err.message : "切断に失敗しました");
    } finally {
      setDisconnectLoading(false);
    }
  };

  const hasExpired = useMemo(
    () => (accounts ?? []).some((a) => a.status === "expired"),
    [accounts],
  );

  // ───────── render ─────────
  return (
    <SettingsShell
      activeSlug="accounts"
      eyebrow="settings / accounts"
      title="Connected Accounts"
      description="SNS アカウントの接続状態と OAuth トークンの有効期限を管理します。期限切れの接続には再認証が必要です。"
      actions={
        <>
          <div className="rounded-sm border border-base-300 bg-base-100 px-3 py-2 text-right font-mono text-[11px] leading-tight">
            <div className="text-base-content/50">TOTAL</div>
            <div className="text-lg font-bold text-base-content">
              {accounts?.length?.toString() ?? "—"}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void fetchAccounts()}
            disabled={loading}
            className="btn btn-sm gap-2 rounded-sm border-base-300 bg-base-100 font-mono text-xs uppercase tracking-wider hover:border-primary hover:bg-primary/5"
            aria-label="再読み込み"
          >
            <ArrowsClockwise size={14} weight="bold" className={loading ? "animate-spin" : ""} />
            refresh
          </button>
          {isAdmin && (
            <button
              type="button"
              onClick={() => setConnectOpen(true)}
              className="btn btn-sm gap-2 rounded-sm border-none bg-primary font-mono text-xs uppercase tracking-wider text-primary-content hover:bg-primary/90"
            >
              <Plus size={14} weight="bold" />
              new connection
            </button>
          )}
        </>
      }
    >
      {/* role notice */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-base-300/70 bg-base-200/40 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-base-content/50">
            current role
          </span>
          <RoleBadge role={role} />
          {!isAdmin && (
            <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-base-content/50">
              <Lock size={11} weight="bold" />
              read-only
            </span>
          )}
        </div>
        <p className="font-mono text-[10px] uppercase tracking-wider text-base-content/40">
          {isAdmin ? "all operations available" : "admin / owner で接続・切断が可能"}
        </p>
      </div>

      {/* expired warning banner */}
      {hasExpired && (
        <div className="flex items-start gap-3 rounded-sm border border-warning/50 bg-warning/10 px-4 py-3">
          <Warning size={20} weight="fill" className="mt-0.5 shrink-0 text-[#b07300]" />
          <div className="flex-1 text-sm text-base-content/80">
            <p className="font-semibold text-[#7a4b00]">トークン期限切れのアカウントがあります</p>
            <p className="mt-0.5 text-xs text-base-content/60">
              該当行の「再接続」ボタンから再認証を完了してください。期限切れのアカウントでは投稿・取得が実行できません。
            </p>
          </div>
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

      {/* table */}
      <section className="overflow-hidden rounded-box border border-base-300 bg-base-100">
        <div className="grid grid-cols-12 gap-4 border-b border-base-300 bg-base-200/50 px-5 py-3 font-mono text-[10px] uppercase tracking-[0.15em] text-base-content/60">
          <div className="col-span-4">account</div>
          <div className="col-span-2">status</div>
          <div className="col-span-3">token expires</div>
          <div className="col-span-3 text-right">actions</div>
        </div>

        <div className="divide-y divide-base-300/60">
          {loading && !accounts && (
            <div className="px-5 py-16 text-center">
              <div className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-base-content/50">
                <ArrowsClockwise size={14} className="animate-spin" />
                loading accounts…
              </div>
            </div>
          )}

          {error && (
            <div className="px-5 py-12 text-center">
              <WarningOctagon size={32} weight="duotone" className="mx-auto text-error" />
              <p className="mt-2 font-mono text-xs text-error">{error}</p>
              <button
                type="button"
                onClick={() => void fetchAccounts()}
                className="btn btn-xs mt-3 rounded-sm border-base-300 font-mono text-[10px] uppercase"
              >
                retry
              </button>
            </div>
          )}

          {!loading && !error && accounts && accounts.length === 0 && (
            <div className="px-5 py-16 text-center">
              <p
                className="font-display text-lg text-base-content/40"
                style={{ fontFamily: "'Fraunces', serif" }}
              >
                No connected accounts
              </p>
              <p className="mt-1 font-mono text-xs text-base-content/40">
                {isAdmin
                  ? "「new connection」ボタンから最初のアカウントを接続してください"
                  : "アカウントが接続されていません。admin / owner に依頼してください"}
              </p>
            </div>
          )}

          {accounts?.map((account, idx) => {
            const visual = PLATFORM_VISUALS[account.platform];
            const expiry = timeUntil(account.tokenExpiresAt);
            const isExpired = account.status === "expired";
            return (
              <div
                key={account.id}
                className="grid grid-cols-12 items-center gap-4 px-5 py-4"
                style={{
                  animation: `fadeInUp 0.4s ease-out ${Math.min(idx * 30, 300)}ms backwards`,
                }}
              >
                {/* account */}
                <div className="col-span-4 flex min-w-0 items-center gap-3">
                  <PlatformIcon platform={account.platform} size={40} />
                  <div className="min-w-0">
                    <div
                      className="truncate font-display text-base font-semibold text-base-content"
                      style={{ fontFamily: "'Fraunces', serif" }}
                    >
                      {account.displayName}
                    </div>
                    <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-base-content/50">
                      <span>{visual.label}</span>
                      <span className="inline-block h-1 w-1 rounded-full bg-base-content/30" />
                      <span className="truncate">{account.externalAccountId}</span>
                    </div>
                  </div>
                </div>

                {/* status */}
                <div className="col-span-2">
                  <StatusBadge status={account.status} />
                </div>

                {/* expiry */}
                <div className="col-span-3">
                  <div className="font-mono text-xs text-base-content/80">
                    {formatDate(account.tokenExpiresAt)}
                  </div>
                  <div
                    className={`font-mono text-[10px] uppercase tracking-wider ${
                      expiry.critical ? "text-error" : "text-base-content/50"
                    }`}
                  >
                    {expiry.label}
                  </div>
                </div>

                {/* actions */}
                <div className="col-span-3 flex items-center justify-end gap-2">
                  {isAdmin ? (
                    <>
                      {isExpired && (
                        <button
                          type="button"
                          onClick={() => void reconnect(account)}
                          className="btn btn-xs gap-1 rounded-sm border-none bg-warning/90 font-mono text-[10px] uppercase tracking-wider text-[#5a3500] hover:bg-warning"
                          aria-label={`${account.displayName} を再接続`}
                        >
                          <ArrowsClockwise size={11} weight="bold" />
                          reconnect
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setDisconnectTarget(account)}
                        className="btn btn-xs gap-1 rounded-sm border-base-300 bg-base-100 font-mono text-[10px] uppercase tracking-wider text-error hover:border-error/60 hover:bg-error/5"
                        aria-label={`${account.displayName} を切断`}
                      >
                        <LinkBreak size={11} weight="bold" />
                        disconnect
                      </button>
                    </>
                  ) : (
                    <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-base-content/40">
                      <Lock size={10} weight="bold" />
                      read-only
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* connect modal */}
      <ConnectModal
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        onSelect={(p) => void startConnect(p)}
        loadingPlatform={connectLoading}
      />

      {/* disconnect dialog */}
      <ConfirmDialog
        open={!!disconnectTarget}
        tone="destructive"
        title={`${disconnectTarget?.displayName ?? ""} を切断しますか？`}
        description={
          disconnectTarget
            ? `${PLATFORM_VISUALS[disconnectTarget.platform].label} のアカウント接続を削除します。保存済みの投稿や監査ログは残りますが、以降このアカウントでの投稿・取得はできなくなります。再接続には再度 OAuth 認証が必要です。`
            : undefined
        }
        confirmLabel="切断する"
        cancelLabel="キャンセル"
        onConfirm={() => void performDisconnect()}
        onCancel={() => !disconnectLoading && setDisconnectTarget(null)}
        loading={disconnectLoading}
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
