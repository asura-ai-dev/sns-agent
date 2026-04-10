/**
 * BudgetPolicyManager — Task 4005
 *
 * Client component that renders the Allowances Register: a table of existing
 * budget policies (with their current consumption) and a modal form to create
 * or edit one. Deletion uses the existing ConfirmDialog.
 *
 * All mutations go through `/api/budget/policies` using `fetch` against the
 * relative URL — the Next.js rewrite (or a dev proxy) is assumed to forward
 * to the API. If the API is offline, buttons surface an inline error and the
 * table falls back to whatever was loaded server-side.
 *
 * This file is deliberately self-contained (its own tiny modal) to keep the
 * design tight to the broadsheet aesthetic.
 */
"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  PencilSimple,
  Trash,
  Coins,
  Warning,
  ShieldWarning,
  X,
  FloppyDisk,
} from "@phosphor-icons/react";

import type {
  BudgetActionOnExceed,
  BudgetPeriodType,
  BudgetPolicyDto,
  BudgetScopeType,
  BudgetStatusDto,
  CreateBudgetPolicyDto,
  UpdateBudgetPolicyDto,
} from "@sns-agent/sdk";

import { ConfirmDialog } from "@/components/settings/ConfirmDialog";

interface BudgetPolicyManagerProps {
  initialPolicies: BudgetPolicyDto[];
  initialStatuses: BudgetStatusDto[];
  isFallback: boolean;
}

// ───────────────────────────────────────────
// Labels
// ───────────────────────────────────────────

const SCOPE_OPTIONS: { value: BudgetScopeType; label: string; hint: string }[] = [
  { value: "workspace", label: "ワークスペース全体", hint: "workspace" },
  { value: "platform", label: "プラットフォーム指定", hint: "platform" },
  { value: "endpoint", label: "エンドポイント指定", hint: "endpoint" },
];

const PERIOD_OPTIONS: { value: BudgetPeriodType; label: string; hint: string }[] = [
  { value: "daily", label: "日次", hint: "daily" },
  { value: "weekly", label: "週次", hint: "weekly" },
  { value: "monthly", label: "月次", hint: "monthly" },
];

const ACTION_OPTIONS: { value: BudgetActionOnExceed; label: string; hint: string }[] = [
  { value: "warn", label: "警告のみ", hint: "warn" },
  { value: "require-approval", label: "承認を要求", hint: "require-approval" },
  { value: "block", label: "ブロック", hint: "block" },
];

// Common platform suggestions for the scope=platform select.
const PLATFORM_SUGGESTIONS = ["x", "line", "instagram", "openai", "anthropic"];

function describeScope(p: BudgetPolicyDto): string {
  if (p.scopeType === "workspace") return "workspace · all";
  if (p.scopeType === "platform") return `platform · ${p.scopeValue ?? "—"}`;
  return `endpoint · ${p.scopeValue ?? "—"}`;
}

// ───────────────────────────────────────────
// Form state
// ───────────────────────────────────────────

interface FormState {
  scopeType: BudgetScopeType;
  scopeValue: string;
  period: BudgetPeriodType;
  limitAmountUsd: string;
  actionOnExceed: BudgetActionOnExceed;
}

const EMPTY_FORM: FormState = {
  scopeType: "workspace",
  scopeValue: "",
  period: "monthly",
  limitAmountUsd: "100",
  actionOnExceed: "warn",
};

function policyToForm(p: BudgetPolicyDto): FormState {
  return {
    scopeType: p.scopeType,
    scopeValue: p.scopeValue ?? "",
    period: p.period,
    limitAmountUsd: String(p.limitAmountUsd),
    actionOnExceed: p.actionOnExceed,
  };
}

function validateForm(form: FormState): string | null {
  if (!form.period) return "period is required";
  if (!form.actionOnExceed) return "actionOnExceed is required";
  const n = Number(form.limitAmountUsd);
  if (!Number.isFinite(n) || n <= 0) return "limitAmountUsd must be a positive number";
  if (form.scopeType !== "workspace" && !form.scopeValue.trim()) {
    return `scopeValue is required for scopeType=${form.scopeType}`;
  }
  return null;
}

// ───────────────────────────────────────────
// API helpers (client)
// ───────────────────────────────────────────

