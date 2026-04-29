/**
 * API リクエスト/レスポンス型定義
 *
 * design.md セクション 4.3 の共通レスポンス形式 { data, meta } / { error } に準拠。
 * core のドメインエンティティ型を再利用可能な箇所は re-export する。
 */

import type { Platform } from "@sns-agent/config";
import type { Post, PostProviderMetadata, ScheduledJob } from "@sns-agent/core";

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
  /** API wire name for immediate publishing. `publish` is kept as the SDK shorthand. */
  publishNow?: boolean;
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
  endpoint?: string;
  gateId?: string;
  dimension?: "platform" | "endpoint" | "gate";
  period?: UsagePeriod;
  from?: string; // ISO 8601 date
  to?: string; // ISO 8601 date
}

/** /api/usage report row (server-aggregated bucket per period × platform). */
export interface UsageReportEntry {
  /** Bucket key — `YYYY-MM-DD` (daily), `YYYY-Www` (weekly), or `YYYY-MM` (monthly). */
  period: string;
  platform: string;
  endpoint?: string | null;
  gateId?: string | null;
  feature?: string | null;
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
// X parity shared DTOs
// ───────────────────────────────────────────

export interface OffsetPaginationMeta {
  limit: number;
  offset: number;
  total: number;
}

export interface OffsetApiResponse<T> {
  data: T;
  meta: OffsetPaginationMeta;
}

export interface XDateStampedDto {
  createdAt: string;
  updatedAt: string;
}

// ───────────────────────────────────────────
// Followers
// ───────────────────────────────────────────

export interface FollowerDto extends XDateStampedDto {
  id: string;
  workspaceId: string;
  socialAccountId: string;
  platform: Platform;
  externalUserId: string;
  displayName: string | null;
  username: string | null;
  isFollowing: boolean;
  isFollowed: boolean;
  unfollowedAt: string | null;
  metadata: Record<string, unknown> | null;
  lastSeenAt: string;
}

export interface ListFollowersParams {
  socialAccountId?: string;
  tagId?: string;
  isFollowed?: boolean;
  isFollowing?: boolean;
  limit?: number;
  offset?: number;
}

export interface SyncFollowersInput {
  socialAccountId: string;
  limit?: number;
  followersCursor?: string | null;
  followingCursor?: string | null;
}

export interface SyncFollowersResultDto {
  followerCount: number;
  followingCount: number;
  nextFollowersCursor: string | null;
  nextFollowingCursor: string | null;
  markedUnfollowedCount: number;
  markedUnfollowingCount: number;
}

export interface FollowerTagInput {
  socialAccountId: string;
}

// ───────────────────────────────────────────
// Tags
// ───────────────────────────────────────────

export interface TagDto extends XDateStampedDto {
  id: string;
  workspaceId: string;
  socialAccountId: string;
  name: string;
  color: string | null;
}

export interface ListTagsParams {
  socialAccountId?: string;
}

export interface CreateTagDto {
  socialAccountId: string;
  name: string;
  color?: string | null;
}

export interface UpdateTagDto {
  name?: string;
  color?: string | null;
}

// ───────────────────────────────────────────
// Follower analytics
// ───────────────────────────────────────────

export interface FollowerAnalyticsParams {
  socialAccountId: string;
  asOfDate?: string;
}

export interface FollowerAnalyticsPointDto {
  date: string;
  followerCount: number;
  followingCount: number;
}

export interface FollowerAnalyticsResultDto {
  currentCount: number;
  delta7Days: number | null;
  delta30Days: number | null;
  series: FollowerAnalyticsPointDto[];
}

export interface CaptureFollowerSnapshotDto {
  socialAccountId?: string;
  capturedAt?: string;
}

export interface FollowerSnapshotDto extends XDateStampedDto {
  id: string;
  workspaceId: string;
  socialAccountId: string;
  platform: Platform;
  snapshotDate: string;
  followerCount: number;
  followingCount: number;
  capturedAt: string;
}

export interface CaptureFollowerSnapshotResultDto {
  snapshot: FollowerSnapshotDto;
  created: boolean;
}

export interface CaptureFollowerSnapshotsForWorkspaceResultDto {
  captured: number;
  created: number;
  snapshots: FollowerSnapshotDto[];
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
// Engagement Gates
// ───────────────────────────────────────────

export interface EngagementGateConditionsDto {
  requireLike?: boolean;
  requireRepost?: boolean;
  requireFollow?: boolean;
}

export type EngagementGateStatusDto = "active" | "paused";
export type EngagementGateActionTypeDto = "mention_post" | "dm" | "verify_only";

export interface EngagementGateStealthConfigDto {
  gateHourlyLimit?: number | null;
  gateDailyLimit?: number | null;
  accountHourlyLimit?: number | null;
  accountDailyLimit?: number | null;
  jitterMinSeconds?: number | null;
  jitterMaxSeconds?: number | null;
  backoffSeconds?: number | null;
  templateVariants?: string[] | null;
}

export interface EngagementGateDto {
  id: string;
  workspaceId: string;
  socialAccountId: string;
  platform: Platform;
  name: string;
  status: EngagementGateStatusDto;
  triggerType: "reply";
  triggerPostId: string | null;
  conditions: EngagementGateConditionsDto | null;
  actionType: EngagementGateActionTypeDto;
  actionText: string | null;
  lineHarnessUrl: string | null;
  lineHarnessApiKeyRef: string | null;
  lineHarnessTag: string | null;
  lineHarnessScenario: string | null;
  stealthConfig: EngagementGateStealthConfigDto | null;
  deliveryBackoffUntil: string | null;
  lastReplySinceId: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListEngagementGatesParams {
  socialAccountId?: string;
  status?: EngagementGateStatusDto;
  limit?: number;
}

export interface CreateEngagementGateDto {
  socialAccountId: string;
  name: string;
  triggerPostId?: string | null;
  conditions?: EngagementGateConditionsDto | null;
  actionType: EngagementGateActionTypeDto;
  actionText?: string | null;
  lineHarnessUrl?: string | null;
  lineHarnessApiKeyRef?: string | null;
  lineHarnessTag?: string | null;
  lineHarnessScenario?: string | null;
  stealthConfig?: EngagementGateStealthConfigDto | null;
}

export interface UpdateEngagementGateDto {
  name?: string;
  status?: EngagementGateStatusDto;
  triggerPostId?: string | null;
  conditions?: EngagementGateConditionsDto | null;
  actionType?: EngagementGateActionTypeDto;
  actionText?: string | null;
  lineHarnessUrl?: string | null;
  lineHarnessApiKeyRef?: string | null;
  lineHarnessTag?: string | null;
  lineHarnessScenario?: string | null;
  stealthConfig?: EngagementGateStealthConfigDto | null;
}

export interface VerifyEngagementGateParams {
  username: string;
}

export interface VerifyEngagementGateResultDto {
  gateId: string;
  username: string;
  eligible: boolean;
  conditions: {
    liked: boolean;
    reposted: boolean;
    followed: boolean;
  };
  delivery: {
    id: string;
    token: string;
    consumedAt: string | null;
  } | null;
  lineHarness: {
    url: string | null;
    apiKeyRef: string | null;
    tag: string | null;
    scenario: string | null;
  };
}

export interface ConsumeEngagementGateDeliveryTokenDto {
  deliveryToken: string;
}

export interface ConsumeEngagementGateDeliveryTokenResultDto {
  consumed: boolean;
  delivery: {
    id: string;
    deliveryToken: string;
    consumedAt: string | null;
  };
}

export interface ProcessEngagementGateRepliesDto {
  limit?: number;
}

export interface ProcessEngagementGateRepliesResultDto {
  gatesScanned: number;
  repliesScanned: number;
  deliveriesCreated: number;
  skippedDuplicate: number;
  skippedIneligible: number;
  actionsSent: number;
  skippedRateLimited: number;
  skippedJitter: number;
  skippedBackoff: number;
  actionsBackedOff: number;
  lastReplySinceIdsUpdated: number;
}

// ───────────────────────────────────────────
// Campaigns
// ───────────────────────────────────────────

export type CampaignModeDto = "draft" | "publish" | "schedule";

export interface CampaignPostInputDto {
  contentText?: string | null;
  contentMedia?: { type: "image" | "video"; url: string; mimeType: string }[] | null;
  providerMetadata?: PostProviderMetadata | null;
}

export interface CreateCampaignDto {
  socialAccountId: string;
  name: string;
  mode?: CampaignModeDto;
  post: CampaignPostInputDto;
  scheduledAt?: string | null;
  conditions?: EngagementGateConditionsDto | null;
  actionType?: EngagementGateActionTypeDto;
  actionText?: string | null;
  lineHarnessUrl?: string | null;
  lineHarnessApiKeyRef?: string | null;
  lineHarnessTag?: string | null;
  lineHarnessScenario?: string | null;
  stealthConfig?: EngagementGateStealthConfigDto | null;
}

export interface CampaignRecordDto {
  id: string;
  mode: CampaignModeDto;
  post: Post;
  gate: EngagementGateDto;
  schedule: ScheduledJob | null;
  verifyUrl: string;
}

export interface CampaignListItemDto {
  id: string;
  name: string;
  mode: CampaignModeDto;
  postStatus: string;
  gateStatus: EngagementGateStatusDto;
  postText: string | null;
  conditions: EngagementGateConditionsDto | null;
  lineHarness: {
    url: string | null;
    tag: string | null;
    scenario: string | null;
  };
  verifyUrl: string;
  updatedAt: string;
}

// ───────────────────────────────────────────
// Quote tweets
// ───────────────────────────────────────────

export type QuoteTweetActionTypeDto = "reply" | "like" | "repost";

export interface QuoteTweetDto extends XDateStampedDto {
  id: string;
  workspaceId: string;
  socialAccountId: string;
  sourceTweetId: string;
  quoteTweetId: string;
  authorExternalId: string;
  authorUsername: string | null;
  authorDisplayName: string | null;
  authorProfileImageUrl: string | null;
  authorVerified: boolean;
  contentText: string | null;
  contentMedia: { type: "image" | "video"; url: string; mimeType: string }[] | null;
  quotedAt: string | null;
  metrics: Record<string, unknown> | null;
  providerMetadata: Record<string, unknown> | null;
  lastActionType: QuoteTweetActionTypeDto | null;
  lastActionExternalId: string | null;
  lastActionAt: string | null;
  discoveredAt: string;
  lastSeenAt: string;
}

export interface ListQuoteTweetsParams {
  socialAccountId?: string;
  sourceTweetId?: string;
  limit?: number;
  offset?: number;
}

export interface SyncQuoteTweetsDto {
  socialAccountId: string;
  sourceTweetIds?: string[];
  limit?: number;
  cursor?: string | null;
}

export interface SyncQuoteTweetsResultDto {
  sourceTweetsScanned: number;
  quotesScanned: number;
  quotesStored: number;
  nextCursor: string | null;
}

export interface QuoteTweetActionDto {
  actionType: QuoteTweetActionTypeDto;
  contentText?: string | null;
}

export interface QuoteTweetActionResultDto {
  quote: QuoteTweetDto;
  externalActionId: string | null;
}

// ───────────────────────────────────────────
// Step sequences
// ───────────────────────────────────────────

export interface ListStepSequencesParams {
  socialAccountId?: string;
  status?: string;
  limit?: number;
}

export interface StepSequenceStepDto {
  delaySeconds?: number;
  actionType?: string;
  text?: string | null;
  [key: string]: unknown;
}

export interface CreateStepSequenceDto {
  socialAccountId: string;
  name: string;
  steps: StepSequenceStepDto[];
}

export interface StepSequenceDto {
  id: string;
  socialAccountId?: string;
  name?: string;
  status?: string;
  steps?: StepSequenceStepDto[];
  [key: string]: unknown;
}

export interface EnrollStepSequenceDto {
  externalUserId?: string;
  username?: string;
}

export interface StepSequenceEnrollmentDto {
  id: string;
  sequenceId: string;
  externalUserId?: string;
  username?: string;
  [key: string]: unknown;
}

// ───────────────────────────────────────────
// Agent Gateway
// ───────────────────────────────────────────

export type AgentExecutionMode = "read-only" | "draft" | "approval-required" | "direct-execute";

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
