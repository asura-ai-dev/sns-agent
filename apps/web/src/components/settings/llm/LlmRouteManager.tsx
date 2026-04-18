/**
 * LlmRouteManager — Task 5005
 *
 * Client component that renders the Dispatch Roster: a table of LLM routes
 * (platform × action → provider/model) with a modal form to create or edit
 * one, and a confirmation dialog for deletion.
 *
 * All mutations hit `/api/llm/routes` on the Hono API through the shared
 * `apiFetch` helper. When the API is offline the table still renders from
 * the server-side snapshot and the mutation buttons are disabled.
 *
 * Design: editorial broadsheet — Fraunces display + DM Sans body, paper
 * grain overlays, uppercase mono eyebrows, `·` separators. Matches the tone
 * established by `BudgetPolicyManager`.
 */
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  PencilSimple,
  Trash,
  Brain,
  Warning,
  ShieldWarning,
  X,
  FloppyDisk,
  ArrowBendDownRight,
  Thermometer,
  Hash,
  ArrowsClockwise,
} from "@phosphor-icons/react";

import { ConfirmDialog } from "@/components/settings/ConfirmDialog";
import { PlatformIcon, type Platform as UiPlatform } from "@/components/settings/PlatformIcon";
import type { LlmRouteDto } from "@/lib/api";

interface LlmRouteManagerProps {
  initialRoutes: LlmRouteDto[];
  isFallback: boolean;
}

// ───────────────────────────────────────────
// Option catalogues
// ───────────────────────────────────────────

const PLATFORM_OPTIONS: { value: string; label: string; hint: string }[] = [
  { value: "", label: "全体（デフォルト）", hint: "all" },
  { value: "x", label: "X", hint: "x" },
  { value: "line", label: "LINE", hint: "line" },
  { value: "instagram", label: "Instagram", hint: "instagram" },
];

const ACTION_OPTIONS: { value: string; label: string; hint: string }[] = [
  { value: "", label: "全体（デフォルト）", hint: "all" },
  { value: "post.create", label: "投稿作成", hint: "post.create" },
  { value: "post.schedule", label: "投稿予約", hint: "post.schedule" },
  { value: "post.list", label: "投稿一覧", hint: "post.list" },
  { value: "schedule.list", label: "予約一覧", hint: "schedule.list" },
  { value: "inbox.list", label: "受信一覧", hint: "inbox.list" },
  { value: "reply", label: "返信", hint: "reply" },
  { value: "draft", label: "下書き", hint: "draft" },
  { value: "summarize", label: "要約", hint: "summarize" },
];

const PROVIDER_OPTIONS: { value: string; label: string }[] = [
  { value: "openai", label: "openai" },
  { value: "anthropic", label: "anthropic" },
];

const PLATFORM_LABELS: Record<string, string> = {
  x: "X",
  line: "LINE",
  instagram: "Instagram",
};

const ACTION_LABELS: Record<string, string> = {
  "post.create": "投稿を作る",
  "post.schedule": "投稿を予約する",
  "post.list": "投稿一覧を見る",
  "schedule.list": "予約一覧を見る",
  "inbox.list": "受信一覧を見る",
  reply: "返信する",
  draft: "下書きを扱う",
  summarize: "内容を要約する",
};

const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
};

// Small helper – match platform string → icon platform. Non-matching platforms
// (null / "common") render as an em-dash typographic glyph instead.
function getUiPlatform(value: string | null): UiPlatform | null {
  if (value === "x" || value === "line" || value === "instagram") return value;
  return null;
}

// ───────────────────────────────────────────
// Form state
// ───────────────────────────────────────────

interface FormState {
  platform: string; // "" == default
  action: string; // "" == default
  provider: string;
  model: string;
  temperature: string; // kept as string for slider text display
  maxTokens: string;
  fallbackEnabled: boolean;
  fallbackProvider: string;
  fallbackModel: string;
  priority: string;
}

