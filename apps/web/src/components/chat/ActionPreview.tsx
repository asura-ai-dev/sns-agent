/**
 * Task 5004: ActionPreview.
 *
 * Renders a skill action that the LLM has proposed as a "proof sheet" —
 * a printer's galley with a rule border, metadata strip (package · mode ·
 * permissions) and a sample of the preview payload.
 *
 * Two stamp buttons drive the approval flow:
 *   - APPROVE  -> calls onApprove(); the card then shows a spinning press
 *     indicator while executing, and finally a red/green press outcome.
 *   - KILL     -> calls onCancel(); the card dissolves out.
 *
 * Blocked previews (missing permissions or argument errors) render the
 * error lines inside the proof and disable the APPROVE stamp.
 */

"use client";

import { useState } from "react";
import {
  CheckCircle,
  XCircle,
  CircleNotch,
  Stamp,
  Warning,
  ShieldCheck,
} from "@phosphor-icons/react";
import type { SkillPreview, ExecuteResponse } from "./api";

interface ActionPreviewProps {
  preview: SkillPreview;
  /** Called when the operator approves. Must return an ExecuteResponse or throw. */
  onApprove: () => Promise<ExecuteResponse | null>;
  onCancel: () => void;
  /** True once the action has been executed (prevents re-approval). */
  settled?: boolean;
}

type UiState =
  | { kind: "pending" }
  | { kind: "running" }
  | { kind: "succeeded"; outcome: ExecuteResponse }
  | { kind: "failed"; message: string };

function formatPreviewPayload(
  payload: SkillPreview["preview"],
): { label: string; value: string }[] {
  if (payload === null || payload === undefined) return [];
  if (typeof payload === "string") {
    return [{ label: "preview", value: payload }];
  }
  return Object.entries(payload).map(([k, v]) => ({
    label: k,
    value:
      typeof v === "string"
        ? v
        : typeof v === "number" || typeof v === "boolean"
          ? String(v)
          : JSON.stringify(v),
  }));
}

