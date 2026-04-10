/**
 * Server-side API client — Task 3005
 *
 * Wraps `@sns-agent/sdk`'s `SnsAgentClient` for use from Next.js server components /
 * server actions / RSC only. Never import this from client components.
 *
 * Configuration is read from environment variables at call time:
 *   SNS_AGENT_API_URL  — base URL of the Hono API (default: http://localhost:3001)
 *   SNS_AGENT_API_KEY  — Bearer API key sent with every request
 *
 * The dashboard uses these helpers via `fetch*Safe` wrappers that fall back to
 * an empty-state payload when the API is unreachable, keeping the dashboard
 * renderable during local development before the API process is running.
 *
 * NOTE: this module holds a singleton client and must only be imported from
 * server components / server actions (never from `"use client"` files).
 */

import { SnsAgentClient, SdkError } from "@sns-agent/sdk";
import type { ApiResponse, SocialAccount, Post, ScheduledJob, UsageSummary } from "@sns-agent/sdk";

// ───────────────────────────────────────────
// Configuration
// ───────────────────────────────────────────

/** Resolve API base URL, trimming trailing slashes. */
function resolveBaseUrl(): string {
  const raw =
    process.env.SNS_AGENT_API_URL ??
    process.env.NEXT_PUBLIC_SNS_AGENT_API_URL ??
    "http://localhost:3001";
  return raw.replace(/\/+$/, "");
}

function resolveApiKey(): string {
  // During local development an empty key is acceptable — the API middleware
  // may be configured to bypass auth in dev mode.
  return process.env.SNS_AGENT_API_KEY ?? "";
}

// ───────────────────────────────────────────
// Client factory
// ───────────────────────────────────────────

let cachedClient: SnsAgentClient | null = null;

/**
 * Return a singleton `SnsAgentClient` bound to the server-side configuration.
 * Re-creates the instance if the environment changes between calls in dev.
 */
export function getApiClient(): SnsAgentClient {
  if (cachedClient) return cachedClient;
  cachedClient = new SnsAgentClient({
    baseUrl: resolveBaseUrl(),
    apiKey: resolveApiKey(),
  });
  return cachedClient;
}

// ───────────────────────────────────────────
// Error / fallback helpers
// ───────────────────────────────────────────

/** Discriminant wrapping a fetch attempt so RSCs can render degraded states. */
export interface FetchResult<T> {
  ok: boolean;
  data: T;
  /** Set to true when `data` is the offline fallback. */
  isFallback: boolean;
  /** Error message when `ok` is false. */
  errorMessage?: string;
}

function makeFallback<T>(fallback: T, errorMessage: string): FetchResult<T> {
  return { ok: false, data: fallback, isFallback: true, errorMessage };
}

async function guard<T>(fn: () => Promise<T>, fallback: T): Promise<FetchResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data, isFallback: false };
  } catch (err) {
    const message =
      err instanceof SdkError
        ? `[${err.statusCode}] ${err.code}: ${err.message}`
        : err instanceof Error
          ? err.message
          : "Unknown fetch error";
    return makeFallback(fallback, message);
  }
}

// ───────────────────────────────────────────
// Dashboard fetchers
// ───────────────────────────────────────────

/** Fetch all connected social accounts; returns empty array on failure. */
export function fetchAccountsSafe(): Promise<FetchResult<SocialAccount[]>> {
  return guard(async () => {
    const res: ApiResponse<SocialAccount[]> = await getApiClient().accounts.list();
    return res.data ?? [];
  }, []);
}

/** Fetch the most recent posts across all platforms. */
export function fetchRecentPostsSafe(limit = 20): Promise<FetchResult<Post[]>> {
  return guard(async () => {
    const res: ApiResponse<Post[]> = await getApiClient().posts.list({ limit });
    return res.data ?? [];
  }, []);
}

/** Fetch the pending scheduled jobs (status filter not enforced server-side for all impls). */
export function fetchSchedulesSafe(): Promise<FetchResult<ScheduledJob[]>> {
  return guard(async () => {
    const res: ApiResponse<ScheduledJob[]> = await getApiClient().schedules.list({ limit: 50 });
    return res.data ?? [];
  }, []);
}

/** Fetch the month-to-date usage summary. */
export function fetchUsageSummarySafe(): Promise<FetchResult<UsageSummary>> {
  const fallback: UsageSummary = {
    totalRequests: 0,
    totalSuccesses: 0,
    totalFailures: 0,
    estimatedCostUsd: 0,
  };
  return guard(async () => {
    const res: ApiResponse<UsageSummary> = await getApiClient().usage.summary();
    return res.data ?? fallback;
  }, fallback);
}

// ───────────────────────────────────────────
// Re-exports for convenience
// ───────────────────────────────────────────

export type { SocialAccount, Post, ScheduledJob, UsageSummary };