const EMPTY_FORM: FormState = {
  platform: "",
  action: "",
  provider: "openai",
  model: "gpt-4o",
  temperature: "0.7",
  maxTokens: "2048",
  fallbackEnabled: false,
  fallbackProvider: "",
  fallbackModel: "",
  priority: "0",
};

function routeToForm(r: LlmRouteDto): FormState {
  return {
    platform: r.platform ?? "",
    action: r.action ?? "",
    provider: r.provider,
    model: r.model,
    temperature: r.temperature != null ? String(r.temperature) : "0.7",
    maxTokens: r.maxTokens != null ? String(r.maxTokens) : "2048",
    fallbackEnabled: !!(r.fallbackProvider && r.fallbackModel),
    fallbackProvider: r.fallbackProvider ?? "",
    fallbackModel: r.fallbackModel ?? "",
    priority: String(r.priority),
  };
}

function validateForm(form: FormState): string | null {
  if (!form.provider) return "利用する AI 提供元を選択してください。";
  if (!form.model.trim()) return "モデル名を入力してください。";
  const temp = Number(form.temperature);
  if (!Number.isFinite(temp) || temp < 0 || temp > 2) {
    return "Temperature は 0.0 から 2.0 の範囲で指定してください。";
  }
  const max = Number(form.maxTokens);
  if (!Number.isFinite(max) || max <= 0 || !Number.isInteger(max)) {
    return "Max Tokens は 1 以上の整数で入力してください。";
  }
  const pri = Number(form.priority);
  if (!Number.isFinite(pri) || !Number.isInteger(pri)) {
    return "Priority は整数で入力してください。";
  }
  if (form.fallbackEnabled) {
    if (!form.fallbackProvider) return "Fallback 用の AI 提供元を選択してください。";
    if (!form.fallbackModel.trim()) return "Fallback 用のモデル名を入力してください。";
  }
  return null;
}

// ───────────────────────────────────────────
// API helpers (client)
// ───────────────────────────────────────────

function getApiBase(): string {
  const env =
    (typeof process !== "undefined" &&
      (process.env?.NEXT_PUBLIC_API_BASE_URL ?? process.env?.NEXT_PUBLIC_SNS_AGENT_API_URL)) ||
    "";
  return env.replace(/\/+$/, "");
}