export function ActionPreview({ preview, onApprove, onCancel, settled }: ActionPreviewProps) {
  const [state, setState] = useState<UiState>({ kind: "pending" });

  const blocked = !preview.allowed || preview.missingPermissions.length > 0;
  const fields = formatPreviewPayload(preview.preview);

  const handleApprove = async () => {
    if (blocked || settled) return;
    setState({ kind: "running" });
    try {
      const outcome = await onApprove();
      if (outcome) {
        setState({ kind: "succeeded", outcome });
      } else {
        setState({ kind: "failed", message: "no outcome returned" });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "execution failed";
      setState({ kind: "failed", message: msg });
    }
  };

  return (
    <div className="my-4 flex justify-center animate-wire-slip-in">
      <div
        className="relative w-full max-w-[560px] border-2 border-base-content/80 bg-[oklch(99.42%_0.007_88.64)] shadow-[4px_4px_0_0_rgba(17,17,17,0.15)]"
        style={{ borderRadius: 2 }}
      >
        {/* Perforated top edge */}
        <div
          aria-hidden
          className="absolute left-0 right-0 -top-[6px] h-[6px]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 6px 0, transparent 3px, rgba(17,17,17,0.8) 3.5px)",
            backgroundSize: "12px 6px",
            backgroundRepeat: "repeat-x",
          }}
        />

        {/* Header strip */}
        <header className="flex items-center justify-between border-b-2 border-base-content/80 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.22em] text-base-content/75">
          <div className="flex items-center gap-2">
            <Stamp size={12} weight="bold" />
            <span className="font-bold">proof sheet</span>
            <span className="opacity-40">·</span>
            <span>awaiting approval</span>
          </div>
          <div className="hidden items-center gap-2 sm:flex">
            <span className="opacity-40">mode</span>
            <span className="font-bold">{preview.mode}</span>
          </div>
        </header>

        {/* Action identity */}
        <div className="px-4 pt-3">
          <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-base-content/45">
            package · {preview.packageName}
          </div>
          <h3
            className="mt-0.5 font-display text-[22px] font-semibold leading-tight text-base-content"
            style={{ fontFamily: "'Fraunces', serif", fontOpticalSizing: "auto" }}
          >
            {preview.actionName}
          </h3>
          {preview.description && (
            <p
              className="mt-0.5 font-display text-sm italic text-base-content/65"
              style={{ fontFamily: "'Fraunces', serif", fontStyle: "italic" }}
            >
              {preview.description}
            </p>
          )}
        </div>

        {/* Permissions line */}
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-dashed border-base-content/20 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-base-content/55">
          <ShieldCheck size={11} weight="bold" />
          <span>req</span>
          {preview.requiredPermissions.length === 0 ? (
            <span className="opacity-40">none</span>
          ) : (
            preview.requiredPermissions.map((p) => (
              <span
                key={p}
                className="rounded-sm border border-base-content/25 bg-base-200/60 px-1.5 py-[1px]"
              >
                {p}
              </span>
            ))
          )}
          {preview.missingPermissions.length > 0 && (
            <>
              <span className="opacity-40">·</span>
              <span className="text-error">missing</span>
              {preview.missingPermissions.map((p) => (
                <span
                  key={p}
                  className="rounded-sm border border-error/50 bg-error/10 px-1.5 py-[1px] text-error"
                >
                  {p}
                </span>
              ))}
            </>
          )}
        </div>

        {/* Preview payload — the galley proof */}
        {fields.length > 0 && (
          <dl className="border-t border-dashed border-base-content/20 px-4 py-3">
            {fields.map((field) => (
              <div
                key={field.label}
                className="grid grid-cols-[100px_1fr] gap-3 border-b border-dotted border-base-content/15 py-1.5 last:border-b-0"
              >
                <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-base-content/50">
                  {field.label}
                </dt>
                <dd
                  className="break-words font-display text-[14px] leading-snug text-base-content"
                  style={{ fontFamily: "'Fraunces', serif" }}
                >
                  {field.value}
                </dd>
              </div>
            ))}
          </dl>
        )}

        {/* Blocked reason */}
        {blocked && (
          <div className="mx-4 mb-3 flex items-start gap-2 rounded-sm border border-error/50 bg-error/10 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-error">
            <Warning size={12} weight="bold" className="mt-0.5 shrink-0" />
            <span className="normal-case tracking-normal">
              {preview.blockedReason ??
                "approval blocked — insufficient permissions or argument errors"}
            </span>
          </div>
        )}

        {/* Footer with stamps */}
        <footer className="flex items-center justify-between border-t-2 border-base-content/80 bg-base-200/30 px-4 py-3">
          {/* state indicator */}
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-base-content/55">
            {state.kind === "pending" && !settled && <span>awaiting stamp</span>}
            {state.kind === "running" && (
              <span className="flex items-center gap-1.5 text-primary">
                <CircleNotch size={12} weight="bold" className="animate-spin" />
                pressing...
              </span>
            )}
            {state.kind === "succeeded" && (
              <span className="flex items-center gap-1.5 text-primary">
                <CheckCircle size={12} weight="fill" />
                pressed · job {String(state.outcome.auditLogId ?? "—").slice(0, 8)}
              </span>
            )}
            {state.kind === "failed" && (
              <span className="flex items-center gap-1.5 text-error">
                <XCircle size={12} weight="fill" />
                killed · {state.message.slice(0, 42)}
              </span>
            )}
            {settled && state.kind === "pending" && <span>already filed</span>}
          </div>

          <div className="flex items-center gap-2">
            {state.kind !== "succeeded" && state.kind !== "running" && !settled && (
              <button
                type="button"
                onClick={onCancel}
                className="wire-stamp flex items-center gap-1 rounded-sm border-2 border-base-content/60 bg-base-100 px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-base-content transition hover:bg-base-200"
              >
                <XCircle size={12} weight="bold" />
                kill
              </button>
            )}
            {state.kind !== "succeeded" && !settled && (
              <button
                type="button"
                onClick={handleApprove}
                disabled={blocked || state.kind === "running"}
                className="wire-stamp flex items-center gap-1 rounded-sm border-2 border-primary/80 bg-primary px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-primary-content shadow-[2px_2px_0_0_rgba(17,17,17,0.2)] transition hover:-translate-y-[1px] hover:shadow-[2px_3px_0_0_rgba(17,17,17,0.25)] active:translate-y-[1px] active:shadow-none disabled:cursor-not-allowed disabled:border-base-content/25 disabled:bg-base-200 disabled:text-base-content/40 disabled:shadow-none"
              >
                <Stamp size={12} weight="fill" />
                {state.kind === "running" ? "pressing" : "approve"}
              </button>
            )}
          </div>
        </footer>

        {/* APPROVED stamp overlay */}
        {state.kind === "succeeded" && (
          <div
            aria-hidden
            className="pointer-events-none absolute right-4 top-10 rotate-[-12deg] border-[3px] border-primary/80 px-3 py-1 font-mono text-[13px] font-black uppercase tracking-[0.2em] text-primary/85 opacity-80"
            style={{ borderRadius: 2 }}
          >
            approved
          </div>
        )}
        {state.kind === "failed" && (
          <div
            aria-hidden
            className="pointer-events-none absolute right-4 top-10 rotate-[-12deg] border-[3px] border-error/80 px-3 py-1 font-mono text-[13px] font-black uppercase tracking-[0.2em] text-error/85 opacity-80"
            style={{ borderRadius: 2 }}
          >
            killed
          </div>
        )}
      </div>
    </div>
  );
}
