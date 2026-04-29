"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  CalendarBlank,
  CheckCircle,
  CircleNotch,
  Eye,
  FloppyDisk,
  PaperPlaneTilt,
  Warning,
} from "@phosphor-icons/react";
import { fetchConnectedAccounts } from "../posts/api";
import {
  createCampaignApi,
  type CampaignCreateResponse,
  type CampaignMode,
  type PostSocialAccount,
} from "./api";

export interface CampaignWizardSnapshot {
  id: string;
  name: string;
  mode: CampaignMode;
  postStatus: string;
  gateStatus: "active" | "paused";
  postText: string | null;
  conditions: {
    requireLike?: boolean;
    requireRepost?: boolean;
    requireFollow?: boolean;
  } | null;
  lineHarness: {
    url: string | null;
    tag: string | null;
    scenario: string | null;
  };
  verifyUrl: string;
  updatedAt: string;
}

export type CampaignWizardState = "loading" | "empty" | "error" | "ready";

interface CampaignWizardViewProps {
  state: CampaignWizardState;
  campaigns: CampaignWizardSnapshot[];
  errorMessage?: string;
  wizardSlot?: ReactNode;
}

interface CampaignWizardProps {
  initialState: CampaignWizardState;
  initialCampaigns: CampaignWizardSnapshot[];
  errorMessage?: string;
}

function conditionLabels(conditions: CampaignWizardSnapshot["conditions"]): string[] {
  const labels: string[] = [];
  if (conditions?.requireLike) labels.push("like");
  if (conditions?.requireRepost) labels.push("repost");
  if (conditions?.requireFollow) labels.push("follow");
  return labels.length > 0 ? labels : ["reply only"];
}

function campaignFromResponse(res: CampaignCreateResponse): CampaignWizardSnapshot {
  return {
    id: res.id,
    name: res.gate.name,
    mode: res.mode,
    postStatus: res.post.status,
    gateStatus: res.gate.status,
    postText: res.post.contentText,
    conditions: res.gate.conditions,
    lineHarness: {
      url: res.gate.lineHarnessUrl,
      tag: res.gate.lineHarnessTag,
      scenario: res.gate.lineHarnessScenario,
    },
    verifyUrl: res.verifyUrl,
    updatedAt: res.gate.updatedAt ?? res.post.updatedAt,
  };
}

function statusTone(status: string): string {
  if (status === "active" || status === "published") return "text-success";
  if (status === "scheduled") return "text-info";
  if (status === "paused" || status === "draft") return "text-warning";
  return "text-base-content/60";
}

function StatePanel({
  state,
  errorMessage,
}: {
  state: Exclude<CampaignWizardState, "ready">;
  errorMessage?: string;
}) {
  const copy = {
    loading: {
      label: "loading campaign wizard",
      title: "Loading campaign drafts",
      body: "Fetching X campaign records and validation context.",
    },
    empty: {
      label: "no records filed",
      title: "No campaign drafts yet",
      body: "Compose a campaign draft, then publish now or schedule it after preview.",
    },
    error: {
      label: "wire offline",
      title: "Campaign data unavailable",
      body: errorMessage ?? "The campaign API could not be reached.",
    },
  }[state];

  return (
    <section
      className={[
        "rounded-box border px-5 py-6",
        state === "error"
          ? "border-warning/50 bg-warning/10 text-[#7a4b00]"
          : "border-dashed border-base-300 bg-base-100",
      ].join(" ")}
    >
      <div className="flex items-start gap-3">
        {state === "loading" ? (
          <CircleNotch size={18} weight="bold" className="mt-0.5 animate-spin" />
        ) : state === "error" ? (
          <Warning size={18} weight="bold" className="mt-0.5 shrink-0" />
        ) : (
          <CheckCircle size={18} weight="bold" className="mt-0.5 text-base-content/40" />
        )}
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] opacity-70">
            {copy.label}
          </p>
          <h2 className="mt-2 font-display text-2xl font-semibold leading-tight">{copy.title}</h2>
          <p className="mt-2 text-sm leading-6 opacity-75">{copy.body}</p>
        </div>
      </div>
    </section>
  );
}

