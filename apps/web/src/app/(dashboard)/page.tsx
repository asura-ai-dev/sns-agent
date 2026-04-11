/**
 * Dashboard page — Task 3005
 *
 * Server Component. Aggregates data from four API endpoints (accounts, posts,
 * schedules, usage summary) through the server-side SDK wrapper in
 * `@/lib/api`, then hands pre-shaped props to the three dashboard components.
 *
 * Failure mode: if any endpoint fails (e.g. the API process is not running),
 * the corresponding fetcher falls back to an empty payload and the page still
 * renders a coherent empty-state "morning edition" without throwing.
 *
 * spec.md AC-11: 全SNSの投稿数・予約数・使用量サマリを表示。
 */
import { CalendarBlank, RssSimple } from "@phosphor-icons/react/dist/ssr";

import {
  fetchAccountsSafe,
  fetchRecentPostsSafe,
  fetchSchedulesSafe,
  fetchUsageSummarySafe,
} from "@/lib/api";
import type { SocialAccount, Post, ScheduledJob } from "@/lib/api";
import { SECTION_KICKERS } from "@/lib/i18n/labels";

import { SummaryCards } from "@/components/dashboard/SummaryCards";
import { PlatformOverview } from "@/components/dashboard/PlatformOverview";
import type { PlatformStats, Platform } from "@/components/dashboard/PlatformOverview";
import { RecentActivity } from "@/components/dashboard/RecentActivity";
import type { ActivityItem, ActivityKind } from "@/components/dashboard/RecentActivity";

// ───────────────────────────────────────────
// Type helpers
// ───────────────────────────────────────────
// API JSON wire types: Dates on the server become ISO strings over the wire.
// The SDK types still declare them as Date | null, so we treat them as strings
// safely at aggregation time.

type Isoish = string | Date | null | undefined;

