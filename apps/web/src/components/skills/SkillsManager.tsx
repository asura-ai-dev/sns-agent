/**
 * SkillsManager — Task 5005
 *
 * Client component that renders the Capabilities Gazette: a catalogue of
 * skill packages with generate / enable / disable / manifest-inspect flows.
 *
 * API endpoints:
 *  - GET    /api/skills
 *  - POST   /api/skills/generate   { platform, llmProvider }
 *  - PATCH  /api/skills/:id        { enabled }
 *  - GET    /api/skills/:id/manifest
 *
 * Design tone matches `BudgetPolicyManager` / `LlmRouteManager`: editorial
 * broadsheet with Fraunces + DM Sans, paper grain, mono eyebrows, uppercase
 * tracking, `wire offline` banner when the API is unreachable.
 */
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Package,
  Warning,
  ShieldWarning,
  X,
  Lightning,
  MagnifyingGlass,
  ArrowsClockwise,
  CheckCircle,
  Prohibit,
  Key,
} from "@phosphor-icons/react";

import { PlatformIcon, type Platform as UiPlatform } from "@/components/settings/PlatformIcon";
import type { SkillPackageDto } from "@/lib/api";
import { COMMON_ACTIONS } from "@/lib/i18n/labels";

interface SkillsManagerProps {
  initialPackages: SkillPackageDto[];
  isFallback: boolean;
}

// ───────────────────────────────────────────
// Option catalogues
// ───────────────────────────────────────────

const PLATFORM_CHOICES: { value: string; label: string }[] = [
  { value: "x", label: "X" },
  { value: "line", label: "LINE" },
  { value: "instagram", label: "Instagram" },
  { value: "common", label: "common（共通）" },
];

const PROVIDER_CHOICES: { value: string; label: string }[] = [
  { value: "openai", label: "openai" },
  { value: "anthropic", label: "anthropic" },
];

function getUiPlatform(value: string): UiPlatform | null {
  if (value === "x" || value === "line" || value === "instagram") return value;
  return null;
}

// ───────────────────────────────────────────
// API helpers (client)
// ───────────────────────────────────────────

function getApiBase(): string {
  const env = (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_SNS_AGENT_API_URL) || "";
  return env.replace(/\/+$/, "") || "http://localhost:3001";
}

