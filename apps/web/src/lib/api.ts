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
import type {
  ApiResponse,
  BudgetPolicyDto,
  BudgetStatusDto,
  CreateBudgetPolicyDto,
  Post,
  ScheduledJob,
  SocialAccount,
  UpdateBudgetPolicyDto,
  UsagePeriod,
  UsageReportEntry,
  UsageReportMeta,
  UsageSummary,
  UsageSummaryReport,
} from "@sns-agent/sdk";

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
  return process.env.SNS_AGENT_API_KEY ?? "sns-agent-dev-key-00000000";
}

function resolveSessionUserId(): string {
  return process.env.SNS_AGENT_SESSION_USER_ID ?? "user-owner-00000000";
}

/**
 * Dashboard / settings pages are operator-facing surfaces, so they should
 * authenticate as the current session user first. The API middleware resolves
 * `Authorization` before `X-Session-User-Id`; sending both would downgrade the
 * request to the agent identity in local dev and trip RBAC on admin-only pages.
 */
function resolveOperatorHeaders(): Record<string, string> {
  const h: Record<string, string> = {};
  const sessionUserId = resolveSessionUserId();
  if (sessionUserId) {
    h["X-Session-User-Id"] = sessionUserId;
    return h;
  }
  const apiKey = resolveApiKey();
  if (apiKey) {
    h["Authorization"] = `Bearer ${apiKey}`;
  }
  return h;
}

