/**
 * API リクエスト/レスポンス型定義
 *
 * design.md セクション 4.3 の共通レスポンス形式 { data, meta } / { error } に準拠。
 * core のドメインエンティティ型を再利用可能な箇所は re-export する。
 */

import type { Platform } from "@sns-agent/config";
import type { PostProviderMetadata } from "@sns-agent/core";

// ───────────────────────────────────────────
// core エンティティの re-export
// ───────────────────────────────────────────
export type {
  SocialAccount,
  Post,
  PostProviderMetadata,
  ScheduledJob,
  UsageRecord,
  MediaAttachment,
} from "@sns-agent/core";

export type { Platform } from "@sns-agent/config";

// ───────────────────────────────────────────
// 共通レスポンス形式
// ───────────────────────────────────────────

/** ページネーションメタ情報 */
export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
}

/** 成功レスポンス */
export interface ApiResponse<T> {
  data: T;
  meta?: PaginationMeta;
}

/** エラーレスポンス */
export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

// ───────────────────────────────────────────
// Accounts
// ───────────────────────────────────────────

export interface ConnectAccountInput {
  platform: Platform;
  redirectUrl: string;
  authorizationCode?: string;
  state?: string;
}

// ───────────────────────────────────────────
// Posts
// ───────────────────────────────────────────

export interface ListPostsParams {
  platform?: Platform;
  status?: string;
  page?: number;
  limit?: number;
}

export interface CreatePostInput {
  socialAccountId: string;
  platform: Platform;
  contentText?: string;
  contentMedia?: { type: "image" | "video"; url: string; mimeType: string }[];
  providerMetadata?: PostProviderMetadata | null;
  /** true で即時投稿、false/省略で下書き */
  publish?: boolean;
}

export interface UpdatePostInput {
  contentText?: string;
  contentMedia?: { type: "image" | "video"; url: string; mimeType: string }[];
  providerMetadata?: PostProviderMetadata | null;
}

// ───────────────────────────────────────────
// Schedules
// ───────────────────────────────────────────

export interface ListSchedulesParams {
  page?: number;
  limit?: number;
  status?: string;
}

export interface CreateScheduleInput {
  postId: string;
  scheduledAt: string; // ISO 8601
}

export interface UpdateScheduleInput {
  scheduledAt?: string; // ISO 8601
}

export interface RunDueSchedulesInput {
  limit?: number;
}

export interface RunDueSchedulesJobResult {
  id: string;
  postId: string;
  beforeStatus: string;
  afterStatus: string;
  willRetry: boolean;
  recoveredStaleLock: boolean;
  error?: string;
}

export interface RunDueSchedulesResult {
  processedAt: string;
  scanned: number;
  processed: number;
  skipped: number;
  succeeded: number;
  retrying: number;
  failed: number;
  jobs: RunDueSchedulesJobResult[];
}

// ───────────────────────────────────────────
// Usage
// ───────────────────────────────────────────

export type UsagePeriod = "daily" | "weekly" | "monthly";

export interface UsageReportParams {
  platform?: string;
  period?: UsagePeriod;
  from?: string; // ISO 8601 date
  to?: string; // ISO 8601 date
}

/** /api/usage report row (server-aggregated bucket per period × platform). */
export interface UsageReportEntry {
  /** Bucket key — `YYYY-MM-DD` (daily), `YYYY-Www` (weekly), or `YYYY-MM` (monthly). */
  period: string;
  platform: string;
  requestCount: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  estimatedCost: number;
}

export interface UsageReportMeta {
  period: UsagePeriod;
  from: string;
  to: string;
}

/**
 * Legacy / dashboard summary type kept for backwards compatibility with the
 * Task 3005 dashboard fetcher. New code should prefer `UsageSummaryReport`.
 */
export interface UsageSummary {
  totalRequests: number;
  totalSuccesses: number;
  totalFailures: number;
  estimatedCostUsd: number;
}

/** /api/usage/summary response — month-to-date aggregate split by platform. */
export interface UsageSummaryReport {
  totalCost: number;
  totalRequests: number;
  successRate: number;
  byPlatform: Record<
    string,
    {
      totalRequests: number;
      successCount: number;
      failureCount: number;
      totalCostUsd: number;
    }
  >;
  range: { from: string; to: string };
}

// ───────────────────────────────────────────
// Budget
// ───────────────────────────────────────────

export type BudgetScopeType = "workspace" | "platform" | "endpoint";
export type BudgetPeriodType = "daily" | "weekly" | "monthly";
export type BudgetActionOnExceed = "warn" | "require-approval" | "block";

export interface BudgetPolicyDto {
  id: string;
  workspaceId: string;
  scopeType: BudgetScopeType;
  scopeValue: string | null;
  period: BudgetPeriodType;
  limitAmountUsd: number;
  actionOnExceed: BudgetActionOnExceed;
  createdAt: string;
  updatedAt: string;
}

export interface BudgetStatusDto {
  policy: BudgetPolicyDto;
  consumed: number;
  limit: number;
  percentage: number;
  warning: boolean;
  exceeded: boolean;
  periodStart: string;
  periodEnd: string;
}

export interface CreateBudgetPolicyDto {
  scopeType: BudgetScopeType;
  scopeValue?: string | null;
  period: BudgetPeriodType;
  limitAmountUsd: number;
  actionOnExceed: BudgetActionOnExceed;
}

export interface UpdateBudgetPolicyDto {
  scopeType?: BudgetScopeType;
  scopeValue?: string | null;
  period?: BudgetPeriodType;
  limitAmountUsd?: number;
  actionOnExceed?: BudgetActionOnExceed;
}

// ───────────────────────────────────────────
// Agent Gateway
// ───────────────────────────────────────────

export type AgentExecutionMode =
  | "read-only"
  | "draft"
  | "approval-required"
  | "direct-execute";

export interface AgentSkillIntent {
  actionName: string;
  packageName: string;
  args: Record<string, unknown>;
}

export interface AgentSkillPreview {
  actionName: string;
  packageName: string;
  description?: string | null;
  preview?: Record<string, unknown> | string | null;
  requiredPermissions: string[];
  missingPermissions: string[];
  argumentErrors: string[];
  mode: AgentExecutionMode;
  allowed: boolean;
  blockedReason?: string | null;
}

export interface AgentChatTextResponse {
  kind: "text";
  conversationId: string | null;
  content: string;
}

export interface AgentChatPreviewResponse {
  kind: "preview";
  conversationId: string | null;
  content: string;
  intent: AgentSkillIntent;
  preview: AgentSkillPreview;
}

export type AgentChatResponse = AgentChatTextResponse | AgentChatPreviewResponse;

export interface AgentChatInput {
  message: string;
  conversationId?: string | null;
  mode?: AgentExecutionMode;
}

export interface AgentExecuteInput {
  actionName: string;
  packageName: string;
  args?: Record<string, unknown>;
  conversationId?: string | null;
  mode?: AgentExecutionMode;
}

export interface AgentExecuteResponse {
  outcome: {
    actionName: string;
    packageName: string;
    result: Record<string, unknown>;
    mode: AgentExecutionMode;
  };
  auditLogId?: string | null;
  conversationId?: string | null;
}

export interface AgentHistoryEntry {
  id: string;
  action: string;
  conversationId: string | null;
  inputSummary: string | null;
  resultSummary: string | null;
  createdAt: string;
}

export interface AgentHistoryParams {
  conversationId?: string;
  page?: number;
  limit?: number;
}