function getApiBase(): string {
  // In the browser, default to the API dev port unless overridden.
  const env = (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_SNS_AGENT_API_URL) || "";
  return env.replace(/\/+$/, "") || "http://localhost:3001";
}

async function apiFetch<T>(
  method: "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${getApiBase()}${path}`, {
    method,
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
      const j = await res.json();
      if (j?.error?.message) message = String(j.error.message);
    } catch {
      // noop
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

// ───────────────────────────────────────────
// Component
// ───────────────────────────────────────────

export function BudgetPolicyManager({
  initialPolicies,
  initialStatuses,
  isFallback,
}: BudgetPolicyManagerProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Local mirrors so optimistic updates feel immediate.
  const [policies, setPolicies] = useState<BudgetPolicyDto[]>(initialPolicies);

  // Quick lookup: policy.id → status
  const statusByPolicy = useMemo(() => {
    const map = new Map<string, BudgetStatusDto>();
    for (const s of initialStatuses) map.set(s.policy.id, s);
    return map;
  }, [initialStatuses]);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<BudgetPolicyDto | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<BudgetPolicyDto | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setModalOpen(true);
  }

  function openEdit(p: BudgetPolicyDto) {
    setEditing(p);
    setForm(policyToForm(p));
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

    const payloadScopeValue =
      form.scopeType === "workspace" ? null : form.scopeValue.trim() || null;

    try {
      if (editing) {
        const input: UpdateBudgetPolicyDto = {
          scopeType: form.scopeType,
          scopeValue: payloadScopeValue,
          period: form.period,
          limitAmountUsd: Number(form.limitAmountUsd),
          actionOnExceed: form.actionOnExceed,
        };
        const res = await apiFetch<{ data: BudgetPolicyDto }>(
          "PATCH",
          `/api/budget/policies/${editing.id}`,
          input,
        );
        setPolicies((prev) => prev.map((p) => (p.id === res.data.id ? res.data : p)));
      } else {
        const input: CreateBudgetPolicyDto = {
          scopeType: form.scopeType,
          scopeValue: payloadScopeValue,
          period: form.period,
          limitAmountUsd: Number(form.limitAmountUsd),
          actionOnExceed: form.actionOnExceed,
        };
        const res = await apiFetch<{ data: BudgetPolicyDto }>(
          "POST",
          `/api/budget/policies`,
          input,
        );
        setPolicies((prev) => [...prev, res.data]);
      }
      setModalOpen(false);
      setEditing(null);
      // Refresh server data so consumption bars reflect any status changes.
      startTransition(() => router.refresh());
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "submit failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await apiFetch<{ data: { id: string; deleted: boolean } }>(
        "DELETE",
        `/api/budget/policies/${deleteTarget.id}`,
      );
      setPolicies((prev) => prev.filter((p) => p.id !== deleteTarget.id));
      setDeleteTarget(null);
      startTransition(() => router.refresh());
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "delete failed");
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
            register
          </div>
          <h2
            className="mt-0.5 font-display text-xl font-semibold text-base-content"
            style={{ fontFamily: "'Fraunces', serif" }}
          >
            Active Allowances{" "}
            <span className="ml-2 font-mono text-xs text-base-content/45">
              {policies.length} on file
            </span>
          </h2>
        </div>
        <button
          type="button"
          onClick={openCreate}
          disabled={isFallback || pending}
          className="group inline-flex items-center gap-2 rounded-sm border border-base-content bg-base-content px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-base-100 transition-colors hover:bg-primary hover:border-primary disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus size={12} weight="bold" />
          新規ポリシー
        </button>
      </div>

      {isFallback && (
        <div className="flex items-start gap-2 rounded-sm border border-dashed border-warning/60 bg-warning/10 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.15em] text-[#7a4b00]">
          <Warning size={12} weight="bold" className="mt-0.5 shrink-0" />
          <span>wire offline · 新規作成・編集は API 起動後に再試行してください</span>
        </div>
      )}

      {/* Register table */}
      <div className="overflow-x-auto rounded-sm border border-base-content/15 bg-base-100">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-base-content/30 font-mono text-[9px] uppercase tracking-[0.18em] text-base-content/55">
              <th className="px-4 py-2.5 text-left font-medium">scope</th>
              <th className="px-4 py-2.5 text-left font-medium">period</th>
              <th className="px-4 py-2.5 text-right font-medium tabular-nums">limit (usd)</th>
              <th className="px-4 py-2.5 text-left font-medium">on exceed</th>
              <th className="px-4 py-2.5 text-left font-medium">consumption</th>
              <th className="px-4 py-2.5 text-right font-medium">&nbsp;</th>
            </tr>
          </thead>
          <tbody>
            {policies.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center">
                  <Coins
                    size={20}
                    weight="regular"
                    className="mx-auto mb-2 text-base-content/30"
                    aria-hidden
                  />
                  <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-base-content/45">
                    no policies on file
                  </div>
                  <div className="mt-1 text-xs text-base-content/55">
                    右上の「新規ポリシー」から最初のポリシーを追加してください。
                  </div>
                </td>
              </tr>
            )}
            {policies.map((p) => {
              const s = statusByPolicy.get(p.id);
              const pct = s ? Math.min(s.percentage, 1.5) : 0;
              const exceeded = s?.exceeded ?? false;
              const warning = s?.warning ?? false;
              return (
                <tr
                  key={p.id}
                  className="border-b border-dashed border-base-content/15 transition-colors hover:bg-accent/[0.03]"
                >
                  <td className="px-4 py-3">
                    <div
                      className="font-display text-base font-medium text-base-content"
                      style={{ fontFamily: "'Fraunces', serif" }}
                    >
                      {describeScope(p)}
                    </div>
                    <div className="font-mono text-[9px] uppercase tracking-[0.15em] text-base-content/45">
                      id · {p.id.slice(0, 8)}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-[11px] uppercase tracking-[0.15em] text-base-content/70">
                    {p.period}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span
                      className="font-display text-base font-semibold tabular-nums text-base-content"
                      style={{ fontFamily: "'Fraunces', serif" }}
                    >
                      ${p.limitAmountUsd.toFixed(2)}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-[11px] uppercase tracking-[0.15em] text-base-content/70">
                    {p.actionOnExceed}
                  </td>
                  <td className="px-4 py-3" style={{ minWidth: 180 }}>
                    {s ? (
                      <div>
                        <div className="flex items-baseline justify-between gap-2 font-mono text-[10px] tabular-nums">
                          <span className="text-base-content/70">
                            ${s.consumed.toFixed(2)} / ${s.limit.toFixed(2)}
                          </span>
                          <span
                            className={
                              exceeded
                                ? "text-error"
                                : warning
                                  ? "text-[#7a4b00]"
                                  : "text-base-content/55"
                            }
                          >
                            {(s.percentage * 100).toFixed(1)}%
                          </span>
                        </div>
                        <div
                          className={
                            "mt-1 h-1.5 w-full overflow-hidden rounded-[1px] " +
                            (exceeded ? "bg-error/15" : warning ? "bg-warning/20" : "bg-primary/15")
                          }
                        >
                          <div
                            className={
                              "h-full " +
                              (exceeded ? "bg-error" : warning ? "bg-warning" : "bg-primary")
                            }
                            style={{ width: `${Math.min(pct * 100, 100).toFixed(1)}%` }}
                          />
                        </div>
                      </div>
                    ) : (
                      <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-base-content/40">
                        no data
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => openEdit(p)}
                        disabled={isFallback}
                        aria-label="編集"
                        className="rounded-sm p-1.5 text-base-content/50 transition-colors hover:bg-base-200 hover:text-base-content disabled:opacity-30"
                      >
                        <PencilSimple size={14} weight="regular" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(p)}
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

      {/* ─────────────── Create/Edit Memorandum Modal ─────────────── */}
      {modalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="budget-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          <div
            className="absolute inset-0 bg-secondary/40 backdrop-blur-[2px]"
            onClick={closeModal}
            aria-hidden
          />
          <div className="relative z-10 w-full max-w-lg overflow-hidden rounded-box border border-base-content/25 bg-base-100 shadow-[4px_4px_0_rgba(0,0,0,0.1)]">
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
                    memorandum · internal
                  </div>
                  <h3
                    id="budget-modal-title"
                    className="mt-0.5 font-display text-2xl font-semibold text-base-content"
                    style={{ fontFamily: "'Fraunces', serif" }}
                  >
                    {editing ? "Amend Allowance" : "Issue New Allowance"}
                  </h3>
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
                {/* Scope type */}
                <Field label="scope" hint="どの範囲を対象にするか">
                  <div className="grid grid-cols-3 gap-1.5">
                    {SCOPE_OPTIONS.map((opt) => (
                      <RadioChip
                        key={opt.value}
                        label={opt.label}
                        sub={opt.hint}
                        active={form.scopeType === opt.value}
                        onClick={() =>
                          setForm((f) => ({
                            ...f,
                            scopeType: opt.value,
                            // Reset scopeValue when leaving a scope with a value.
                            scopeValue: opt.value === "workspace" ? "" : f.scopeValue,
                          }))
                        }
                      />
                    ))}
                  </div>
                </Field>

                {/* Scope value (conditional) */}
                {form.scopeType !== "workspace" && (
                  <Field
                    label={form.scopeType === "platform" ? "platform" : "endpoint"}
                    hint={
                      form.scopeType === "platform"
                        ? "x / line / instagram / openai / anthropic"
                        : "例: posts.create"
                    }
                  >
                    {form.scopeType === "platform" ? (
                      <select
                        value={form.scopeValue}
                        onChange={(e) => setForm((f) => ({ ...f, scopeValue: e.target.value }))}
                        className="w-full rounded-sm border border-base-content/25 bg-base-100 px-3 py-2 font-mono text-sm text-base-content outline-none focus:border-primary"
                      >
                        <option value="">— 選択 —</option>
                        {PLATFORM_SUGGESTIONS.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={form.scopeValue}
                        onChange={(e) => setForm((f) => ({ ...f, scopeValue: e.target.value }))}
                        placeholder="endpoint identifier"
                        className="w-full rounded-sm border border-base-content/25 bg-base-100 px-3 py-2 font-mono text-sm text-base-content outline-none focus:border-primary"
                      />
                    )}
                  </Field>
                )}

                {/* Period */}
                <Field label="period" hint="リセット周期">
                  <div className="grid grid-cols-3 gap-1.5">
                    {PERIOD_OPTIONS.map((opt) => (
                      <RadioChip
                        key={opt.value}
                        label={opt.label}
                        sub={opt.hint}
                        active={form.period === opt.value}
                        onClick={() => setForm((f) => ({ ...f, period: opt.value }))}
                      />
                    ))}
                  </div>
                </Field>

                {/* Limit */}
                <Field label="limit (usd)" hint="期間あたりの上限額">
                  <div className="relative">
                    <span
                      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-display text-base text-base-content/45"
                      style={{ fontFamily: "'Fraunces', serif" }}
                    >
                      $
                    </span>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0.01"
                      value={form.limitAmountUsd}
                      onChange={(e) => setForm((f) => ({ ...f, limitAmountUsd: e.target.value }))}
                      className="w-full rounded-sm border border-base-content/25 bg-base-100 py-2 pl-7 pr-3 font-display text-lg tabular-nums text-base-content outline-none focus:border-primary"
                      style={{ fontFamily: "'Fraunces', serif" }}
                    />
                  </div>
                </Field>

                {/* Action on exceed */}
                <Field label="on exceed" hint="超過時の挙動">
                  <div className="grid grid-cols-3 gap-1.5">
                    {ACTION_OPTIONS.map((opt) => (
                      <RadioChip
                        key={opt.value}
                        label={opt.label}
                        sub={opt.hint}
                        active={form.actionOnExceed === opt.value}
                        onClick={() => setForm((f) => ({ ...f, actionOnExceed: opt.value }))}
                      />
                    ))}
                  </div>
                </Field>

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
                    {submitting ? "saving…" : editing ? "amend" : "issue"}
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
        title="ポリシーを削除しますか？"
        description={
          deleteTarget
            ? `${describeScope(deleteTarget)} · ${deleteTarget.period} · $${deleteTarget.limitAmountUsd.toFixed(2)} を削除します。この操作は取り消せません。${deleteError ? ` (${deleteError})` : ""}`
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

function RadioChip({
  label,
  sub,
  active,
  onClick,
}: {
  label: string;
  sub: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        "flex flex-col gap-0.5 rounded-sm border px-2.5 py-2 text-left transition-colors " +
        (active
          ? "border-base-content bg-base-content text-base-100"
          : "border-base-content/25 text-base-content/70 hover:border-base-content/55 hover:text-base-content")
      }
    >
      <span className="text-xs font-medium">{label}</span>
      <span className="font-mono text-[8.5px] uppercase tracking-[0.15em] opacity-60">{sub}</span>
    </button>
  );
}
