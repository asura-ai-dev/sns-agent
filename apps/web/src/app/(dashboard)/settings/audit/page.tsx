"use client";

/**
 * 監査ログ画面
 *
 * Task 6001: /settings/audit
 * フィルタバー + ログテーブル + 詳細モーダル + ページネーション。
 *
 * デザイン方針: 「Operations Ledger」
 * - 暖色の紙面（#FFFDF8）に罫線、Fraunces display / DM Sans body
 * - Actor タイプは形状と色で区別（丸=user, 角=agent, ダイヤ=system）
 * - 詳細モーダルは receipt 風の JSON 表示
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  MagnifyingGlass,
  FunnelSimple,
  ArrowsClockwise,
  CaretLeft,
  CaretRight,
  X,
  CheckCircle,
  XCircle,
  User,
  Robot,
  Cpu,
  Copy,
  Export,
} from "@phosphor-icons/react";
import { MASTHEAD_TITLES, SECTION_KICKERS } from "@/lib/i18n/labels";

// ───────────────────────────────────────────
// 型定義
// ───────────────────────────────────────────

type AuditActorType = "user" | "agent" | "system";
type Platform = "x" | "line" | "instagram";

interface AuditLog {
  id: string;
  workspaceId: string;
  actorId: string;
  actorType: AuditActorType;
  action: string;
  resourceType: string;
  resourceId: string | null;
  platform: string | null;
  socialAccountId: string | null;
  inputSummary: unknown | null;
  resultSummary: unknown | null;
  estimatedCostUsd: number | null;
  requestId: string | null;
  createdAt: string;
}

interface AuditListResponse {
  data: AuditLog[];
  meta: { page: number; limit: number; total: number };
}

interface Filters {
  actorId: string;
  actorType: "" | AuditActorType;
  action: string;
  platform: "" | Platform;
  from: string;
  to: string;
}

const EMPTY_FILTERS: Filters = {
  actorId: "",
  actorType: "",
  action: "",
  platform: "",
  from: "",
  to: "",
};

const PAGE_SIZE = 25;

// ───────────────────────────────────────────
// ユーティリティ
// ───────────────────────────────────────────

function formatDateTime(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return { date: "—", time: "" };
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
  };
}

function formatCost(cost: number | null): string {
  if (cost === null || cost === undefined) return "—";
  if (cost === 0) return "$0.00";
  if (cost < 0.01) return `$${cost.toFixed(6)}`;
  return `$${cost.toFixed(4)}`;
}

function isSuccess(log: AuditLog): boolean {
  const rs = log.resultSummary as { success?: boolean; status?: number } | null;
  if (rs && typeof rs.success === "boolean") return rs.success;
  if (rs && typeof rs.status === "number") return rs.status >= 200 && rs.status < 400;
  return true;
}

function buildQueryString(filters: Filters, page: number): string {
  const params = new URLSearchParams();
  if (filters.actorId) params.set("actorId", filters.actorId);
  if (filters.actorType) params.set("actorType", filters.actorType);
  if (filters.action) params.set("action", filters.action);
  if (filters.platform) params.set("platform", filters.platform);
  if (filters.from) params.set("from", new Date(filters.from).toISOString());
  if (filters.to) params.set("to", new Date(filters.to + "T23:59:59").toISOString());
  params.set("page", String(page));
  params.set("limit", String(PAGE_SIZE));
  return params.toString();
}

// ───────────────────────────────────────────
// Actor バッジ（形状で種別を区別）
// ───────────────────────────────────────────

function ActorBadge({ type, id }: { type: AuditActorType; id: string }) {
  const short = id.slice(0, 8);
  if (type === "user") {
    return (
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-primary">
          <User size={13} weight="bold" />
        </span>
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="font-mono text-[11px] uppercase tracking-wider text-base-content/50">
            user
          </span>
          <span className="truncate font-mono text-xs text-base-content/80">{short}</span>
        </div>
      </div>
    );
  }
  if (type === "agent") {
    return (
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border border-accent/30 bg-accent/10 text-accent">
          <Robot size={13} weight="bold" />
        </span>
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="font-mono text-[11px] uppercase tracking-wider text-base-content/50">
            agent
          </span>
          <span className="truncate font-mono text-xs text-base-content/80">{short}</span>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-7 w-7 shrink-0 rotate-45 items-center justify-center border border-base-content/30 bg-base-content/10 text-base-content/70">
        <span className="-rotate-45">
          <Cpu size={13} weight="bold" />
        </span>
      </span>
      <div className="flex min-w-0 flex-col leading-tight">
        <span className="font-mono text-[11px] uppercase tracking-wider text-base-content/50">
          system
        </span>
        <span className="truncate font-mono text-xs text-base-content/80">{short}</span>
      </div>
    </div>
  );
}

function PlatformChip({ platform }: { platform: string | null }) {
  if (!platform) return <span className="font-mono text-xs text-base-content/30">—</span>;
  const map: Record<string, { label: string; color: string }> = {
    x: { label: "X", color: "bg-black text-white" },
    line: { label: "LINE", color: "bg-[#06C755] text-white" },
    instagram: { label: "IG", color: "bg-gradient-to-br from-[#F77737] to-[#FD1D1D] text-white" },
  };
  const entry = map[platform] ?? { label: platform, color: "bg-base-200 text-base-content" };
  return (
    <span
      className={`inline-flex h-6 items-center rounded-sm px-2 font-mono text-[10px] font-bold uppercase tracking-wider ${entry.color}`}
    >
      {entry.label}
    </span>
  );
}

// ───────────────────────────────────────────
// メインコンポーネント
// ───────────────────────────────────────────

export default function AuditPage() {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [response, setResponse] = useState<AuditListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AuditLog | null>(null);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = buildQueryString(appliedFilters, page);
      const res = await fetch(`/api/audit?${qs}`, {
        headers: {
          // 認証は外部プロキシまたはセッション経由で付与される想定
          // dev 環境では X-Session-User-Id でオーバーライド可能
        },
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          body?.error?.message ?? `監査ログの取得に失敗しました（status ${res.status}）`,
        );
      }
      const json = (await res.json()) as AuditListResponse;
      setResponse(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "監査ログの取得に失敗しました");
      setResponse(null);
    } finally {
      setLoading(false);
    }
  }, [appliedFilters, page]);

  useEffect(() => {
    void fetchLogs();
  }, [fetchLogs]);

  const totalPages = useMemo(() => {
    if (!response) return 1;
    return Math.max(1, Math.ceil(response.meta.total / response.meta.limit));
  }, [response]);

  const applyFilters = () => {
    setAppliedFilters(filters);
    setPage(1);
  };

  const resetFilters = () => {
    setFilters(EMPTY_FILTERS);
    setAppliedFilters(EMPTY_FILTERS);
    setPage(1);
  };

  const exportLogs = async () => {
    const params = new URLSearchParams();
    if (appliedFilters.actorId) params.set("actorId", appliedFilters.actorId);
    if (appliedFilters.actorType) params.set("actorType", appliedFilters.actorType);
    if (appliedFilters.action) params.set("action", appliedFilters.action);
    if (appliedFilters.platform) params.set("platform", appliedFilters.platform);
    if (appliedFilters.from) params.set("from", new Date(appliedFilters.from).toISOString());
    if (appliedFilters.to)
      params.set("to", new Date(appliedFilters.to + "T23:59:59").toISOString());
    params.set("format", "json");
    params.set("export", "true");

    const res = await fetch(`/api/audit?${params.toString()}`, {
      credentials: "include",
    });
    if (!res.ok) return;
    const json = await res.json();
    const blob = new Blob([JSON.stringify(json.data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-logs-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* ────────── Ledger header ────────── */}
      <header className="relative overflow-hidden rounded-box border border-base-300 bg-gradient-to-br from-base-100 via-base-100 to-base-200/60 px-6 py-6">
        {/* Subtle paper grain */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(0deg, #000 0px, #000 1px, transparent 1px, transparent 28px)",
          }}
        />
        {/* Accent ruler line */}
        <div className="pointer-events-none absolute inset-x-6 top-16 h-px bg-gradient-to-r from-transparent via-accent/40 to-transparent" />

        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-base-content/50">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary" />
              {SECTION_KICKERS.settingsAudit}
            </p>
            <h1
              className="mt-2 font-display text-4xl font-semibold leading-none tracking-tight text-base-content"
              style={{ fontFamily: "'Fraunces', serif", fontFeatureSettings: "'ss01', 'ss02'" }}
            >
              {MASTHEAD_TITLES.settingsAudit}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <div className="rounded-sm border border-base-300 bg-base-100 px-3 py-2 text-right font-mono text-[11px] leading-tight">
              <div className="text-base-content/50">TOTAL RECORDS</div>
              <div className="text-lg font-bold text-base-content">
                {response?.meta.total?.toLocaleString() ?? "—"}
              </div>
            </div>
            <button
              onClick={() => void fetchLogs()}
              disabled={loading}
              className="btn btn-sm gap-2 rounded-sm border-base-300 bg-base-100 font-mono text-xs uppercase tracking-wider hover:border-primary hover:bg-primary/5"
              aria-label="再読み込み"
            >
              <ArrowsClockwise size={14} weight="bold" className={loading ? "animate-spin" : ""} />
              再読み込み
            </button>
            <button
              onClick={() => void exportLogs()}
              className="btn btn-sm gap-2 rounded-sm border-secondary bg-secondary font-mono text-xs uppercase tracking-wider text-secondary-content hover:bg-secondary/90"
            >
              <Export size={14} weight="bold" />
              エクスポート
            </button>
          </div>
        </div>
      </header>

      {/* ────────── Filter bar ────────── */}
      <section className="rounded-box border border-base-300 bg-base-100">
        <div className="flex items-center gap-2 border-b border-base-300/70 px-5 py-3">
          <FunnelSimple size={16} weight="bold" className="text-accent" />
          <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-base-content/60">
            filters
          </span>
        </div>
        <div className="grid gap-4 px-5 py-5 md:grid-cols-2 lg:grid-cols-6">
          {/* Actor search */}
          <div className="lg:col-span-2">
            <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-base-content/50">
              アクター ID
            </label>
            <div className="relative">
              <MagnifyingGlass
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base-content/40"
              />
              <input
                type="text"
                value={filters.actorId}
                onChange={(e) => setFilters({ ...filters, actorId: e.target.value })}
                placeholder="例: user_1234abcd"
                className="input input-sm w-full rounded-sm border-base-300 bg-base-100 pl-8 font-mono text-xs focus:border-primary focus:outline-none"
              />
            </div>
          </div>

          {/* Actor type */}
          <div>
            <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-base-content/50">
              種別
            </label>
            <select
              value={filters.actorType}
              onChange={(e) =>
                setFilters({ ...filters, actorType: e.target.value as Filters["actorType"] })
              }
              className="select select-sm w-full rounded-sm border-base-300 bg-base-100 font-mono text-xs focus:border-primary focus:outline-none"
            >
              <option value="">すべて</option>
              <option value="user">user</option>
              <option value="agent">agent</option>
              <option value="system">system</option>
            </select>
          </div>

          {/* Platform */}
          <div>
            <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-base-content/50">
              プラットフォーム
            </label>
            <select
              value={filters.platform}
              onChange={(e) =>
                setFilters({ ...filters, platform: e.target.value as Filters["platform"] })
              }
              className="select select-sm w-full rounded-sm border-base-300 bg-base-100 font-mono text-xs focus:border-primary focus:outline-none"
            >
              <option value="">すべて</option>
              <option value="x">x</option>
              <option value="line">line</option>
              <option value="instagram">instagram</option>
            </select>
          </div>

          {/* Action */}
          <div>
            <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-base-content/50">
              アクション
            </label>
            <input
              type="text"
              value={filters.action}
              onChange={(e) => setFilters({ ...filters, action: e.target.value })}
              placeholder="例: POST /api/posts"
              className="input input-sm w-full rounded-sm border-base-300 bg-base-100 font-mono text-xs focus:border-primary focus:outline-none"
            />
          </div>

          {/* From date */}
          <div>
            <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-base-content/50">
              開始日
            </label>
            <input
              type="date"
              value={filters.from}
              onChange={(e) => setFilters({ ...filters, from: e.target.value })}
              className="input input-sm w-full rounded-sm border-base-300 bg-base-100 font-mono text-xs focus:border-primary focus:outline-none"
            />
          </div>

          {/* To date */}
          <div className="lg:col-span-2">
            <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-base-content/50">
              終了日
            </label>
            <input
              type="date"
              value={filters.to}
              onChange={(e) => setFilters({ ...filters, to: e.target.value })}
              className="input input-sm w-full rounded-sm border-base-300 bg-base-100 font-mono text-xs focus:border-primary focus:outline-none"
            />
          </div>

          {/* Buttons */}
          <div className="flex items-end gap-2 lg:col-span-4">
            <button
              onClick={applyFilters}
              className="btn btn-sm rounded-sm border-none bg-primary font-mono text-xs uppercase tracking-wider text-primary-content hover:bg-primary/90"
            >
              適用
            </button>
            <button
              onClick={resetFilters}
              className="btn btn-sm rounded-sm border-base-300 bg-base-100 font-mono text-xs uppercase tracking-wider hover:border-base-content/40"
            >
              リセット
            </button>
          </div>
        </div>
      </section>

      {/* ────────── Table ────────── */}
      <section className="overflow-hidden rounded-box border border-base-300 bg-base-100">
        {/* Table header */}
        <div className="grid grid-cols-12 gap-4 border-b border-base-300 bg-base-200/50 px-5 py-3 font-mono text-[10px] uppercase tracking-[0.15em] text-base-content/60">
          <div className="col-span-2">timestamp</div>
          <div className="col-span-2">actor</div>
          <div className="col-span-3">action</div>
          <div className="col-span-2">resource</div>
          <div className="col-span-1">sns</div>
          <div className="col-span-1 text-center">result</div>
          <div className="col-span-1 text-right">cost</div>
        </div>

        {/* Body */}
        <div className="divide-y divide-base-300/60">
          {loading && !response && (
            <div className="px-5 py-16 text-center">
              <div className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-base-content/50">
                <ArrowsClockwise size={14} className="animate-spin" />
                監査ログを読み込んでいます…
              </div>
            </div>
          )}

          {error && (
            <div className="px-5 py-12 text-center">
              <XCircle size={32} weight="duotone" className="mx-auto text-error" />
              <p className="mt-2 font-mono text-xs text-error">{error}</p>
              <button
                onClick={() => void fetchLogs()}
                className="btn btn-xs mt-3 rounded-sm border-base-300 font-mono text-[10px] uppercase"
              >
                再試行
              </button>
            </div>
          )}

          {!loading && !error && response && response.data.length === 0 && (
            <div className="px-5 py-16 text-center">
              <p className="font-display text-lg text-base-content/40">記録済みのログはありません</p>
              <p className="mt-1 font-mono text-xs text-base-content/40">
                条件に一致するログはありません
              </p>
            </div>
          )}

          {response?.data.map((log, idx) => {
            const { date, time } = formatDateTime(log.createdAt);
            const success = isSuccess(log);
            return (
              <button
                key={log.id}
                onClick={() => setSelected(log)}
                className="group grid w-full grid-cols-12 items-center gap-4 px-5 py-3 text-left transition-colors hover:bg-accent/5 focus:bg-accent/10 focus:outline-none"
                style={{
                  animation: `fadeInUp 0.4s ease-out ${Math.min(idx * 15, 300)}ms backwards`,
                }}
              >
                {/* Timestamp */}
                <div className="col-span-2 font-mono text-xs leading-tight">
                  <div className="text-base-content/90">{date}</div>
                  <div className="text-base-content/50">{time}</div>
                </div>

                {/* Actor */}
                <div className="col-span-2 min-w-0">
                  <ActorBadge type={log.actorType} id={log.actorId} />
                </div>

                {/* Action */}
                <div className="col-span-3 min-w-0">
                  <div className="truncate font-mono text-xs text-base-content/90 group-hover:text-accent">
                    {log.action}
                  </div>
                </div>

                {/* Resource */}
                <div className="col-span-2 min-w-0">
                  <div className="truncate">
                    <span className="inline-flex items-center rounded-sm border border-base-300 bg-base-200/50 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-base-content/70">
                      {log.resourceType}
                    </span>
                    {log.resourceId && (
                      <div className="mt-0.5 truncate font-mono text-[10px] text-base-content/40">
                        {log.resourceId.slice(0, 8)}
                      </div>
                    )}
                  </div>
                </div>

                {/* Platform */}
                <div className="col-span-1">
                  <PlatformChip platform={log.platform} />
                </div>

                {/* Result */}
                <div className="col-span-1 flex justify-center">
                  {success ? (
                    <CheckCircle size={18} weight="fill" className="text-primary" />
                  ) : (
                    <XCircle size={18} weight="fill" className="text-error" />
                  )}
                </div>

                {/* Cost */}
                <div className="col-span-1 text-right font-mono text-xs tabular-nums text-base-content/70">
                  {formatCost(log.estimatedCostUsd)}
                </div>
              </button>
            );
          })}
        </div>

        {/* Pagination */}
        {response && response.data.length > 0 && (
          <div className="flex items-center justify-between border-t border-base-300 bg-base-200/30 px-5 py-3">
            <p className="font-mono text-[11px] text-base-content/60">
              {(response.meta.page - 1) * response.meta.limit + 1}–
              {Math.min(response.meta.page * response.meta.limit, response.meta.total)} /{" "}
              {response.meta.total.toLocaleString()}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || loading}
                className="btn btn-xs rounded-sm border-base-300 bg-base-100 font-mono text-[10px] uppercase tracking-wider disabled:opacity-30"
                aria-label="前へ"
              >
                <CaretLeft size={12} weight="bold" />
                前へ
              </button>
              <div className="rounded-sm border border-base-300 bg-base-100 px-3 py-1 font-mono text-[11px]">
                <span className="text-base-content">{page}</span>
                <span className="text-base-content/40"> / {totalPages}</span>
              </div>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || loading}
                className="btn btn-xs rounded-sm border-base-300 bg-base-100 font-mono text-[10px] uppercase tracking-wider disabled:opacity-30"
                aria-label="次へ"
              >
                次へ
                <CaretRight size={12} weight="bold" />
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ────────── Detail modal ────────── */}
      {selected && <DetailModal log={selected} onClose={() => setSelected(null)} />}

      {/* Local animations */}
      <style>{`
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
    </div>
  );
}

// ───────────────────────────────────────────
// 詳細モーダル
// ───────────────────────────────────────────

function DetailModal({ log, onClose }: { log: AuditLog; onClose: () => void }) {
  const [copied, setCopied] = useState<string | null>(null);
  const { date, time } = formatDateTime(log.createdAt);
  const success = isSuccess(log);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const copyToClipboard = async (key: string, value: unknown) => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(value, null, 2));
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // noop
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="監査ログ詳細"
    >
      {/* Backdrop */}
      <button
        onClick={onClose}
        className="absolute inset-0 bg-secondary/60 backdrop-blur-sm"
        aria-label="閉じる"
      />

      {/* Content */}
      <div
        className="relative max-h-[85vh] w-full max-w-3xl overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-2xl"
        style={{ animation: "modalIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)" }}
      >
        {/* Receipt-like header with perforated edge */}
        <div className="relative border-b-2 border-dashed border-base-300 bg-gradient-to-b from-base-200/60 to-base-100 px-6 pb-5 pt-5">
          <button
            onClick={onClose}
            className="absolute right-3 top-3 btn btn-sm btn-circle btn-ghost"
            aria-label="閉じる"
          >
            <X size={16} weight="bold" />
          </button>

          <div className="flex items-start justify-between pr-10">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-base-content/50">
                audit record #{log.id.slice(0, 8)}
              </div>
              <h2
                className="mt-1 font-display text-2xl font-semibold leading-tight text-base-content"
                style={{ fontFamily: "'Fraunces', serif" }}
              >
                {log.action}
              </h2>
              <div className="mt-2 font-mono text-xs text-base-content/60">
                {date} · {time}
              </div>
            </div>
            <div
              className={`flex items-center gap-1.5 rounded-sm border px-2 py-1 font-mono text-[10px] uppercase tracking-wider ${
                success
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-error/40 bg-error/10 text-error"
              }`}
            >
              {success ? (
                <CheckCircle size={12} weight="fill" />
              ) : (
                <XCircle size={12} weight="fill" />
              )}
              {success ? "success" : "failure"}
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="max-h-[calc(85vh-200px)] overflow-y-auto">
          {/* Meta grid */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 border-b border-base-300/60 px-6 py-5 md:grid-cols-4">
            <MetaField label="actor type" value={log.actorType} />
            <MetaField label="actor id" value={log.actorId} mono />
            <MetaField label="resource" value={log.resourceType} />
            <MetaField label="platform" value={log.platform ?? "—"} />
            <MetaField label="resource id" value={log.resourceId ?? "—"} mono />
            <MetaField label="social account" value={log.socialAccountId ?? "—"} mono />
            <MetaField label="cost" value={formatCost(log.estimatedCostUsd)} />
            <MetaField label="request id" value={log.requestId ?? "—"} mono />
          </div>

          {/* Input / Result */}
          <div className="space-y-5 px-6 py-5">
            <JsonBlock
              title="input_summary"
              value={log.inputSummary}
              copyKey="input"
              copied={copied === "input"}
              onCopy={() => copyToClipboard("input", log.inputSummary)}
            />
            <JsonBlock
              title="result_summary"
              value={log.resultSummary}
              copyKey="result"
              copied={copied === "result"}
              onCopy={() => copyToClipboard("result", log.resultSummary)}
            />
          </div>
        </div>

        <style>{`
          @keyframes modalIn {
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

function MetaField({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-wider text-base-content/40">
        {label}
      </div>
      <div
        className={`mt-0.5 truncate text-xs text-base-content/90 ${mono ? "font-mono" : ""}`}
        title={value}
      >
        {value}
      </div>
    </div>
  );
}

function JsonBlock({
  title,
  value,
  copyKey: _copyKey,
  copied,
  onCopy,
}: {
  title: string;
  value: unknown;
  copyKey: string;
  copied: boolean;
  onCopy: () => void;
}) {
  const formatted = value === null || value === undefined ? "null" : JSON.stringify(value, null, 2);
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-base-content/60">
          {title}
        </h3>
        <button
          onClick={onCopy}
          className="btn btn-xs rounded-sm border-base-300 bg-base-100 font-mono text-[10px] uppercase tracking-wider"
        >
          <Copy size={10} weight="bold" />
          {copied ? "コピー済み" : "コピー"}
        </button>
      </div>
      <pre className="max-h-64 overflow-auto rounded-sm border border-base-300 bg-secondary/95 px-4 py-3 font-mono text-[11px] leading-relaxed text-secondary-content">
        <code>{formatted}</code>
      </pre>
    </div>
  );
}