function resolvePreferredApiKey(): string {
  return resolveSessionUserId() ? "" : resolveApiKey();
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
    apiKey: resolvePreferredApiKey(),
    sessionUserId: resolveSessionUserId(),
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
// Usage detail / Budget fetchers (Task 4005)
// ───────────────────────────────────────────

export interface UsageReportSafeResult {
  entries: UsageReportEntry[];
  meta: UsageReportMeta | null;
}

/** Period-aggregated usage report for the dedicated `/usage` page. */
export function fetchUsageReportSafe(params: {
  period?: UsagePeriod;
  platform?: string;
  from?: string;
  to?: string;
}): Promise<FetchResult<UsageReportSafeResult>> {
  const fallback: UsageReportSafeResult = { entries: [], meta: null };
  return guard(async () => {
    const res = await getApiClient().usage.reportAggregated(params);
    return {
      entries: res.data ?? [],
      meta: (res.meta as UsageReportMeta | undefined) ?? null,
    };
  }, fallback);
}

/** Month-to-date usage summary in the by-platform breakdown shape. */
export function fetchUsageSummaryReportSafe(): Promise<FetchResult<UsageSummaryReport>> {
  const fallback: UsageSummaryReport = {
    totalCost: 0,
    totalRequests: 0,
    successRate: 0,
    byPlatform: {},
    range: { from: new Date().toISOString(), to: new Date().toISOString() },
  };
  return guard(async () => {
    const res: ApiResponse<UsageSummaryReport> = await getApiClient().usage.summaryReport();
    return res.data ?? fallback;
  }, fallback);
}

/** List configured budget policies. */
export function fetchBudgetPoliciesSafe(): Promise<FetchResult<BudgetPolicyDto[]>> {
  return guard(async () => {
    const res: ApiResponse<BudgetPolicyDto[]> = await getApiClient().budget.listPolicies();
    return res.data ?? [];
  }, [] as BudgetPolicyDto[]);
}

/** Current consumption status for each active policy. */
export function fetchBudgetStatusSafe(): Promise<FetchResult<BudgetStatusDto[]>> {
  return guard(async () => {
    const res: ApiResponse<BudgetStatusDto[]> = await getApiClient().budget.status();
    return res.data ?? [];
  }, [] as BudgetStatusDto[]);
}

// ───────────────────────────────────────────
// LLM routes (Task 5005)
// ───────────────────────────────────────────

/**
 * Wire-format shape of a row in `GET /api/llm/routes` — mirrors the Hono
 * serializer in `apps/api/src/routes/llm.ts`. Kept local because the SDK
 * client does not yet expose an `llm` resource (see Task 5005 handoff).
 */
export interface LlmRouteDto {
  id: string;
  workspaceId: string;
  platform: string | null;
  action: string | null;
  provider: string;
  model: string;
  temperature: number | null;
  maxTokens: number | null;
  fallbackProvider: string | null;
  fallbackModel: string | null;
  priority: number;
  createdAt: string;
  updatedAt: string;
}

export type LlmProviderConnectionStatus = "missing" | "connected" | "expired" | "reauth_required";

export interface LlmProviderStatusDto {
  provider: "openai-codex";
  status: LlmProviderConnectionStatus;
  connected: boolean;
  requiresReauth: boolean;
  reason: string;
  expiresAt: string | null;
  scopes: string[] | null;
  subject: string | null;
  metadata: Record<string, unknown> | null;
  updatedAt: string | null;
}

/**
 * Raw fetch against the Hono API for `GET /api/llm/routes`.
 *
 * Uses the server-side `SNS_AGENT_API_URL` / `SNS_AGENT_API_KEY` so it can be
 * called from a React Server Component. Returns an empty array on any failure
 * (API offline, 4xx, 5xx, malformed body) so the dashboard can render a
 * degraded "wire offline" state instead of crashing.
 */
export function fetchLlmRoutesSafe(): Promise<FetchResult<LlmRouteDto[]>> {
  return guard<LlmRouteDto[]>(async () => {
    const baseUrl = resolveBaseUrl();
    const res = await fetch(`${baseUrl}/api/llm/routes`, {
      method: "GET",
      headers: {
        ...resolveOperatorHeaders(),
      },
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`llm routes fetch failed: HTTP ${res.status}`);
    }
    const body = (await res.json()) as { data?: LlmRouteDto[] };
    return body.data ?? [];
  }, []);
}

export function fetchOpenAiCodexStatusSafe(): Promise<FetchResult<LlmProviderStatusDto>> {
  const fallback: LlmProviderStatusDto = {
    provider: "openai-codex",
    status: "missing",
    connected: false,
    requiresReauth: false,
    reason: "api_unreachable",
    expiresAt: null,
    scopes: null,
    subject: null,
    metadata: null,
    updatedAt: null,
  };

  return guard<LlmProviderStatusDto>(async () => {
    const baseUrl = resolveBaseUrl();
    const res = await fetch(`${baseUrl}/api/llm/providers/openai-codex/status`, {
      method: "GET",
      headers: {
        ...resolveOperatorHeaders(),
      },
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`openai-codex status fetch failed: HTTP ${res.status}`);
    }
    const body = (await res.json()) as { data?: LlmProviderStatusDto };
    return body.data ?? fallback;
  }, fallback);
}

// ───────────────────────────────────────────
// Skills (Task 5005)
// ───────────────────────────────────────────

export interface SkillPackageDto {
  id: string;
  workspaceId: string;
  name: string;
  version: string;
  platform: string;
  llmProvider: string;
  enabled: boolean;
  actionCount: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Raw fetch against `GET /api/skills`. See `fetchLlmRoutesSafe` for rationale
 * on why this bypasses the SDK client.
 */
export function fetchSkillPackagesSafe(): Promise<FetchResult<SkillPackageDto[]>> {
  return guard<SkillPackageDto[]>(async () => {
    const baseUrl = resolveBaseUrl();
    const res = await fetch(`${baseUrl}/api/skills`, {
      method: "GET",
      headers: {
        ...resolveOperatorHeaders(),
      },
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`skills fetch failed: HTTP ${res.status}`);
    }
    const body = (await res.json()) as { data?: SkillPackageDto[] };
    return body.data ?? [];
  }, []);
}

// ───────────────────────────────────────────
// Mutation helpers (used from server actions)
// ───────────────────────────────────────────

export async function createBudgetPolicy(input: CreateBudgetPolicyDto): Promise<BudgetPolicyDto> {
  const res = await getApiClient().budget.createPolicy(input);
  return res.data;
}

export async function updateBudgetPolicy(
  id: string,
  input: UpdateBudgetPolicyDto,
): Promise<BudgetPolicyDto> {
  const res = await getApiClient().budget.updatePolicy(id, input);
  return res.data;
}

export async function deleteBudgetPolicy(id: string): Promise<{ id: string; deleted: boolean }> {
  const res = await getApiClient().budget.deletePolicy(id);
  return res.data;
}

// ───────────────────────────────────────────
// Re-exports for convenience
// ───────────────────────────────────────────

export type {
  SocialAccount,
  Post,
  ScheduledJob,
  UsageSummary,
  UsageSummaryReport,
  UsageReportEntry,
  UsageReportMeta,
  UsagePeriod,
  BudgetPolicyDto,
  BudgetStatusDto,
  CreateBudgetPolicyDto,
  UpdateBudgetPolicyDto,
};