async function apiFetch<T>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${getApiBase()}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(method !== "GET"
        ? {
            "X-Idempotency-Key":
              typeof crypto !== "undefined" && crypto.randomUUID
                ? crypto.randomUUID()
                : `${Date.now()}-${Math.random()}`,
          }
        : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { error?: { message?: string } };
      if (j?.error?.message) message = String(j.error.message);
    } catch {
      // noop
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ───────────────────────────────────────────
// Manifest types (loose; matches @sns-agent/skills)
// ───────────────────────────────────────────

interface ManifestJsonSchema {
  type?: string;
  description?: string;
  properties?: Record<string, ManifestJsonSchema>;
  required?: string[];
  items?: ManifestJsonSchema;
  enum?: Array<string | number | boolean | null>;
  minimum?: number;
  maximum?: number;
}

interface ManifestAction {
  name: string;
  description: string;
  parameters: ManifestJsonSchema;
  permissions: string[];
  requiredCapabilities: string[];
  readOnly?: boolean;
}

interface ManifestShape {
  name: string;
  version: string;
  platform: string;
  provider: string;
  description: string;
  actions: ManifestAction[];
}

interface ManifestResponse {
  data: {
    package: SkillPackageDto;
    manifest: ManifestShape;
  };
}

// ───────────────────────────────────────────
// Component
// ───────────────────────────────────────────

export function SkillsManager({ initialPackages, isFallback }: SkillsManagerProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [packages, setPackages] = useState<SkillPackageDto[]>(initialPackages);

  // Generate dialog
  const [generateOpen, setGenerateOpen] = useState(false);
  const [genPlatform, setGenPlatform] = useState<string>("x");
  const [genProvider, setGenProvider] = useState<string>("openai");
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  // Per-row toggle busy state + error
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);

  // Manifest modal
  const [detailPkg, setDetailPkg] = useState<SkillPackageDto | null>(null);
  const [detailManifest, setDetailManifest] = useState<ManifestShape | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  function openGenerate() {
    setGenPlatform("x");
    setGenProvider("openai");
    setGenerateError(null);
    setGenerateOpen(true);
  }

  function closeGenerate() {
    if (generating) return;
    setGenerateOpen(false);
    setGenerateError(null);
  }

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    setGenerating(true);
    setGenerateError(null);
    try {
      const res = await apiFetch<{ data: SkillPackageDto }>("POST", "/api/skills/generate", {
        platform: genPlatform,
        llmProvider: genProvider,
      });
      setPackages((prev) => [...prev, res.data]);
      setGenerateOpen(false);
      startTransition(() => router.refresh());
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : "生成に失敗しました");
    } finally {
      setGenerating(false);
    }
  }

  async function handleToggle(pkg: SkillPackageDto) {
    setTogglingId(pkg.id);
    setToggleError(null);
    try {
      const res = await apiFetch<{ data: SkillPackageDto }>("PATCH", `/api/skills/${pkg.id}`, {
        enabled: !pkg.enabled,
      });
      setPackages((prev) => prev.map((p) => (p.id === res.data.id ? res.data : p)));
      startTransition(() => router.refresh());
    } catch (err) {
      setToggleError(err instanceof Error ? err.message : "切り替えに失敗しました");
    } finally {
      setTogglingId(null);
    }
  }

  async function openDetail(pkg: SkillPackageDto) {
    setDetailPkg(pkg);
    setDetailManifest(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const res = await apiFetch<ManifestResponse>("GET", `/api/skills/${pkg.id}/manifest`);
      setDetailManifest(res.data.manifest);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "マニフェストの取得に失敗しました");
    } finally {
      setDetailLoading(false);
    }
  }

  function closeDetail() {
    setDetailPkg(null);
    setDetailManifest(null);
    setDetailError(null);
    setDetailLoading(false);
  }

  return (
    <div className="space-y-5">
      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-base-content/45">
            catalogue
          </div>
          <h2
            className="mt-0.5 font-display text-xl font-semibold text-base-content"
            style={{ fontFamily: "'Fraunces', serif" }}
          >
            Installed Packages{" "}
            <span className="ml-2 font-mono text-xs text-base-content/45">
              {packages.length} on file
            </span>
          </h2>
        </div>
        <button
          type="button"
          onClick={openGenerate}
          disabled={isFallback}
          className="inline-flex items-center gap-2 rounded-sm border border-base-content bg-base-content px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-base-100 transition-colors hover:bg-primary hover:border-primary disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus size={12} weight="bold" />
          パッケージ生成
        </button>
      </div>

      {isFallback && (
        <div className="flex items-start gap-2 rounded-sm border border-dashed border-warning/60 bg-warning/10 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.15em] text-[#7a4b00]">
          <Warning size={12} weight="bold" className="mt-0.5 shrink-0" />
          <span>回線オフライン · 生成・有効化は API 起動後に再試行してください</span>
        </div>
      )}

      {toggleError && (
        <div className="flex items-start gap-2 rounded-sm border border-error/40 bg-error/10 px-3 py-2 font-mono text-[11px] text-error">
          <ShieldWarning size={12} weight="bold" className="mt-0.5 shrink-0" />
          {toggleError}
          <button
            type="button"
            onClick={() => setToggleError(null)}
            aria-label="閉じる"
            className="ml-auto rounded-sm p-0.5 hover:bg-error/10"
          >
            <X size={12} weight="bold" />
          </button>
        </div>
      )}

      {/* Package list */}
      <div className="overflow-x-auto rounded-sm border border-base-content/15 bg-base-100">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-base-content/30 font-mono text-[9px] uppercase tracking-[0.18em] text-base-content/55">
              <th className="px-4 py-2.5 text-left font-medium">package</th>
              <th className="px-4 py-2.5 text-left font-medium">platform</th>
              <th className="px-4 py-2.5 text-left font-medium">provider</th>
              <th className="px-4 py-2.5 text-left font-medium">version</th>
              <th className="px-4 py-2.5 text-right font-medium tabular-nums">actions</th>
              <th className="px-4 py-2.5 text-left font-medium">status</th>
              <th className="px-4 py-2.5 text-right font-medium">&nbsp;</th>
            </tr>
          </thead>
          <tbody>
            {packages.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center">
                  <Package
                    size={22}
                    weight="regular"
                    className="mx-auto mb-2 text-base-content/30"
                    aria-hidden
                  />
                  <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-base-content/45">
                    パッケージはまだありません
                  </div>
                  <div className="mt-1 text-xs text-base-content/55">
                    Skills
                    パッケージがありません。右上の「パッケージ生成」から最初のパッケージを生成してください。
                  </div>
                </td>
              </tr>
            )}
            {packages.map((pkg) => {
              const uiPlatform = getUiPlatform(pkg.platform);
              const toggling = togglingId === pkg.id;
              return (
                <tr
                  key={pkg.id}
                  className="border-b border-dashed border-base-content/15 transition-colors hover:bg-accent/[0.03]"
                >
                  {/* package */}
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => void openDetail(pkg)}
                      className="group block max-w-xs text-left"
                    >
                      <div
                        className="truncate font-display text-base font-medium text-base-content group-hover:text-primary"
                        style={{ fontFamily: "'Fraunces', serif" }}
                      >
                        {pkg.name}
                      </div>
                      <div className="font-mono text-[9px] uppercase tracking-[0.15em] text-base-content/45">
                        id · {pkg.id.slice(0, 8)}
                      </div>
                    </button>
                  </td>
                  {/* platform */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {uiPlatform ? (
                        <PlatformIcon platform={uiPlatform} size={24} />
                      ) : (
                        <span
                          aria-hidden
                          className="inline-flex h-6 w-6 items-center justify-center rounded-sm border border-dashed border-base-content/30 font-display text-[10px] uppercase text-base-content/50"
                          style={{ fontFamily: "'Fraunces', serif" }}
                        >
                          *
                        </span>
                      )}
                      <span className="font-mono text-[11px] uppercase tracking-[0.15em] text-base-content/80">
                        {pkg.platform}
                      </span>
                    </div>
                  </td>
                  {/* llm provider */}
                  <td className="px-4 py-3 font-mono text-[11px] uppercase tracking-[0.15em] text-base-content/75">
                    {pkg.llmProvider}
                  </td>
                  {/* version */}
                  <td className="px-4 py-3">
                    <span
                      className="rounded-sm border border-base-content/20 px-1.5 py-0.5 font-display text-xs tabular-nums text-base-content/75"
                      style={{ fontFamily: "'Fraunces', serif" }}
                    >
                      v{pkg.version}
                    </span>
                  </td>
                  {/* action count */}
                  <td className="px-4 py-3 text-right">
                    <span
                      className="font-display text-lg font-semibold tabular-nums text-base-content"
                      style={{ fontFamily: "'Fraunces', serif" }}
                    >
                      {pkg.actionCount}
                    </span>
                    <div className="font-mono text-[9px] uppercase tracking-[0.15em] text-base-content/40">
                      declared
                    </div>
                  </td>
                  {/* status */}
                  <td className="px-4 py-3">
                    <span
                      className={
                        "inline-flex h-6 items-center gap-1 rounded-sm border px-2 font-mono text-[10px] font-bold uppercase tracking-[0.15em] " +
                        (pkg.enabled
                          ? "border-primary/40 bg-primary/10 text-primary"
                          : "border-base-content/30 bg-base-content/10 text-base-content/60")
                      }
                    >
                      {pkg.enabled ? (
                        <CheckCircle size={11} weight="bold" />
                      ) : (
                        <Prohibit size={11} weight="bold" />
                      )}
                      {pkg.enabled ? "有効" : "無効"}
                    </span>
                  </td>
                  {/* toggle + view */}
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void openDetail(pkg)}
                        aria-label="詳細"
                        className="rounded-sm p-1.5 text-base-content/50 transition-colors hover:bg-base-200 hover:text-base-content"
                      >
                        <MagnifyingGlass size={14} weight="regular" />
                      </button>
                      <label
                        className={
                          "relative inline-flex cursor-pointer items-center " +
                          (isFallback || toggling ? "pointer-events-none opacity-50" : "")
                        }
                        aria-label={pkg.enabled ? "無効化" : "有効化"}
                      >
                        <input
                          type="checkbox"
                          className="toggle toggle-sm toggle-primary"
                          checked={pkg.enabled}
                          disabled={isFallback || toggling}
                          onChange={() => void handleToggle(pkg)}
                        />
                      </label>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ─────────────── Generate Dialog ─────────────── */}
      {generateOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="generate-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          <div
            className="absolute inset-0 bg-secondary/40 backdrop-blur-[2px]"
            onClick={closeGenerate}
            aria-hidden
          />
          <div className="relative z-10 w-full max-w-md overflow-hidden rounded-box border border-base-content/25 bg-base-100 shadow-[4px_4px_0_rgba(0,0,0,0.1)]">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 opacity-[0.035]"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(0deg, #000 0px, #000 1px, transparent 1px, transparent 24px)",
              }}
            />
            <div className="relative">
              <div className="flex items-start justify-between border-b border-base-content/25 px-6 py-4">
                <div>
                  <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-base-content/45">
                    capabilities · commission
                  </div>
                  <h3
                    id="generate-modal-title"
                    className="mt-0.5 font-display text-2xl font-semibold text-base-content"
                    style={{ fontFamily: "'Fraunces', serif" }}
                  >
                    Package Generator
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={closeGenerate}
                  disabled={generating}
                  aria-label={COMMON_ACTIONS.close}
                  className="rounded-sm p-1.5 text-base-content/50 transition-colors hover:bg-base-200 hover:text-base-content"
                >
                  <X size={14} weight="bold" />
                </button>
              </div>

              <form onSubmit={handleGenerate} className="space-y-4 px-6 py-5">
                <div className="space-y-1.5">
                  <label className="font-mono text-[10px] uppercase tracking-[0.2em] text-base-content/60">
                    platform
                  </label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {PLATFORM_CHOICES.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setGenPlatform(opt.value)}
                        aria-pressed={genPlatform === opt.value}
                        className={
                          "flex items-center gap-2 rounded-sm border px-2.5 py-2 text-left transition-colors " +
                          (genPlatform === opt.value
                            ? "border-base-content bg-base-content text-base-100"
                            : "border-base-content/25 text-base-content/70 hover:border-base-content/55 hover:text-base-content")
                        }
                      >
                        {getUiPlatform(opt.value) ? (
                          <PlatformIcon
                            platform={getUiPlatform(opt.value) as UiPlatform}
                            size={20}
                          />
                        ) : (
                          <span className="inline-flex h-5 w-5 items-center justify-center rounded-sm border border-dashed border-current/40 text-[9px]">
                            *
                          </span>
                        )}
                        <span className="text-xs font-medium">{opt.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="font-mono text-[10px] uppercase tracking-[0.2em] text-base-content/60">
                    llm provider
                  </label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {PROVIDER_CHOICES.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setGenProvider(opt.value)}
                        aria-pressed={genProvider === opt.value}
                        className={
                          "rounded-sm border px-2.5 py-2 text-left transition-colors " +
                          (genProvider === opt.value
                            ? "border-base-content bg-base-content text-base-100"
                            : "border-base-content/25 text-base-content/70 hover:border-base-content/55 hover:text-base-content")
                        }
                      >
                        <span className="text-xs font-medium">{opt.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {generateError && (
                  <div className="flex items-start gap-2 rounded-sm border border-error/40 bg-error/10 px-3 py-2 font-mono text-[11px] text-error">
                    <ShieldWarning size={12} weight="bold" className="mt-0.5 shrink-0" />
                    {generateError}
                  </div>
                )}

                <div className="flex items-center justify-end gap-2 border-t border-base-content/15 pt-4">
                  <button
                    type="button"
                    onClick={closeGenerate}
                    disabled={generating}
                    className="rounded-sm border border-base-content/25 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-base-content/60 transition-colors hover:border-base-content/55 hover:text-base-content"
                  >
                    {COMMON_ACTIONS.cancel}
                  </button>
                  <button
                    type="submit"
                    disabled={generating}
                    className="inline-flex items-center gap-2 rounded-sm border border-primary bg-primary px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-primary-content transition-colors hover:bg-primary/90 disabled:opacity-50"
                  >
                    {generating ? (
                      <>
                        <ArrowsClockwise size={12} weight="bold" className="animate-spin" />
                        生成中…
                      </>
                    ) : (
                      <>
                        <Lightning size={12} weight="bold" />
                        パッケージ生成
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────── Manifest Detail Modal ─────────────── */}
      {detailPkg && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="manifest-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          <div
            className="absolute inset-0 bg-secondary/50 backdrop-blur-[2px]"
            onClick={closeDetail}
            aria-hidden
          />
          <div className="relative z-10 max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-box border border-base-content/25 bg-base-100 shadow-[4px_4px_0_rgba(0,0,0,0.12)]">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 opacity-[0.035]"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(0deg, #000 0px, #000 1px, transparent 1px, transparent 24px)",
              }}
            />
            <div className="relative flex max-h-[90vh] flex-col">
              {/* Masthead */}
              <div className="flex items-start justify-between border-b border-base-content/25 px-6 py-4">
                <div className="min-w-0">
                  <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-base-content/45">
                    manifest · specimen sheet
                  </div>
                  <h3
                    id="manifest-modal-title"
                    className="mt-0.5 truncate font-display text-2xl font-semibold text-base-content"
                    style={{ fontFamily: "'Fraunces', serif" }}
                  >
                    {detailPkg.name}
                  </h3>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-[0.15em] text-base-content/50">
                    <span>v{detailPkg.version}</span>
                    <span className="inline-block h-1 w-1 rounded-full bg-base-content/30" />
                    <span>{detailPkg.platform}</span>
                    <span className="inline-block h-1 w-1 rounded-full bg-base-content/30" />
                    <span>{detailPkg.llmProvider}</span>
                    <span className="inline-block h-1 w-1 rounded-full bg-base-content/30" />
                    <span>{detailPkg.actionCount} actions</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={closeDetail}
                  aria-label="閉じる"
                  className="rounded-sm p-1.5 text-base-content/50 transition-colors hover:bg-base-200 hover:text-base-content"
                >
                  <X size={14} weight="bold" />
                </button>
              </div>

              {/* Body */}
              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
                {detailLoading && (
                  <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.15em] text-base-content/50">
                    <ArrowsClockwise size={12} className="animate-spin" />
                    マニフェストを読み込み中…
                  </div>
                )}
                {detailError && (
                  <div className="flex items-start gap-2 rounded-sm border border-error/40 bg-error/10 px-3 py-2 font-mono text-[11px] text-error">
                    <ShieldWarning size={12} weight="bold" className="mt-0.5 shrink-0" />
                    {detailError}
                  </div>
                )}
                {detailManifest && (
                  <div className="space-y-5">
                    {detailManifest.description && (
                      <p className="text-sm leading-relaxed text-base-content/70">
                        {detailManifest.description}
                      </p>
                    )}
                    <div>
                      <div className="mb-2 flex items-baseline justify-between">
                        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-base-content/55">
                          declared actions
                        </span>
                        <span className="font-mono text-[10px] text-base-content/40">
                          {detailManifest.actions.length} total
                        </span>
                      </div>
                      <ul className="space-y-3">
                        {detailManifest.actions.map((action) => (
                          <li
                            key={action.name}
                            className="rounded-sm border border-base-content/20 bg-base-100/80 p-4"
                          >
                            <div className="flex flex-wrap items-baseline justify-between gap-2">
                              <div
                                className="font-display text-lg font-semibold text-base-content"
                                style={{ fontFamily: "'Fraunces', serif" }}
                              >
                                {action.name}
                              </div>
                              {action.readOnly && (
                                <span className="inline-flex h-5 items-center rounded-sm border border-info/40 bg-info/10 px-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.15em] text-info">
                                  読み取り専用
                                </span>
                              )}
                            </div>
                            <p className="mt-1 text-sm leading-relaxed text-base-content/70">
                              {action.description}
                            </p>

                            {/* Parameters */}
                            <ParameterList schema={action.parameters} />

                            {/* Permissions & capabilities */}
                            <div className="mt-3 flex flex-wrap gap-4 border-t border-dashed border-base-content/15 pt-3">
                              <ChipGroup
                                label="permissions"
                                values={action.permissions}
                                icon={<Key size={10} weight="bold" />}
                                tone="warm"
                              />
                              <ChipGroup
                                label="capabilities"
                                values={action.requiredCapabilities}
                                icon={<Lightning size={10} weight="bold" />}
                                tone="cool"
                              />
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ───────────────────────────────────────────
// Small presentational helpers
// ───────────────────────────────────────────

function ChipGroup({
  label,
  values,
  icon,
  tone,
}: {
  label: string;
  values: string[];
  icon: React.ReactNode;
  tone: "warm" | "cool";
}) {
  const chipCls =
    tone === "warm"
      ? "border-accent/40 bg-accent/10 text-accent"
      : "border-info/40 bg-info/10 text-info";
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-base-content/45">
        {label}
      </span>
      {values.length === 0 ? (
        <span className="font-mono text-[10px] italic text-base-content/40">—</span>
      ) : (
        <div className="flex flex-wrap gap-1">
          {values.map((v) => (
            <span
              key={v}
              className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-[10px] ${chipCls}`}
            >
              {icon}
              {v}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// Render a simple glossary of an object schema's properties.
// v1 supports object / string / number / integer / boolean / array / null
// with nested object properties resolved one level deep (enough for manifest
// parameters produced by the skills builder).
function ParameterList({ schema }: { schema: ManifestAction["parameters"] }) {
  const isObject = schema?.type === "object" && schema.properties;
  if (!isObject) {
    return (
      <div className="mt-3 rounded-sm border border-dashed border-base-content/20 bg-base-200/40 p-3 font-mono text-[10px] text-base-content/55">
        パラメーター: {schema?.type ?? "—"}
      </div>
    );
  }
  const required = new Set(schema.required ?? []);
  const entries = Object.entries(schema.properties ?? {});
  if (entries.length === 0) {
    return (
      <div className="mt-3 rounded-sm border border-dashed border-base-content/20 bg-base-200/40 p-3 font-mono text-[10px] text-base-content/55">
        パラメーターなし
      </div>
    );
  }
  return (
    <dl className="mt-3 grid grid-cols-1 gap-2 rounded-sm border border-dashed border-base-content/20 bg-base-200/30 p-3 sm:grid-cols-[auto_1fr]">
      {entries.map(([key, prop]) => {
        const req = required.has(key);
        return (
          <div key={key} className="contents">
            <dt className="flex items-baseline gap-1 font-mono text-[11px] text-base-content/85">
              <span className="font-semibold">{key}</span>
              {req && (
                <span className="font-mono text-[9px] uppercase tracking-wider text-error/80">
                  必須
                </span>
              )}
            </dt>
            <dd className="flex min-w-0 flex-col gap-0.5">
              <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-base-content/50">
                {prop.type ?? "any"}
                {prop.enum ? ` · enum(${prop.enum.length})` : ""}
                {prop.minimum != null ? ` · min ${prop.minimum}` : ""}
                {prop.maximum != null ? ` · max ${prop.maximum}` : ""}
              </div>
              {prop.description && (
                <div className="text-xs leading-snug text-base-content/70">{prop.description}</div>
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