function toIso(value: Isoish): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function toMillis(value: Isoish): number {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

// ───────────────────────────────────────────
// Dateline helpers
// ───────────────────────────────────────────

function formatDateline(now: Date): { weekday: string; date: string; iso: string } {
  const weekdayFmt = now.toLocaleDateString("en-US", { weekday: "long" });
  const monthFmt = now.toLocaleDateString("en-US", { month: "long" });
  const day = now.getDate();
  const year = now.getFullYear();
  return {
    weekday: weekdayFmt.toUpperCase(),
    date: `${monthFmt} ${day}, ${year}`.toUpperCase(),
    iso: now.toISOString(),
  };
}

function isoWeek(now: Date): number {
  const date = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

// ───────────────────────────────────────────
// Aggregation
// ───────────────────────────────────────────

function aggregatePlatformStats(accounts: SocialAccount[], posts: Post[]): PlatformStats[] {
  const platforms: Platform[] = ["x", "line", "instagram"];
  return platforms.map((platform) => {
    const accountCount = accounts.filter(
      (a) => a.platform === platform && a.status === "active",
    ).length;
    const platformPosts = posts.filter((p) => p.platform === platform);

    // latest published (or most recent created if no publish)
    const published = platformPosts
      .filter((p) => p.status === "published")
      .map(
        (p) =>
          toMillis(p.publishedAt as unknown as Isoish) ||
          toMillis(p.createdAt as unknown as Isoish),
      )
      .filter((t) => t > 0);
    const latestMillis = published.length > 0 ? Math.max(...published) : 0;
    const latestPostAt = latestMillis > 0 ? new Date(latestMillis).toISOString() : null;

    // success rate: published / (published + failed) among attempted posts
    const publishedCount = platformPosts.filter((p) => p.status === "published").length;
    const failedCount = platformPosts.filter((p) => p.status === "failed").length;
    const attempted = publishedCount + failedCount;
    const successRate = attempted === 0 ? null : publishedCount / attempted;

    return {
      platform,
      accountCount,
      latestPostAt,
      successRate,
      totalAttempts: attempted,
    };
  });
}

function buildActivity(posts: Post[], schedules: ScheduledJob[]): ActivityItem[] {
  const items: ActivityItem[] = [];

  for (const p of posts) {
    const createdAtIso = toIso(p.createdAt as unknown as Isoish);
    const publishedAtIso = toIso(p.publishedAt as unknown as Isoish);
    const platform = (p.platform as ActivityItem["platform"]) ?? "x";
    const snippet = (p.contentText ?? "").trim().replace(/\s+/g, " ").slice(0, 80);
    const title = snippet ? `「${snippet}${snippet.length >= 80 ? "…" : ""}」` : "本文なし";

    if (p.status === "published" && publishedAtIso) {
      items.push({
        id: `post-pub-${p.id}`,
        kind: "post.published",
        timestamp: publishedAtIso,
        platform,
        title,
        detail: `投稿 ${p.id.slice(0, 8)} · 公開済み`,
      });
    } else if (p.status === "failed") {
      items.push({
        id: `post-fail-${p.id}`,
        kind: "post.failed",
        timestamp: createdAtIso ?? new Date().toISOString(),
        platform,
        title,
        detail: `投稿 ${p.id.slice(0, 8)} · 失敗`,
      });
    } else if (p.status === "draft" && createdAtIso) {
      items.push({
        id: `post-draft-${p.id}`,
        kind: "post.draft",
        timestamp: createdAtIso,
        platform,
        title,
        detail: `下書き ${p.id.slice(0, 8)}`,
      });
    }
  }

  // Build a map of postId → platform so schedule entries can know their SNS.
  const postPlatform = new Map<string, ActivityItem["platform"]>();
  for (const p of posts) {
    postPlatform.set(p.id, (p.platform as ActivityItem["platform"]) ?? "x");
  }

  for (const job of schedules) {
    const scheduledAtIso = toIso(job.scheduledAt as unknown as Isoish);
    const completedAtIso = toIso(job.completedAt as unknown as Isoish);
    const platform: ActivityItem["platform"] = postPlatform.get(job.postId) ?? "x";

    let kind: ActivityKind | null = null;
    let timestamp: string | null = null;
    let title = "";
    let detail: string | null = null;

    if (job.status === "succeeded" && completedAtIso) {
      kind = "schedule.succeeded";
      timestamp = completedAtIso;
      title = "予約実行が完了しました";
      detail = `予約 ${job.id.slice(0, 8)} · ${job.attemptCount} 回実行`;
    } else if (job.status === "failed") {
      kind = "schedule.failed";
      timestamp = completedAtIso ?? scheduledAtIso ?? new Date().toISOString();
      title = "予約実行に失敗しました";
      detail = job.lastError
        ? `予約 ${job.id.slice(0, 8)} · ${job.lastError.slice(0, 60)}`
        : `予約 ${job.id.slice(0, 8)}`;
    } else if (job.status === "pending" && scheduledAtIso) {
      kind = "schedule.created";
      timestamp = scheduledAtIso;
      title = "投稿を予約しました";
      detail = `予約 ${job.id.slice(0, 8)}`;
    }

    if (kind && timestamp) {
      items.push({
        id: `job-${job.status}-${job.id}`,
        kind,
        timestamp,
        platform,
        title,
        detail,
      });
    }
  }

  // Sort descending (most recent first), prefer past events over future.
  items.sort((a, b) => {
    const ta = new Date(a.timestamp).getTime();
    const tb = new Date(b.timestamp).getTime();
    return tb - ta;
  });

  return items;
}

function countByStatus<T extends { status: string }>(rows: T[], status: string): number {
  return rows.filter((r) => r.status === status).length;
}

// ───────────────────────────────────────────
// Page component
// ───────────────────────────────────────────

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [accountsRes, postsRes, schedulesRes, usageRes] = await Promise.all([
    fetchAccountsSafe(),
    fetchRecentPostsSafe(50),
    fetchSchedulesSafe(),
    fetchUsageSummarySafe(),
  ]);

  const accounts = accountsRes.data;
  const posts = postsRes.data;
  const schedules = schedulesRes.data;
  const usage = usageRes.data;

  const degraded =
    accountsRes.isFallback || postsRes.isFallback || schedulesRes.isFallback || usageRes.isFallback;

  // Summary totals
  const totalPosts = posts.length;
  const scheduledPending =
    countByStatus(schedules, "pending") + countByStatus(schedules, "retrying");
  const estimatedCostUsd = usage.estimatedCostUsd ?? 0;
  const connectedAccounts = accounts.filter((a) => a.status === "active").length;

  const platformStats = aggregatePlatformStats(accounts, posts);
  const activity = buildActivity(posts, schedules);

  const now = new Date();
  const dateline = formatDateline(now);
  const week = isoWeek(now);

  // Error lines visible in dev for debugging the degraded state.
  const errorLines = [
    accountsRes.errorMessage && `アカウント: ${accountsRes.errorMessage}`,
    postsRes.errorMessage && `投稿: ${postsRes.errorMessage}`,
    schedulesRes.errorMessage && `予約: ${schedulesRes.errorMessage}`,
    usageRes.errorMessage && `使用量: ${usageRes.errorMessage}`,
  ].filter(Boolean) as string[];

  return (
    <div className="mx-auto max-w-[1440px] space-y-8">
      {/* ═════════════════════════════════════
          MASTHEAD — the broadsheet banner
          ═════════════════════════════════════ */}
      <header className="relative">
        <div className="flex flex-wrap items-end justify-between gap-3 pb-3">
          <div className="font-mono text-[10px] uppercase leading-none tracking-[0.22em] text-base-content/55">
            {dateline.weekday} · {dateline.date}
          </div>
          <div className="font-mono text-[10px] uppercase leading-none tracking-[0.22em] text-base-content/55">
            vol · i &nbsp;·&nbsp; edition № {String(week).padStart(2, "0")}
          </div>
        </div>

        {/* Double-rule top of masthead */}
        <div aria-hidden className="border-t-2 border-base-content/75" />
        <div aria-hidden className="mt-[3px] border-t border-base-content/40" />

        <div className="flex flex-wrap items-end justify-between gap-6 pt-4">
          <div className="min-w-0">
            <h1
              className="font-display text-[44px] font-semibold leading-[1.02] tracking-[-0.02em] text-base-content sm:text-[56px]"
              style={{ fontFamily: "'Fraunces', serif", fontOpticalSizing: "auto" }}
            >
              {SECTION_KICKERS.dashboard}
            </h1>
            <p
              className="mt-1 font-display text-sm italic leading-tight text-base-content/60"
              style={{ fontFamily: "'Fraunces', serif", fontStyle: "italic" }}
            >
              投稿、予約、使用量、運用状況を毎日確認できるダッシュボードです。
            </p>
          </div>

          <div className="flex items-center gap-6 pb-1 font-mono text-[10px] uppercase tracking-[0.2em] text-base-content/55">
            <div className="text-right">
              <div className="text-base-content/40">established</div>
              <div className="text-base-content/80">mmxxvi</div>
            </div>
            <div className="h-8 w-px bg-base-content/20" aria-hidden />
            <div className="text-right">
              <div className="text-base-content/40">printed</div>
              <div className="tabular-nums text-base-content/80">
                {String(now.getHours()).padStart(2, "0")}:
                {String(now.getMinutes()).padStart(2, "0")} JST
              </div>
            </div>
          </div>
        </div>

        {/* Bottom rule of masthead */}
        <div aria-hidden className="mt-4 border-t border-base-content/40" />
        <div aria-hidden className="mt-[3px] border-t-2 border-base-content/75" />

        {/* dev-only degraded banner */}
        {degraded && (
          <div className="mt-4 flex items-start gap-3 rounded-sm border border-dashed border-warning/60 bg-warning/10 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.15em] text-[#7a4b00]">
            <RssSimple size={12} weight="bold" className="mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="font-semibold">回線オフライン · ローカルの代替データを表示しています</div>
              {errorLines.length > 0 && (
                <ul className="mt-1 space-y-0.5 normal-case tracking-normal text-[#7a4b00]/80">
                  {errorLines.map((line) => (
                    <li key={line} className="truncate">
                      · {line}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </header>

      {/* ═════════════════════════════════════
          SECTION I — headline numbers
          ═════════════════════════════════════ */}
      <section aria-label="Headline metrics" className="space-y-3">
        <div className="flex items-baseline justify-between gap-4">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-base-content/45">
              section i · headlines
            </div>
            <h2
              className="mt-0.5 font-display text-xl font-semibold leading-tight text-base-content"
              style={{ fontFamily: "'Fraunces', serif" }}
            >
              Today’s Figures
            </h2>
          </div>
          <div className="hidden items-center gap-2 font-mono text-[9px] uppercase tracking-[0.18em] text-base-content/40 sm:flex">
            <CalendarBlank size={11} weight="bold" />
            <span>month to date</span>
          </div>
        </div>

        <SummaryCards
          totalPosts={totalPosts}
          scheduledPending={scheduledPending}
          estimatedCostUsd={estimatedCostUsd}
          connectedAccounts={connectedAccounts}
          degraded={degraded}
        />
      </section>

      {/* ═════════════════════════════════════
          SECTION II — platform bureaus
          ═════════════════════════════════════ */}
      <PlatformOverview stats={platformStats} />

      {/* ═════════════════════════════════════
          SECTION III — dispatches / activity
          ═════════════════════════════════════ */}
      <RecentActivity items={activity} totalCount={activity.length} />

      {/* Colophon */}
      <footer className="border-t border-dashed border-base-content/20 pt-3 font-mono text-[9px] uppercase tracking-[0.22em] text-base-content/35">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>sns agent · {SECTION_KICKERS.dashboard.toLowerCase()}</span>
          <span>set in fraunces &amp; dm sans · {dateline.weekday.toLowerCase()} edition</span>
          <span>— printed server-side —</span>
        </div>
      </footer>
    </div>
  );
}
