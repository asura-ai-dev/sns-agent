"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowsClockwise,
  CheckCircle,
  Plugs,
  PlugsConnected,
  SignOut,
  WarningCircle,
} from "@phosphor-icons/react";
import type { LlmProviderStatusDto, LlmProviderConnectionStatus } from "@/lib/api";

interface LlmProviderConnectionPanelProps {
  initialStatus: LlmProviderStatusDto;
  isFallback: boolean;
}

const STATUS_COPY: Record<
  LlmProviderConnectionStatus,
  {
    label: string;
    eyebrow: string;
    description: string;
    toneClass: string;
  }
> = {
  missing: {
    label: "未接続",
    eyebrow: "not connected",
    description: "ChatGPT / Codex ログイン方式の認証情報は、まだこのワークスペースにありません。",
    toneClass: "border-base-content/20 bg-base-100 text-base-content",
  },
  connected: {
    label: "接続済み",
    eyebrow: "connected",
    description:
      "暗号化済みの認証情報が保存されています。Agent Gateway 連携は後続 PR で接続します。",
    toneClass: "border-primary/45 bg-primary/10 text-primary",
  },
  expired: {
    label: "期限切れ",
    eyebrow: "expired",
    description:
      "保存済みの認証情報はありますが、有効期限を過ぎています。API停止ではなく、再認証が必要な状態です。",
    toneClass: "border-warning/60 bg-warning/10 text-[#7a4b00]",
  },
  reauth_required: {
    label: "再認証必要",
    eyebrow: "reauth required",
    description:
      "OpenAI / Codex 側の認証をもう一度確認する必要があります。API停止とは別の状態です。",
    toneClass: "border-error/45 bg-error/10 text-error",
  },
};

function getApiBase(): string {
  const env =
    (typeof process !== "undefined" &&
      (process.env?.NEXT_PUBLIC_API_BASE_URL ?? process.env?.NEXT_PUBLIC_SNS_AGENT_API_URL)) ||
    "";
  return env.replace(/\/+$/, "");
}

function statusIcon(status: LlmProviderConnectionStatus) {
  if (status === "connected") return <CheckCircle size={18} weight="bold" />;
  if (status === "missing") return <Plugs size={18} weight="bold" />;
  return <WarningCircle size={18} weight="bold" />;
}

function formatDate(value: string | null): string {
  if (!value) return "未設定";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未設定";
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function LlmProviderConnectionPanel({
  initialStatus,
  isFallback,
}: LlmProviderConnectionPanelProps) {
  const router = useRouter();
  const [isRefreshing, startTransition] = useTransition();
  const [status, setStatus] = useState(initialStatus);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const copy = STATUS_COPY[status.status];
  const canDisconnect = status.status !== "missing" && !isFallback;

  async function disconnect() {
    if (!canDisconnect) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${getApiBase()}/api/llm/providers/openai-codex/disconnect`, {
        method: "DELETE",
        credentials: "include",
        headers: {
          "X-Idempotency-Key":
            typeof crypto !== "undefined" && crypto.randomUUID
              ? crypto.randomUUID()
              : `${Date.now()}-${Math.random()}`,
        },
      });
      if (!res.ok) {
        let message = `HTTP ${res.status}`;
        try {
          const body = (await res.json()) as { error?: { message?: string } };
          if (body.error?.message) message = body.error.message;
        } catch {
          // keep HTTP status message
        }
        throw new Error(message);
      }
      const body = (await res.json()) as { data: LlmProviderStatusDto };
      setStatus(body.data);
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "切断に失敗しました。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-sm border border-base-content/15 bg-base-100 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-base-content/45">
            <PlugsConnected size={13} weight="bold" />
            provider connection
          </div>
          <h2
            className="mt-1 font-display text-xl font-semibold text-base-content"
            style={{ fontFamily: "'Fraunces', serif" }}
          >
            OpenAI Codex / ChatGPT ログイン
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-base-content/65">
            従来の OpenAI APIキー方式とは別に、Codex
            系の認証情報をワークスペース単位で持つための状態表示です。
          </p>
        </div>

        <button
          type="button"
          onClick={disconnect}
          disabled={!canDisconnect || busy}
          className="inline-flex items-center gap-2 rounded-sm border border-base-content/25 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-base-content/65 transition-colors hover:border-error/50 hover:bg-error/10 hover:text-error disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? (
            <ArrowsClockwise size={12} weight="bold" className="animate-spin" />
          ) : (
            <SignOut size={12} weight="bold" />
          )}
          切断
        </button>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_1.1fr]">
        <div className={`rounded-sm border px-3 py-3 ${copy.toneClass}`}>
          <div className="flex items-center gap-2">
            {statusIcon(status.status)}
            <div>
              <div className="font-mono text-[9px] uppercase tracking-[0.2em] opacity-70">
                {copy.eyebrow}
              </div>
              <div
                className="font-display text-lg font-semibold"
                style={{ fontFamily: "'Fraunces', serif" }}
              >
                {copy.label}
              </div>
            </div>
          </div>
          <p className="mt-2 text-sm leading-relaxed opacity-80">{copy.description}</p>
        </div>

        <div className="rounded-sm border border-dashed border-base-content/20 bg-base-200/25 px-3 py-3">
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="font-mono text-[9px] uppercase tracking-[0.18em] text-base-content/40">
                provider
              </dt>
              <dd className="mt-0.5 font-mono text-[11px] text-base-content/75">
                {status.provider}
              </dd>
            </div>
            <div>
              <dt className="font-mono text-[9px] uppercase tracking-[0.18em] text-base-content/40">
                expires
              </dt>
              <dd className="mt-0.5 text-sm text-base-content/75">
                {formatDate(status.expiresAt)}
              </dd>
            </div>
            <div>
              <dt className="font-mono text-[9px] uppercase tracking-[0.18em] text-base-content/40">
                subject
              </dt>
              <dd className="mt-0.5 truncate text-sm text-base-content/75">
                {status.subject ?? "未設定"}
              </dd>
            </div>
            <div>
              <dt className="font-mono text-[9px] uppercase tracking-[0.18em] text-base-content/40">
                scopes
              </dt>
              <dd className="mt-0.5 truncate text-sm text-base-content/75">
                {status.scopes?.length ? status.scopes.join(", ") : "未設定"}
              </dd>
            </div>
          </dl>
        </div>
      </div>

      {isFallback && (
        <div className="mt-3 flex items-start gap-2 rounded-sm border border-dashed border-warning/60 bg-warning/10 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.15em] text-[#7a4b00]">
          <WarningCircle size={12} weight="bold" className="mt-0.5 shrink-0" />
          <span>wire offline · APIに接続できない状態です。認証切れや再認証必要とは別です</span>
        </div>
      )}

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-sm border border-error/40 bg-error/10 px-3 py-2 font-mono text-[11px] text-error">
          <WarningCircle size={12} weight="bold" className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      {isRefreshing && (
        <div className="mt-3 flex items-start gap-2 rounded-sm border border-info/30 bg-info/10 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.15em] text-info">
          <ArrowsClockwise size={12} weight="bold" className="mt-0.5 shrink-0 animate-spin" />
          <span>接続状態を同期しています</span>
        </div>
      )}
    </section>
  );
}
