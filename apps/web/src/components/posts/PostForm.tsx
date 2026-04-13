/**
 * Task 3006: 投稿作成フォーム (Client Component)
 *
 * 責務:
 *  - 接続済みアカウントの取得（/api/accounts）と SNS 選択
 *  - テキスト入力 + リアルタイムバリデーション（文字数カウンター + プラットフォーム制約）
 *  - メディアアップロードプレースホルダ（DnD + file picker, url プレビューは ObjectURL）
 *  - 下書き保存 / 即時投稿
 *  - 送信成功後 /posts に遷移
 *
 * デザイン: 2 ペイン (Composer / Preview)。モバイルでは縦積み。
 */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  FloppyDisk,
  PaperPlaneTilt,
  Warning,
  WarningOctagon,
  Image as ImageIcon,
  Trash,
  UploadSimple,
  CaretDown,
} from "@phosphor-icons/react";
import { PlatformIcon, PLATFORM_VISUALS } from "@/components/settings/PlatformIcon";
import { toDatetimeLocalValue } from "@/components/calendar/dateUtils";
import { COMMON_ACTIONS, SECTION_KICKERS } from "@/lib/i18n/labels";
import { CharacterCounter } from "./CharacterCounter";
import { PostPreview } from "./PostPreview";
import { PLATFORM_LIMITS, getCounterZone } from "./platformLimits";
import { createPostApi, createScheduleApi, fetchConnectedAccounts, type ApiFailure } from "./api";
import type { MediaAttachment, Platform, PostSocialAccount } from "./types";

// ───────────────────────────────────────────
// バリデーション
// ───────────────────────────────────────────

interface ValidationReport {
  canDraft: boolean;
  canPublish: boolean;
  errors: string[];
  warnings: string[];
}

function validate(
  account: PostSocialAccount | null,
  text: string,
  media: MediaAttachment[],
): ValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!account) {
    errors.push("SNS アカウントを選択してください");
  } else {
    const limit = PLATFORM_LIMITS[account.platform].textLimit;
    if (text.length > limit) {
      errors.push(
        `本文が上限 ${limit.toLocaleString()} 文字を超えています（現在 ${text.length.toLocaleString()} 文字）`,
      );
    } else if (text.length >= limit * 0.95 && text.length <= limit) {
      warnings.push("上限に近付いています");
    }

    if (account.platform === "instagram" && media.length === 0) {
      warnings.push("Instagram は原則メディアが必須です（API 側で最終検証されます）");
    }
  }

  const hasContent = text.trim().length > 0 || media.length > 0;
  if (!hasContent) {
    errors.push("本文またはメディアを入力してください");
  }

  const canPublish = errors.length === 0;
  // 下書きはアカウント + (本文 or media) だけで OK。超過は許可せず draft でも save 不可にする
  const canDraft = !!account && hasContent && errors.every((e) => !e.includes("上限"));

  return { canDraft, canPublish, errors, warnings };
}

function normalizeScheduledAtInput(value: string | null): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return toDatetimeLocalValue(parsed);
}

function getScheduleValidationMessage(value: string): string | null {
  if (!value) return "予約日時を入力してください";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "予約日時の形式が正しくありません";
  if (parsed.getTime() <= Date.now()) return "予約日時は現在より未来を指定してください";
  return null;
}