function CampaignRows({ campaigns }: { campaigns: CampaignWizardSnapshot[] }) {
  if (campaigns.length === 0) return <StatePanel state="empty" />;

  return (
    <section aria-label="Campaign records" className="space-y-3">
      {campaigns.slice(0, 8).map((campaign) => {
        const labels = conditionLabels(campaign.conditions);
        return (
          <article
            key={campaign.id}
            className="rounded-box border border-base-300 bg-base-100 px-5 py-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-base-content/45">
                  {campaign.mode} / {campaign.gateStatus}
                </p>
                <h2 className="mt-1 break-words font-display text-xl font-semibold leading-tight text-base-content">
                  {campaign.name}
                </h2>
                <p className="mt-1 break-words text-sm leading-6 text-base-content/60">
                  {campaign.postText ?? "No post text saved"}
                </p>
              </div>
              <span
                className={[
                  "rounded-field border border-base-300 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em]",
                  statusTone(campaign.postStatus),
                ].join(" ")}
              >
                {campaign.postStatus}
              </span>
            </div>
            <dl className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="border-t border-dashed border-base-300 pt-2">
                <dt className="font-mono text-[9px] uppercase tracking-[0.16em] text-base-content/40">
                  Validation
                </dt>
                <dd className="mt-1 text-sm font-semibold text-base-content">
                  {labels.join(" + ")}
                </dd>
              </div>
              <div className="border-t border-dashed border-base-300 pt-2">
                <dt className="font-mono text-[9px] uppercase tracking-[0.16em] text-base-content/40">
                  LINE handoff
                </dt>
                <dd className="mt-1 break-words text-sm font-semibold text-base-content">
                  {campaign.lineHarness.tag ?? campaign.lineHarness.scenario ?? "not configured"}
                </dd>
              </div>
              <div className="border-t border-dashed border-base-300 pt-2">
                <dt className="font-mono text-[9px] uppercase tracking-[0.16em] text-base-content/40">
                  Verify API
                </dt>
                <dd className="mt-1 break-words text-sm font-semibold text-base-content">
                  {campaign.verifyUrl}
                </dd>
              </div>
            </dl>
          </article>
        );
      })}
    </section>
  );
}

export function CampaignWizardView({
  state,
  campaigns,
  errorMessage,
  wizardSlot,
}: CampaignWizardViewProps) {
  return (
    <main
      className="mx-auto max-w-[1440px] space-y-6"
      data-campaign-wizard-layout="flat"
      data-x-parity-shell="flat"
    >
      <header className="border-b border-base-300 pb-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-base-content/45">
          X Harness
        </p>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="break-words font-display text-4xl font-semibold leading-tight text-base-content">
              Campaign Desk
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-base-content/65">
              Build the X post, engagement conditions, LINE handoff, preview, and draft or
              publish-or-schedule decision in one flow.
            </p>
          </div>
        </div>
      </header>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.72fr)]">
        {wizardSlot ?? (
          <section className="rounded-box border border-base-300 bg-base-100 p-5">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-base-content/45">
              publish or schedule
            </p>
            <h2 className="mt-2 font-display text-2xl font-semibold leading-tight text-base-content">
              Campaign wizard
            </h2>
          </section>
        )}

        <aside className="space-y-4">
          <section className="rounded-box border border-base-300 bg-base-100 p-5">
            <div className="flex items-center gap-2">
              <Eye size={16} weight="bold" className="text-base-content/45" />
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-base-content/45">
                Preview
              </p>
            </div>
            <p className="mt-2 text-sm leading-6 text-base-content/65">
              Review copy, conditions, LINE handoff, and Verify API before creating the campaign.
            </p>
          </section>
          {state === "loading" ? (
            <StatePanel state="loading" />
          ) : state === "error" ? (
            <StatePanel state="error" errorMessage={errorMessage} />
          ) : (
            <CampaignRows campaigns={campaigns} />
          )}
        </aside>
      </div>
    </main>
  );
}

function scheduleValidation(mode: CampaignMode, scheduledAt: string): string | null {
  if (mode !== "schedule") return null;
  if (!scheduledAt) return "予約日時を入力してください";
  const parsed = new Date(scheduledAt);
  if (Number.isNaN(parsed.getTime())) return "予約日時の形式が正しくありません";
  if (parsed.getTime() <= Date.now()) return "予約日時は未来を指定してください";
  return null;
}