async function apiFetch<T>(
  method: "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${getApiBase()}${path}`, {
    method,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-Idempotency-Key":
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random()}`,
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
// Descriptors
// ───────────────────────────────────────────

function describePlatform(value: string | null): string {
  if (!value) return "全体";
  return PLATFORM_LABELS[value] ?? value;
}

function describeAction(value: string | null): string {
  if (!value) return "全体";
  return ACTION_LABELS[value] ?? value;
}

function describeProvider(value: string): string {
  return PROVIDER_LABELS[value] ?? value;
}

function routeLabel(r: LlmRouteDto): string {
  if (!r.platform && !r.action) return "デフォルトルート";
  const p = describePlatform(r.platform);
  const a = describeAction(r.action);
  return `${p} · ${a}`;
}

function describeRoutePurpose(r: LlmRouteDto): string {
  if (!r.platform && !r.action) {
    return "他に一致する設定がないときに使う共通ルートです。";
  }
  if (r.platform && r.action) {
    return `${describePlatform(r.platform)} で「${describeAction(r.action)}」をするときに使います。`;
  }
  if (r.platform) {
    return `${describePlatform(r.platform)} 全体で優先されるルートです。`;
  }
  return `すべての SNS で「${describeAction(r.action)}」をするときに使います。`;
}

// ───────────────────────────────────────────
// Component
// ───────────────────────────────────────────

export function LlmRouteManager({ initialRoutes, isFallback }: LlmRouteManagerProps) {
  const router = useRouter();
  const [isRefreshing, startTransition] = useTransition();

  const [routes, setRoutes] = useState<LlmRouteDto[]>(() =>
    [...initialRoutes].sort((a, b) => b.priority - a.priority),
  );

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<LlmRouteDto | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<LlmRouteDto | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setModalOpen(true);
  }

  function openEdit(r: LlmRouteDto) {
    setEditing(r);
    setForm(routeToForm(r));
    setFormError(null);
    setModalOpen(true);
  }

  function closeModal() {
    if (submitting) return;
    setModalOpen(false);
    setEditing(null);
    setFormError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err = validateForm(form);
    if (err) {
      setFormError(err);
      return;
    }
    setFormError(null);
    setSubmitting(true);

    const payload: Record<string, unknown> = {
      platform: form.platform || null,
      action: form.action || null,
      provider: form.provider,
      model: form.model.trim(),
      temperature: Number(form.temperature),
      maxTokens: Number(form.maxTokens),
      fallbackProvider: form.fallbackEnabled ? form.fallbackProvider : null,
      fallbackModel: form.fallbackEnabled ? form.fallbackModel.trim() : null,
      priority: Number(form.priority),
    };

    try {
      if (editing) {
        const res = await apiFetch<{ data: LlmRouteDto }>(
          "PATCH",
          `/api/llm/routes/${editing.id}`,
          payload,
        );
        setRoutes((prev) =>
          [...prev.map((r) => (r.id === res.data.id ? res.data : r))].sort(
            (a, b) => b.priority - a.priority,
          ),
        );
      } else {
        const res = await apiFetch<{ data: LlmRouteDto }>("POST", `/api/llm/routes`, payload);
        setRoutes((prev) => [...prev, res.data].sort((a, b) => b.priority - a.priority));
      }
      setModalOpen(false);
      setEditing(null);
      startTransition(() => router.refresh());
    } catch (submitError) {
      setFormError(
        submitError instanceof Error ? submitError.message : "ルーティングの保存に失敗しました。",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await apiFetch<void>("DELETE", `/api/llm/routes/${deleteTarget.id}`);
      setRoutes((prev) => prev.filter((r) => r.id !== deleteTarget.id));
      setDeleteTarget(null);
      startTransition(() => router.refresh());
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "ルーティングの削除に失敗しました。");
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Header row with count + new button */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-base-content/45">
            roster
          </div>
          <h2
            className="mt-0.5 font-display text-xl font-semibold text-base-content"
            style={{ fontFamily: "'Fraunces', serif" }}
          >
            Dispatch Routes{" "}
            <span className="ml-2 font-mono text-xs text-base-content/45">
              {routes.length} on file
            </span>
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-base-content/65">
            ここで決めた内容は、チャット画面や Agent Gateway が AI を選ぶときの基準になります。
            つまり「どの用途に、どの AI を使うか」を運用チームが見える形で管理する場所です。
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          disabled={isFallback}
          className="group inline-flex items-center gap-2 rounded-sm border border-base-content bg-base-content px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-base-100 transition-colors hover:bg-primary hover:border-primary disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus size={12} weight="bold" />
          新規ルート
        </button>
      </div>

      <section className="grid gap-3 lg:grid-cols-[1.35fr_1fr]">
        <div className="rounded-box border border-base-content/15 bg-base-100 px-4 py-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-base-content/45">
            what this controls
          </div>
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            <div className="rounded-sm border border-base-content/15 bg-base-200/20 px-3 py-3">
              <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-base-content/45">
                1. 入力
              </div>
              <p className="mt-1 text-sm text-base-content/75">
                Web UI のチャットや自動処理が、「何をしたいか」を Agent Gateway に渡します。
              </p>
            </div>
            <div className="rounded-sm border border-base-content/15 bg-base-200/20 px-3 py-3">
              <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-base-content/45">
                2. 判定
              </div>
              <p className="mt-1 text-sm text-base-content/75">
                この画面のルールを見て、用途に合う AI 提供元とモデルを選びます。
              </p>
            </div>
            <div className="rounded-sm border border-base-content/15 bg-base-200/20 px-3 py-3">
              <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-base-content/45">
                3. 実行
              </div>
              <p className="mt-1 text-sm text-base-content/75">
                選ばれた AI が応答し、必要なら Skills 実行や投稿処理につながります。
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-box border border-dashed border-base-content/20 bg-base-100 px-4 py-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-base-content/45">
            routing rule
          </div>
          <ul className="mt-2 space-y-2 text-sm leading-relaxed text-base-content/70">
            <li>一致条件が細かいルートほど優先されます。</li>
            <li>Priority が大きいほど、その中で先に選ばれます。</li>
            <li>Fallback を入れると、主経路が失敗したときに予備の AI を試します。</li>
          </ul>
        </div>
      </section>

      {isFallback && (
        <div className="flex items-start gap-2 rounded-sm border border-dashed border-warning/60 bg-warning/10 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.15em] text-[#7a4b00]">
          <Warning size={12} weight="bold" className="mt-0.5 shrink-0" />
          <span>wire offline · 新規作成・編集は API 起動後に再試行してください</span>
        </div>
      )}

      {isRefreshing && (
        <div className="flex items-start gap-2 rounded-sm border border-info/30 bg-info/10 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.15em] text-info">
          <ArrowsClockwise size={12} weight="bold" className="mt-0.5 shrink-0 animate-spin" />
          <span>最新のルーティング状態に同期しています</span>
        </div>
      )}

      {/* Dispatch table */}
      <div className="overflow-x-auto rounded-sm border border-base-content/15 bg-base-100">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-base-content/30 font-mono text-[9px] uppercase tracking-[0.18em] text-base-content/55">
              <th className="px-4 py-2.5 text-left font-medium">platform</th>
              <th className="px-4 py-2.5 text-left font-medium">action</th>
              <th className="px-4 py-2.5 text-left font-medium">provider</th>
              <th className="px-4 py-2.5 text-left font-medium">model</th>
              <th className="px-4 py-2.5 text-right font-medium tabular-nums">temp</th>
              <th className="px-4 py-2.5 text-right font-medium tabular-nums">max</th>
              <th className="px-4 py-2.5 text-left font-medium">fallback</th>
              <th className="px-3 py-2.5 text-center font-medium">pri</th>
              <th className="px-4 py-2.5 text-right font-medium">&nbsp;</th>
            </tr>
          </thead>
          <tbody>
            {routes.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center">
                  <Brain
                    size={22}
                    weight="regular"
                    className="mx-auto mb-2 text-base-content/30"
                    aria-hidden
                  />
                  <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-base-content/45">
                    no routing rules yet
                  </div>
                  <div className="mt-1 text-xs text-base-content/55">
                    LLM
                    ルーティングが未設定です。まずは「新規ルート」からデフォルトルートを作成してください。
                  </div>
                </td>
              </tr>
            )}
            {routes.map((r) => {
              const uiPlatform = getUiPlatform(r.platform);
              const isDefault = !r.platform && !r.action;
              return (
                <tr
                  key={r.id}
                  className="border-b border-dashed border-base-content/15 transition-colors hover:bg-accent/[0.03]"
                >
                  {/* platform */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {uiPlatform ? (
                        <PlatformIcon platform={uiPlatform} size={24} />
                      ) : (
                        <span
                          aria-hidden
                          className="inline-flex h-6 w-6 items-center justify-center rounded-sm border border-dashed border-base-content/30 font-display text-xs text-base-content/40"
                          style={{ fontFamily: "'Fraunces', serif" }}
                        >
                          —
                        </span>
                      )}
                      <span
                        className={`font-mono text-[11px] uppercase tracking-[0.15em] ${
                          isDefault ? "text-base-content/45" : "text-base-content/80"
                        }`}
                      >
                        {describePlatform(r.platform)}
                      </span>
                    </div>
                  </td>
                  {/* action */}
                  <td className="px-4 py-3">
                    <div className="font-mono text-[11px] text-base-content/80">
                      {isDefault ? (
                        <span
                          className="font-display text-sm italic text-base-content/55"
                          style={{ fontFamily: "'Fraunces', serif" }}
                        >
                          デフォルト
                        </span>
                      ) : (
                        describeAction(r.action)
                      )}
                    </div>
                    <div className="mt-1 text-xs leading-relaxed text-base-content/55">
                      {describeRoutePurpose(r)}
                    </div>
                  </td>
                  {/* provider */}
                  <td className="px-4 py-3">
                    <div className="font-mono text-[11px] uppercase tracking-[0.15em] text-base-content/75">
                      {describeProvider(r.provider)}
                    </div>
                    <div className="font-mono text-[9px] uppercase tracking-[0.15em] text-base-content/40">
                      {r.provider}
                    </div>
                  </td>
                  {/* model */}
                  <td className="px-4 py-3">
                    <div
                      className="font-display text-base font-medium text-base-content"
                      style={{ fontFamily: "'Fraunces', serif" }}
                    >
                      {r.model}
                    </div>
                  </td>
                  {/* temp */}
                  <td className="px-4 py-3 text-right font-mono text-[11px] tabular-nums text-base-content/70">
                    {r.temperature != null ? r.temperature.toFixed(2) : "—"}
                  </td>
                  {/* maxTokens */}
                  <td className="px-4 py-3 text-right font-mono text-[11px] tabular-nums text-base-content/70">
                    {r.maxTokens ?? "—"}
                  </td>
                  {/* fallback */}
                  <td className="px-4 py-3 font-mono text-[10px] text-base-content/60">
                    {r.fallbackProvider && r.fallbackModel ? (
                      <span className="inline-flex items-center gap-1">
                        <ArrowBendDownRight
                          size={11}
                          weight="bold"
                          className="text-base-content/40"
                        />
                        <span className="text-base-content/75">{r.fallbackModel}</span>
                        <span className="text-base-content/40">
                          / {describeProvider(r.fallbackProvider)}
                        </span>
                      </span>
                    ) : (
                      <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-base-content/30">
                        none
                      </span>
                    )}
                  </td>
                  {/* priority */}
                  <td className="w-12 px-3 py-3 text-center align-middle">
                    <span
                      className="inline-flex h-8 min-w-[2rem] items-center justify-center rounded-sm border border-base-content/25 px-1 font-display text-sm font-semibold tabular-nums text-base-content/70"
                      style={{ fontFamily: "'Fraunces', serif" }}
                    >
                      {r.priority}
                    </span>
                  </td>
                  {/* actions */}
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => openEdit(r)}
                        disabled={isFallback}
                        aria-label="編集"
                        className="rounded-sm p-1.5 text-base-content/50 transition-colors hover:bg-base-200 hover:text-base-content disabled:opacity-30"
                      >
                        <PencilSimple size={14} weight="regular" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(r)}
                        disabled={isFallback}
                        aria-label="削除"
                        className="rounded-sm p-1.5 text-base-content/50 transition-colors hover:bg-error/10 hover:text-error disabled:opacity-30"
                      >
                        <Trash size={14} weight="regular" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ─────────────── Create/Edit Dispatch Modal ─────────────── */}
      {modalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="llm-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          <div
            className="absolute inset-0 bg-secondary/40 backdrop-blur-[2px]"
            onClick={closeModal}
            aria-hidden
          />
          <div className="relative z-10 max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-box border border-base-content/25 bg-base-100 shadow-[4px_4px_0_rgba(0,0,0,0.1)]">
            {/* Paper grain overlay */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 opacity-[0.035]"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(0deg, #000 0px, #000 1px, transparent 1px, transparent 24px)",
              }}
            />
            <div className="relative">
              {/* Modal masthead */}
              <div className="flex items-start justify-between border-b border-base-content/25 px-6 py-4">
                <div>
                  <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-base-content/45">
                    routing · editor
                  </div>
                  <h3
                    id="llm-modal-title"
                    className="mt-0.5 font-display text-2xl font-semibold text-base-content"
                    style={{ fontFamily: "'Fraunces', serif" }}
                  >
                    {editing ? "ルーティングを編集" : "ルーティングを追加"}
                  </h3>
                  <p className="mt-1 max-w-lg text-sm leading-relaxed text-base-content/60">
                    Platform と Action の組み合わせに対して、どの AI を使うかを指定します。
                    空欄に近い設定ほど広い用途に効き、細かい設定ほど個別の用途に効きます。
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={submitting}
                  aria-label="閉じる"
                  className="rounded-sm p-1.5 text-base-content/50 transition-colors hover:bg-base-200 hover:text-base-content"
                >
                  <X size={14} weight="bold" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4 px-6 py-5">
                {/* Platform + Action side by side */}
                <div className="grid grid-cols-2 gap-3">
                  <Field label="platform" hint="対象 SNS">
                    <select
                      value={form.platform}
                      onChange={(e) => setForm((f) => ({ ...f, platform: e.target.value }))}
                      className="w-full rounded-sm border border-base-content/25 bg-base-100 px-3 py-2 font-mono text-sm text-base-content outline-none focus:border-primary"
                    >
                      {PLATFORM_OPTIONS.map((opt) => (
                        <option key={opt.value || "_default"} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="action" hint="対象アクション">
                    <select
                      value={form.action}
                      onChange={(e) => setForm((f) => ({ ...f, action: e.target.value }))}
                      className="w-full rounded-sm border border-base-content/25 bg-base-100 px-3 py-2 font-mono text-sm text-base-content outline-none focus:border-primary"
                    >
                      {ACTION_OPTIONS.map((opt) => (
                        <option key={opt.value || "_default"} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>

                {/* Provider + Model */}
                <div className="grid grid-cols-[auto_1fr] gap-3">
                  <Field label="provider" hint="AI 提供元">
                    <select
                      value={form.provider}
                      onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value }))}
                      className="rounded-sm border border-base-content/25 bg-base-100 px-3 py-2 font-mono text-sm text-base-content outline-none focus:border-primary"
                    >
                      {PROVIDER_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="model" hint="例: gpt-4o, claude-sonnet-4-20250514">
                    <input
                      type="text"
                      value={form.model}
                      onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
                      placeholder="使用するモデル名"
                      className="w-full rounded-sm border border-base-content/25 bg-base-100 px-3 py-2 font-display text-base tabular-nums text-base-content outline-none focus:border-primary"
                      style={{ fontFamily: "'Fraunces', serif" }}
                    />
                  </Field>
                </div>

                {/* Temperature slider */}
                <Field label="temperature" hint="0.0 (厳密) ↔ 2.0 (発散)">
                  <div className="rounded-sm border border-base-content/25 bg-base-100 px-3 py-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.15em] text-base-content/50">
                        <Thermometer size={12} weight="bold" />
                        creativity
                      </span>
                      <span
                        className="font-display text-xl font-semibold tabular-nums text-base-content"
                        style={{ fontFamily: "'Fraunces', serif" }}
                      >
                        {Number(form.temperature).toFixed(2)}
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="2"
                      step="0.05"
                      value={form.temperature}
                      onChange={(e) => setForm((f) => ({ ...f, temperature: e.target.value }))}
                      className="range range-xs w-full text-primary"
                      aria-label="temperature"
                    />
                    <div className="mt-1 flex justify-between font-mono text-[9px] uppercase tracking-[0.15em] text-base-content/40">
                      <span>0.0</span>
                      <span>0.5</span>
                      <span>1.0</span>
                      <span>1.5</span>
                      <span>2.0</span>
                    </div>
                  </div>
                </Field>

                {/* Max tokens + priority */}
                <div className="grid grid-cols-2 gap-3">
                  <Field label="max tokens" hint="上限">
                    <div className="relative">
                      <Hash
                        size={12}
                        weight="bold"
                        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base-content/40"
                      />
                      <input
                        type="number"
                        inputMode="numeric"
                        step="1"
                        min="1"
                        value={form.maxTokens}
                        onChange={(e) => setForm((f) => ({ ...f, maxTokens: e.target.value }))}
                        className="w-full rounded-sm border border-base-content/25 bg-base-100 py-2 pl-7 pr-3 font-display text-base tabular-nums text-base-content outline-none focus:border-primary"
                        style={{ fontFamily: "'Fraunces', serif" }}
                      />
                    </div>
                  </Field>
                  <Field label="priority" hint="降順で優先度付け">
                    <input
                      type="number"
                      inputMode="numeric"
                      step="1"
                      value={form.priority}
                      onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}
                      className="w-full rounded-sm border border-base-content/25 bg-base-100 px-3 py-2 font-display text-base tabular-nums text-base-content outline-none focus:border-primary"
                      style={{ fontFamily: "'Fraunces', serif" }}
                    />
                  </Field>
                </div>

                {/* Fallback */}
                <div className="space-y-2 rounded-sm border border-dashed border-base-content/20 bg-base-200/40 px-3 py-3">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={form.fallbackEnabled}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, fallbackEnabled: e.target.checked }))
                      }
                      className="checkbox checkbox-xs checkbox-primary"
                    />
                    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-base-content/70">
                      fallback を有効化
                    </span>
                    <span className="font-mono text-[9px] italic tracking-[0.1em] text-base-content/40">
                      primary が失敗した時の予備経路
                    </span>
                  </label>
                  {form.fallbackEnabled && (
                    <div className="grid grid-cols-[auto_1fr] gap-2 pl-5">
                      <select
                        value={form.fallbackProvider}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, fallbackProvider: e.target.value }))
                        }
                        className="rounded-sm border border-base-content/25 bg-base-100 px-2 py-1.5 font-mono text-xs text-base-content outline-none focus:border-primary"
                      >
                        <option value="">— provider を選択 —</option>
                        {PROVIDER_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        value={form.fallbackModel}
                        onChange={(e) => setForm((f) => ({ ...f, fallbackModel: e.target.value }))}
                        placeholder="予備で使うモデル名"
                        className="w-full rounded-sm border border-base-content/25 bg-base-100 px-2 py-1.5 font-mono text-xs text-base-content outline-none focus:border-primary"
                      />
                    </div>
                  )}
                </div>

                {formError && (
                  <div className="flex items-start gap-2 rounded-sm border border-error/40 bg-error/10 px-3 py-2 font-mono text-[11px] text-error">
                    <ShieldWarning size={12} weight="bold" className="mt-0.5 shrink-0" />
                    {formError}
                  </div>
                )}

                {/* Footer */}
                <div className="flex items-center justify-end gap-2 border-t border-base-content/15 pt-4">
                  <button
                    type="button"
                    onClick={closeModal}
                    disabled={submitting}
                    className="rounded-sm border border-base-content/25 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-base-content/60 transition-colors hover:border-base-content/55 hover:text-base-content"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="inline-flex items-center gap-2 rounded-sm border border-primary bg-primary px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-primary-content transition-colors hover:bg-primary/90 disabled:opacity-50"
                  >
                    <FloppyDisk size={12} weight="bold" />
                    {submitting ? "保存中…" : editing ? "更新する" : "作成する"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        title="ルートを削除しますか？"
        description={
          deleteTarget
            ? `${routeLabel(deleteTarget)} → ${deleteTarget.model} (${deleteTarget.provider}) を削除します。この操作は取り消せません。${
                deleteError ? ` (${deleteError})` : ""
              }`
            : ""
        }
        confirmLabel="削除"
        cancelLabel="取消"
        loading={deleteBusy}
        tone="destructive"
        onCancel={() => {
          if (!deleteBusy) {
            setDeleteTarget(null);
            setDeleteError(null);
          }
        }}
        onConfirm={handleDelete}
      />
    </div>
  );
}

// ───────────────────────────────────────────
// Small presentational helpers
// ───────────────────────────────────────────

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label className="font-mono text-[10px] uppercase tracking-[0.2em] text-base-content/60">
          {label}
        </label>
        {hint && (
          <span className="font-mono text-[9px] italic tracking-[0.1em] text-base-content/40">
            {hint}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}