function formatScheduledAtLabel(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${parsed.getFullYear()}/${pad(parsed.getMonth() + 1)}/${pad(parsed.getDate())} ${pad(
    parsed.getHours(),
  )}:${pad(parsed.getMinutes())}`;
}

// ───────────────────────────────────────────
// PostForm
// ───────────────────────────────────────────

export function PostForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [accounts, setAccounts] = useState<PostSocialAccount[] | null>(null);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [loadingAccounts, setLoadingAccounts] = useState(true);

  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [text, setText] = useState("");
  const [media, setMedia] = useState<MediaAttachment[]>([]);
  const [scheduledAt, setScheduledAt] = useState("");
  const [submitting, setSubmitting] = useState<"draft" | "publish" | "schedule" | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [lastSuccess, setLastSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const preset = normalizeScheduledAtInput(searchParams.get("scheduledAt"));
    if (preset) {
      setScheduledAt((current) => current || preset);
    }
  }, [searchParams]);

  // ───────── Fetch accounts ─────────
  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      setLoadingAccounts(true);
      setAccountsError(null);
      const res = await fetchConnectedAccounts(ctrl.signal);
      if (res.ok) {
        setAccounts(res.value);
        if (res.value.length > 0 && !selectedAccountId) {
          setSelectedAccountId(res.value[0].id);
        }
      } else if (res.error.code !== "ABORTED") {
        setAccountsError(res.error.message);
        setAccounts([]);
      }
      setLoadingAccounts(false);
    })();
    return () => ctrl.abort();
  }, []);

  const selectedAccount = useMemo(
    () => accounts?.find((a) => a.id === selectedAccountId) ?? null,
    [accounts, selectedAccountId],
  );
  const platform: Platform | null = selectedAccount?.platform ?? null;
  const limit = platform ? PLATFORM_LIMITS[platform].textLimit : 280;
  const zone = getCounterZone(text.length, limit);

  const report = useMemo(
    () => validate(selectedAccount, text, media),
    [selectedAccount, text, media],
  );
  const scheduleValidation = useMemo(
    () => getScheduleValidationMessage(scheduledAt),
    [scheduledAt],
  );
  const canSchedule = report.canPublish && scheduleValidation === null;

  // ───────── Media handling ─────────
  const handleFiles = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    const next: MediaAttachment[] = [];
    for (const f of Array.from(files)) {
      const url = URL.createObjectURL(f);
      const type = f.type.startsWith("video/") ? "video" : "image";
      next.push({ type, url, mimeType: f.type || null, name: f.name });
    }
    setMedia((prev) => [...prev, ...next]);
  }, []);

  const removeMedia = (idx: number) => {
    setMedia((prev) => {
      const item = prev[idx];
      if (item && item.url.startsWith("blob:")) URL.revokeObjectURL(item.url);
      return prev.filter((_, i) => i !== idx);
    });
  };

  useEffect(() => {
    // unmount cleanup
    return () => {
      media.forEach((m) => {
        if (m.url.startsWith("blob:")) URL.revokeObjectURL(m.url);
      });
    };
  }, []);

  // ───────── Submit ─────────
  const submit = async (mode: "draft" | "publish" | "schedule") => {
    if (!selectedAccount) return;
    if (mode === "publish" && !report.canPublish) return;
    if (mode === "draft" && !report.canDraft) return;
    if (mode === "schedule" && !canSchedule) return;

    setSubmitting(mode);
    setSubmitError(null);
    setLastSuccess(null);

    const res = await createPostApi({
      socialAccountId: selectedAccount.id,
      contentText: text,
      contentMedia: media.map((m) => ({
        type: m.type,
        url: m.url,
        mimeType: m.mimeType ?? null,
        name: m.name ?? null,
      })),
      publishNow: mode === "publish",
    });

    if (!res.ok) {
      setSubmitError((res as ApiFailure).error.message);
      setSubmitting(null);
      return;
    }

    if (mode === "schedule") {
      const scheduledIso = new Date(scheduledAt).toISOString();
      const scheduleRes = await createScheduleApi(res.value.id, scheduledIso);
      if (!scheduleRes.ok) {
        setSubmitError(`${scheduleRes.error.message}（投稿自体は下書きとして保存されています）`);
        setSubmitting(null);
        return;
      }
      setLastSuccess(`${formatScheduledAtLabel(scheduledAt)} に予約しました`);
      setSubmitting(null);
      setTimeout(() => router.push("/calendar"), 600);
      return;
    }

    setSubmitting(null);
    setLastSuccess(mode === "publish" ? "投稿を公開しました" : "下書きを保存しました");
    setTimeout(() => router.push("/posts"), 600);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_minmax(0,22rem)]">
      {/* ────────── Composer ────────── */}
      <section
        aria-label={SECTION_KICKERS.compose}
        className="space-y-5 rounded-box border border-base-300 bg-base-100 p-5 sm:p-6"
      >
        {/* Account select */}
        <div>
          <label
            htmlFor="post-account"
            className="mb-2 block text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-base-content/50"
          >
            投稿先アカウント
          </label>
          <AccountSelect
            accounts={accounts}
            loading={loadingAccounts}
            error={accountsError}
            value={selectedAccountId}
            onChange={setSelectedAccountId}
          />
        </div>

        {/* Text area */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <label
              htmlFor="post-text"
              className="block text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-base-content/50"
            >
              本文
            </label>
            {platform && <CharacterCounter length={text.length} platform={platform} compact />}
          </div>
          <div
            className={[
              "rounded-box border bg-base-100 p-1 focus-within:ring-2",
              zone === "over"
                ? "border-error/50 focus-within:border-error focus-within:ring-error/20"
                : zone === "danger"
                  ? "border-accent/50 focus-within:border-accent focus-within:ring-accent/20"
                  : "border-base-300 focus-within:border-primary/60 focus-within:ring-primary/15",
            ].join(" ")}
          >
            <textarea
              id="post-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={9}
              placeholder={
                platform
                  ? `${PLATFORM_VISUALS[platform].label} 向けの本文を入力...`
                  : "SNS アカウントを選択してください"
              }
              disabled={!selectedAccount}
              className="min-h-[10rem] w-full resize-y bg-transparent px-4 py-3 font-display text-[0.95rem] leading-relaxed text-base-content placeholder:text-base-content/40 focus:outline-none disabled:opacity-60"
            />
          </div>
          {platform && (
            <p className="mt-2 text-[0.65rem] uppercase tracking-wider text-base-content/40">
              {PLATFORM_LIMITS[platform].textLimitNote ??
                `上限 ${PLATFORM_LIMITS[platform].textLimit.toLocaleString()} 文字`}
              {" · "}
              {PLATFORM_LIMITS[platform].mediaNote}
            </p>
          )}
        </div>

        {/* Media picker */}
        <div>
          <p className="mb-2 block text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-base-content/50">
            メディア（任意）
          </p>
          <div
            onDragOver={(e) => {
              e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              handleFiles(e.dataTransfer?.files ?? null);
            }}
            className="flex flex-col items-center justify-center rounded-box border border-dashed border-base-300 bg-base-100 px-4 py-6 text-center transition-colors hover:border-base-content/30"
          >
            <UploadSimple size={22} weight="light" className="text-base-content/40" />
            <p className="mt-2 text-xs text-base-content/60">
              画像・動画をドラッグ&ドロップ、または
            </p>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="mt-1 rounded-field border border-base-300 bg-base-100 px-3 py-1 text-[0.7rem] font-medium text-base-content/70 hover:border-base-content/30 hover:text-base-content"
            >
              ファイルを選択
            </button>
            <p className="mt-2 text-[0.6rem] uppercase tracking-wider text-base-content/40">
              アップロード先は v1 ではプレースホルダ
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*"
              multiple
              className="hidden"
              data-testid="post-media-input"
              onChange={(e) => handleFiles(e.target.files)}
            />
          </div>

          {media.length > 0 && (
            <ul className="mt-3 space-y-2">
              {media.map((m, idx) => (
                <li
                  key={`${m.url}-${idx}`}
                  className="flex items-center gap-3 rounded-field border border-base-300 bg-base-100 px-3 py-2"
                >
                  <ImageIcon size={16} weight="bold" className="text-base-content/50" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-base-content">
                      {m.name ?? m.url}
                    </p>
                    <p className="text-[0.6rem] uppercase tracking-wider text-base-content/40">
                      {m.type} {m.mimeType ? `· ${m.mimeType}` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label={`${m.name ?? "メディア"} を${COMMON_ACTIONS.delete}`}
                    onClick={() => removeMedia(idx)}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-field border border-base-300 text-base-content/60 hover:border-error/30 hover:text-error"
                  >
                    <Trash size={12} weight="bold" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Schedule */}
        <div className="rounded-box border border-base-300 bg-base-100 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-base-content/50">
                予約投稿
              </p>
              <p className="mt-1 text-sm text-base-content/70">
                カレンダーから来た場合は日時が自動入力されます。ここで変えれば、その時刻で予約されます。
              </p>
            </div>
            {scheduledAt ? (
              <span className="rounded-field border border-primary/30 bg-primary/5 px-2 py-1 text-[0.65rem] font-medium text-primary">
                {formatScheduledAtLabel(scheduledAt)}
              </span>
            ) : null}
          </div>
          <div className="mt-3 flex flex-col gap-2">
            <label
              htmlFor="post-scheduled-at"
              className="text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-base-content/50"
            >
              日時指定
            </label>
            <input
              id="post-scheduled-at"
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              className="w-full rounded-field border border-base-300 bg-base-100 px-3 py-2 text-sm text-base-content focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/15"
            />
            <p className="text-xs text-base-content/50">
              空欄なら下書き保存か即時投稿、入力すると「予約投稿」ボタンが使えます。
            </p>
            {scheduleValidation ? (
              <div className="rounded-field border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning-content">
                {scheduleValidation}
              </div>
            ) : null}
          </div>
        </div>

        {/* Validation */}
        <ValidationBlock report={report} />

        {/* Submit */}
        <div className="flex flex-col gap-3 border-t border-base-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-[0.65rem] uppercase tracking-wider text-base-content/40">
            {submitError ? (
              <span className="text-error">{submitError}</span>
            ) : lastSuccess ? (
              <span className="text-primary">{lastSuccess}</span>
            ) : (
              "下書き保存・予約投稿・即時投稿から選べます"
            )}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              disabled={!report.canDraft || submitting !== null}
              onClick={() => submit("draft")}
              data-testid="post-submit-draft"
              className="inline-flex items-center gap-2 rounded-field border border-base-300 bg-base-100 px-4 py-2 text-sm font-medium text-base-content transition-colors hover:border-base-content/40 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <FloppyDisk size={14} weight="bold" />
              {submitting === "draft" ? "保存中…" : "下書き保存"}
            </button>
            <button
              type="button"
              disabled={!canSchedule || submitting !== null}
              onClick={() => submit("schedule")}
              data-testid="post-submit-schedule"
              className="inline-flex items-center gap-2 rounded-field border border-primary/30 bg-primary/5 px-4 py-2 text-sm font-semibold text-primary transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <FloppyDisk size={14} weight="bold" />
              {submitting === "schedule" ? "予約中…" : "予約投稿"}
            </button>
            <button
              type="button"
              disabled={!report.canPublish || submitting !== null}
              onClick={() => submit("publish")}
              data-testid="post-submit-publish"
              className="inline-flex items-center gap-2 rounded-field bg-primary px-4 py-2 text-sm font-semibold text-primary-content shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <PaperPlaneTilt size={14} weight="fill" />
              {submitting === "publish" ? "送信中…" : "即時投稿"}
            </button>
          </div>
        </div>
      </section>

      {/* ────────── Preview ────────── */}
      <aside
        aria-label={SECTION_KICKERS.compose}
        className="space-y-3 lg:sticky lg:top-4 lg:self-start"
      >
        <p className="text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-base-content/50">
          Preview
        </p>
        <PostPreview account={selectedAccount} platform={platform} text={text} media={media} />
      </aside>
    </div>
  );
}

// ───────────────────────────────────────────
// AccountSelect
// ───────────────────────────────────────────

function AccountSelect({
  accounts,
  loading,
  error,
  value,
  onChange,
}: {
  accounts: PostSocialAccount[] | null;
  loading: boolean;
  error: string | null;
  value: string;
  onChange: (id: string) => void;
}) {
  if (loading) {
    return (
      <div className="h-11 animate-pulse rounded-field border border-base-300 bg-base-200/40" />
    );
  }

  if (error) {
    return (
      <div className="rounded-field border border-warning/40 bg-warning/5 px-4 py-3 text-xs text-base-content/75">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-warning">
          desk wire offline · using local fallback
        </p>
        <p className="mt-1 text-xs text-base-content/70">
          アカウント一覧を取得できませんでした{" "}
          <span className="font-mono text-[10px] text-base-content/50">· {error}</span>
        </p>
      </div>
    );
  }

  if (!accounts || accounts.length === 0) {
    return (
      <div className="rounded-field border border-dashed border-base-300 bg-base-100 px-4 py-3 text-xs text-base-content/60">
        接続済みアカウントがありません。
        <a
          href="/settings/accounts"
          className="ml-1 text-primary underline-offset-2 hover:underline"
        >
          設定 → アカウント接続
        </a>
        から追加してください。
      </div>
    );
  }

  const selected = accounts.find((a) => a.id === value) ?? accounts[0];
  const visual = PLATFORM_VISUALS[selected.platform];

  return (
    <div className="relative">
      <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2">
        <PlatformIcon platform={selected.platform} size={24} />
      </div>
      <select
        id="post-account"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid="post-account-select"
        className="w-full appearance-none rounded-field border border-base-300 bg-base-100 py-2.5 pl-12 pr-10 text-sm font-medium text-base-content focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/15"
      >
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {PLATFORM_VISUALS[a.platform].label} — {a.displayName}
          </option>
        ))}
      </select>
      <CaretDown
        size={14}
        weight="bold"
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-base-content/50"
      />
      <span className="sr-only">{visual.label}</span>
    </div>
  );
}

// ───────────────────────────────────────────
// ValidationBlock
// ───────────────────────────────────────────

function ValidationBlock({ report }: { report: ValidationReport }) {
  if (report.errors.length === 0 && report.warnings.length === 0) {
    return (
      <div className="rounded-field border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-primary">
        送信準備ができています
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {report.errors.map((e, i) => (
        <div
          key={`e-${i}`}
          className="flex items-start gap-2 rounded-field border border-error/30 bg-error/5 px-3 py-2 text-xs text-error"
        >
          <WarningOctagon size={14} weight="bold" className="mt-0.5 shrink-0" />
          <span>{e}</span>
        </div>
      ))}
      {report.warnings.map((w, i) => (
        <div
          key={`w-${i}`}
          className="flex items-start gap-2 rounded-field border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning-content"
        >
          <Warning size={14} weight="bold" className="mt-0.5 shrink-0" />
          <span>{w}</span>
        </div>
      ))}
    </div>
  );
}