export function CampaignWizard({
  initialState,
  initialCampaigns,
  errorMessage,
}: CampaignWizardProps) {
  const [campaigns, setCampaigns] = useState(initialCampaigns);
  const [accounts, setAccounts] = useState<PostSocialAccount[]>([]);
  const [accountsState, setAccountsState] = useState<CampaignWizardState>("loading");
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [name, setName] = useState("Launch reward campaign");
  const [postText, setPostText] = useState("");
  const [mode, setMode] = useState<CampaignMode>("draft");
  const [scheduledAt, setScheduledAt] = useState("");
  const [requireLike, setRequireLike] = useState(true);
  const [requireRepost, setRequireRepost] = useState(false);
  const [requireFollow, setRequireFollow] = useState(true);
  const [lineEnabled, setLineEnabled] = useState(true);
  const [lineHarnessUrl, setLineHarnessUrl] = useState("");
  const [lineHarnessTag, setLineHarnessTag] = useState("launch");
  const [lineHarnessScenario, setLineHarnessScenario] = useState("reward-a");
  const [submitting, setSubmitting] = useState<CampaignMode | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      const res = await fetchConnectedAccounts(ctrl.signal);
      if (res.ok) {
        const xAccounts = res.value.filter((account) => account.platform === "x");
        setAccounts(xAccounts);
        setSelectedAccountId((current) => current || xAccounts[0]?.id || "");
        setAccountsState(xAccounts.length > 0 ? "ready" : "empty");
      } else if (res.error.code !== "ABORTED") {
        setAccountsState("error");
      }
    })();
    return () => ctrl.abort();
  }, []);

  const validation = useMemo(() => {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!selectedAccountId) errors.push("X アカウントを選択してください");
    if (!name.trim()) errors.push("キャンペーン名を入力してください");
    if (!postText.trim()) errors.push("投稿本文を入力してください");
    if (postText.length > 280) errors.push("X 投稿本文は 280 文字以内にしてください");
    const scheduleMessage = scheduleValidation(mode, scheduledAt);
    if (scheduleMessage) errors.push(scheduleMessage);
    if (lineEnabled && !lineHarnessUrl.trim()) {
      warnings.push("LINE handoff URL が未設定です。Verify API のみで作成されます");
    }
    return { errors, warnings };
  }, [lineEnabled, lineHarnessUrl, mode, name, postText, scheduledAt, selectedAccountId]);

  const hasBaseCampaignInput =
    accountsState === "ready" &&
    !!selectedAccountId &&
    name.trim().length > 0 &&
    postText.trim().length > 0 &&
    postText.length <= 280;
  const canSubmitMode = (submitMode: CampaignMode): boolean =>
    hasBaseCampaignInput && scheduleValidation(submitMode, scheduledAt) === null;

  const submit = async (submitMode: CampaignMode) => {
    if (!canSubmitMode(submitMode)) {
      setMode(submitMode);
      return;
    }
    setMode(submitMode);
    setSubmitting(submitMode);
    setSubmitError(null);
    setSuccess(null);
    const res = await createCampaignApi({
      socialAccountId: selectedAccountId,
      name,
      mode: submitMode,
      scheduledAt: submitMode === "schedule" ? new Date(scheduledAt).toISOString() : null,
      post: {
        contentText: postText,
        contentMedia: null,
        providerMetadata: null,
      },
      conditions: { requireLike, requireRepost, requireFollow },
      actionType: "verify_only",
      lineHarnessUrl: lineEnabled ? lineHarnessUrl || null : null,
      lineHarnessTag: lineEnabled ? lineHarnessTag || null : null,
      lineHarnessScenario: lineEnabled ? lineHarnessScenario || null : null,
    });
    setSubmitting(null);
    if (!res.ok) {
      setSubmitError(res.error.message);
      return;
    }
    setCampaigns((current) => [campaignFromResponse(res.value), ...current]);
    setSuccess(
      submitMode === "publish"
        ? "Campaign published"
        : submitMode === "schedule"
          ? "Campaign scheduled"
          : "Campaign draft saved",
    );
  };

  const wizardSlot = (
    <section className="rounded-box border border-base-300 bg-base-100 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-base-content/45">
            publish or schedule
          </p>
          <h2 className="mt-2 font-display text-2xl font-semibold leading-tight text-base-content">
            Campaign wizard
          </h2>
        </div>
        <span className="rounded-field border border-base-300 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-base-content/55">
          {accountsState === "loading" ? "loading accounts" : `${accounts.length} x accounts`}
        </span>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <label className="block">
          <span className="mb-2 block text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-base-content/50">
            X account
          </span>
          <select
            value={selectedAccountId}
            onChange={(e) => setSelectedAccountId(e.target.value)}
            className="w-full rounded-field border border-base-300 bg-base-100 px-3 py-2 text-sm text-base-content focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/15"
          >
            {accounts.length === 0 ? <option value="">No X accounts</option> : null}
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-2 block text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-base-content/50">
            Campaign name
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-field border border-base-300 bg-base-100 px-3 py-2 text-sm text-base-content focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/15"
          />
        </label>
      </div>

      <label className="mt-4 block">
        <span className="mb-2 block text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-base-content/50">
          Post copy
        </span>
        <textarea
          value={postText}
          onChange={(e) => setPostText(e.target.value)}
          rows={7}
          placeholder="Reply to this post to unlock the LINE reward."
          className="min-h-40 w-full resize-y rounded-field border border-base-300 bg-base-100 px-3 py-3 text-sm leading-6 text-base-content focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/15"
        />
      </label>

      <div className="mt-4 border-t border-dashed border-base-300 pt-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-base-content/45">
          Validation
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {[
            ["like", requireLike, setRequireLike],
            ["repost", requireRepost, setRequireRepost],
            ["follow", requireFollow, setRequireFollow],
          ].map(([label, checked, setter]) => (
            <label
              key={label as string}
              className="inline-flex items-center gap-2 rounded-field border border-base-300 px-3 py-2 text-sm text-base-content/70"
            >
              <input
                type="checkbox"
                checked={checked as boolean}
                onChange={(e) => (setter as (value: boolean) => void)(e.target.checked)}
                className="checkbox checkbox-xs"
              />
              {label as string}
            </label>
          ))}
        </div>
      </div>

      <div className="mt-4 border-t border-dashed border-base-300 pt-4">
        <label className="inline-flex items-center gap-2 text-sm font-medium text-base-content/70">
          <input
            type="checkbox"
            checked={lineEnabled}
            onChange={(e) => setLineEnabled(e.target.checked)}
            className="checkbox checkbox-xs"
          />
          LINE handoff
        </label>
        {lineEnabled ? (
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <input
              value={lineHarnessUrl}
              onChange={(e) => setLineHarnessUrl(e.target.value)}
              placeholder="LINE Harness URL"
              className="rounded-field border border-base-300 bg-base-100 px-3 py-2 text-sm text-base-content focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/15 md:col-span-3"
            />
            <input
              value={lineHarnessTag}
              onChange={(e) => setLineHarnessTag(e.target.value)}
              placeholder="tag"
              className="rounded-field border border-base-300 bg-base-100 px-3 py-2 text-sm text-base-content focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/15"
            />
            <input
              value={lineHarnessScenario}
              onChange={(e) => setLineHarnessScenario(e.target.value)}
              placeholder="scenario"
              className="rounded-field border border-base-300 bg-base-100 px-3 py-2 text-sm text-base-content focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/15 md:col-span-2"
            />
          </div>
        ) : null}
      </div>

      <div className="mt-4 border-t border-dashed border-base-300 pt-4">
        <div className="flex flex-wrap gap-2">
          {(["draft", "publish", "schedule"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              className={[
                "inline-flex items-center gap-2 rounded-field border px-3 py-2 text-sm transition-colors",
                mode === value
                  ? "border-primary/40 bg-primary/10 font-semibold text-primary"
                  : "border-base-300 bg-base-100 text-base-content/70 hover:border-base-content/25",
              ].join(" ")}
            >
              {value === "draft" ? (
                <FloppyDisk size={14} weight="bold" />
              ) : value === "publish" ? (
                <PaperPlaneTilt size={14} weight="bold" />
              ) : (
                <CalendarBlank size={14} weight="bold" />
              )}
              {value}
            </button>
          ))}
        </div>
        {mode === "schedule" ? (
          <input
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            className="mt-3 w-full rounded-field border border-base-300 bg-base-100 px-3 py-2 text-sm text-base-content focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/15"
          />
        ) : null}
      </div>

      {(validation.errors.length > 0 || validation.warnings.length > 0 || submitError) && (
        <div className="mt-4 rounded-field border border-warning/40 bg-warning/10 px-3 py-3 text-sm leading-6 text-[#7a4b00]">
          {submitError ? <p>{submitError}</p> : null}
          {validation.errors.map((error) => (
            <p key={error}>{error}</p>
          ))}
          {validation.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      )}
      {success ? (
        <p className="mt-4 rounded-field border border-success/30 bg-success/10 px-3 py-3 text-sm text-success">
          {success}
        </p>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-2">
        {(["draft", "publish", "schedule"] as const).map((submitMode) => (
          <button
            key={submitMode}
            type="button"
            disabled={!canSubmitMode(submitMode) || submitting !== null}
            onClick={() => void submit(submitMode)}
            className="inline-flex min-h-10 items-center gap-2 rounded-field border border-base-300 bg-base-100 px-3 py-2 text-sm font-medium text-base-content/70 transition-colors hover:border-base-content/30 hover:text-base-content disabled:cursor-not-allowed disabled:opacity-45"
          >
            {submitting === submitMode ? (
              <CircleNotch size={14} weight="bold" className="animate-spin" />
            ) : submitMode === "draft" ? (
              <FloppyDisk size={14} weight="bold" />
            ) : submitMode === "publish" ? (
              <PaperPlaneTilt size={14} weight="bold" />
            ) : (
              <CalendarBlank size={14} weight="bold" />
            )}
            {submitMode}
          </button>
        ))}
      </div>
    </section>
  );

  const viewState: CampaignWizardState =
    initialState === "error" ? "error" : campaigns.length > 0 ? "ready" : "empty";

  return (
    <CampaignWizardView
      state={viewState}
      campaigns={campaigns}
      errorMessage={errorMessage}
      wizardSlot={wizardSlot}
    />
  );
}
