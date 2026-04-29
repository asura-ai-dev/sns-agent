/**
 * Shared usage / budget view-model types — Task 4005
 *
 * RSC pages serialize their fetched data through these plain shapes before
 * handing them to client-only components (which depend on `recharts`). This
 * keeps `Date` instances out of the boundary and lets the client tree do its
 * own period bucketing without re-fetching.
 */

import type {
  BudgetPolicyDto,
  BudgetStatusDto,
  UsagePeriod,
  UsageReportEntry,
} from "@sns-agent/sdk";

/** All platforms the usage page knows how to filter / colour. */
export const USAGE_PLATFORMS = ["x", "line", "instagram", "openai", "anthropic"] as const;
export type UsagePlatformKey = (typeof USAGE_PLATFORMS)[number];

/** UI filter for the platform pill row — `all` is the default. */
export type PlatformFilter = "all" | "x" | "line" | "instagram" | "llm";

/** Coalesce raw API platform string into a UI filter group. */
export function classifyPlatform(p: string): PlatformFilter {
  if (p === "x" || p === "line" || p === "instagram") return p;
  // openai / anthropic / google → grouped under "llm"
  return "llm";
}

/** Editorial colour swatches for charts and tags. Newsprint-safe. */
export const PLATFORM_INK: Record<PlatformFilter, string> = {
  all: "#1F2937",
  x: "#111111",
  line: "#06C755",
  instagram: "#FF7A59",
  llm: "#2F80ED",
};

export const PLATFORM_LABEL: Record<PlatformFilter, string> = {
  all: "全体",
  x: "X",
  line: "LINE",
  instagram: "Instagram",
  llm: "LLM",
};

export interface UsageViewModel {
  period: UsagePeriod;
  platformFilter: PlatformFilter;
  entries: UsageReportEntry[];
  endpointEntries: UsageReportEntry[];
  gateEntries: UsageReportEntry[];
  /** Total over the report range, all entries. */
  totals: {
    requestCount: number;
    successCount: number;
    failureCount: number;
    estimatedCost: number;
    successRate: number;
  };
  /** Same totals but for the previous comparable range (for delta cards). */
  previousTotals: {
    requestCount: number;
    estimatedCost: number;
  };
  /** range from/to ISO strings (server-resolved). */
  range: { from: string; to: string };
  isFallback: boolean;
  errorMessage?: string;
  endpointErrorMessage?: string;
  gateErrorMessage?: string;
}

export interface BudgetViewModel {
  statuses: BudgetStatusDto[];
  policies: BudgetPolicyDto[];
  isFallback: boolean;
  errorMessage?: string;
}
