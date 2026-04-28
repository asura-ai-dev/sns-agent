/**
 * ドメインエンティティ型定義
 *
 * design.md セクション 3 (DB スキーマ) に準拠。
 * Platform, Role 等の列挙型は @sns-agent/config から import する。
 */
import type {
  Platform,
  Role,
  PostStatus,
  JobStatus,
  AccountStatus,
  BudgetAction,
} from "@sns-agent/config";

// ───────────────────────────────────────────
// Workspace
// ───────────────────────────────────────────
export interface Workspace {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

// ───────────────────────────────────────────
// User
// ───────────────────────────────────────────
export interface User {
  id: string;
  workspaceId: string;
  email: string;
  name: string | null;
  role: Exclude<Role, "agent">;
  createdAt: Date;
}

// ───────────────────────────────────────────
// AgentIdentity
// ───────────────────────────────────────────
export interface AgentIdentity {
  id: string;
  workspaceId: string;
  name: string;
  role: Role;
  apiKeyHash: string;
  createdAt: Date;
}

// ───────────────────────────────────────────
// SocialAccount
// ───────────────────────────────────────────

/** メディア添付の型 */
export interface MediaAttachment {
  type: "image" | "video";
  url: string;
  mimeType: string;
}

export interface SocialAccount {
  id: string;
  workspaceId: string;
  platform: Platform;
  displayName: string;
  externalAccountId: string;
  credentialsEncrypted: string;
  tokenExpiresAt: Date | null;
  status: AccountStatus;
  capabilities: ProviderCapabilities | null;
  createdAt: Date;
  updatedAt: Date;
}

// ───────────────────────────────────────────
// Follower
// ───────────────────────────────────────────

export interface Follower {
  id: string;
  workspaceId: string;
  socialAccountId: string;
  platform: Platform;
  externalUserId: string;
  displayName: string | null;
  username: string | null;
  isFollowing: boolean;
  isFollowed: boolean;
  unfollowedAt: Date | null;
  metadata: Record<string, unknown> | null;
  lastSeenAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface Tag {
  id: string;
  workspaceId: string;
  socialAccountId: string;
  name: string;
  color: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ───────────────────────────────────────────
// Engagement Gate
// ───────────────────────────────────────────

export type EngagementGateStatus = "active" | "paused";
export type EngagementGateTriggerType = "reply";
export type EngagementGateActionType = "mention_post" | "dm" | "verify_only";
export type EngagementGateDeliveryStatus = "delivered" | "verified";

export interface EngagementGateConditions {
  requireLike?: boolean;
  requireRepost?: boolean;
  requireFollow?: boolean;
}

export interface EngagementGateStealthConfig {
  gateHourlyLimit?: number | null;
  gateDailyLimit?: number | null;
  accountHourlyLimit?: number | null;
  accountDailyLimit?: number | null;
  jitterMinSeconds?: number | null;
  jitterMaxSeconds?: number | null;
  backoffSeconds?: number | null;
  templateVariants?: string[] | null;
}

export interface EngagementGate {
  id: string;
  workspaceId: string;
  socialAccountId: string;
  platform: Platform;
  name: string;
  status: EngagementGateStatus;
  triggerType: EngagementGateTriggerType;
  triggerPostId: string | null;
  conditions: EngagementGateConditions | null;
  actionType: EngagementGateActionType;
  actionText: string | null;
  lineHarnessUrl: string | null;
  lineHarnessApiKeyRef: string | null;
  lineHarnessTag: string | null;
  lineHarnessScenario: string | null;
  stealthConfig: EngagementGateStealthConfig | null;
  deliveryBackoffUntil: Date | null;
  lastReplySinceId: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EngagementGateDelivery {
  id: string;
  workspaceId: string;
  engagementGateId: string;
  socialAccountId: string;
  externalUserId: string;
  externalReplyId: string | null;
  actionType: EngagementGateActionType;
  status: EngagementGateDeliveryStatus;
  responseExternalId: string | null;
  deliveryToken: string;
  consumedAt: Date | null;
  metadata: Record<string, unknown> | null;
  deliveredAt: Date;
  createdAt: Date;
}

/** Provider が公開する能力セット */
export interface ProviderCapabilities {
  textPost: boolean;
  imagePost: boolean;
  videoPost: boolean;
  threadPost: boolean;
  directMessage: boolean;
  commentReply: boolean;
  broadcast: boolean;
  nativeSchedule: boolean;
  usageApi: boolean;
}

// ───────────────────────────────────────────
// Post
// ───────────────────────────────────────────
export interface Post {
  id: string;
  workspaceId: string;
  socialAccountId: string;
  platform: Platform;
  status: PostStatus;
  contentText: string | null;
  contentMedia: MediaAttachment[] | null;
  providerMetadata?: PostProviderMetadata | null;
  platformPostId: string | null;
  validationResult: unknown | null;
  idempotencyKey: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  publishedAt: Date | null;
}

// ───────────────────────────────────────────
// ScheduledJob
// ───────────────────────────────────────────
export interface ScheduledJob {
  id: string;
  workspaceId: string;
  postId: string;
  scheduledAt: Date;
  status: JobStatus;
  lockedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  attemptCount: number;
  maxAttempts: number;
  lastError: string | null;
  nextRetryAt: Date | null;
  createdAt: Date;
}

// ───────────────────────────────────────────
// ConversationThread / Message
// ───────────────────────────────────────────
export type ThreadStatus = "open" | "closed" | "archived";
export type MessageDirection = "inbound" | "outbound";
export type InboxChannel = "direct" | "public";
export type InboxInitiator = "self" | "external" | "mixed" | "unknown";
export type XInboxEntryType = "mention" | "reply" | "thread" | "dm";

/**
 * provider 固有の受信メタデータ。
 *
 * 設計方針:
 * - UI / CLI / API が共通で見たい項目は ConversationThread / Message 直下へ置く
 * - X の conversation_id や reply 対象 post_id など、SNS 固有の項目はここへ分離する
 */
export interface XThreadProviderMetadata {
  entryType: XInboxEntryType;
  conversationId: string | null;
  rootPostId: string | null;
  focusPostId: string | null;
  replyToPostId: string | null;
  authorXUserId: string | null;
  authorUsername: string | null;
}

export interface XMessageProviderMetadata {
  entryType: XInboxEntryType;
  conversationId: string | null;
  postId: string | null;
  replyToPostId: string | null;
  authorUsername: string | null;
  mentionedXUserIds: string[];
}

export interface ThreadProviderMetadata {
  x?: XThreadProviderMetadata;
}

export interface MessageProviderMetadata {
  x?: XMessageProviderMetadata;
}

export interface ConversationThread {
  id: string;
  workspaceId: string;
  socialAccountId: string;
  platform: Platform;
  externalThreadId: string | null;
  participantName: string | null;
  participantExternalId: string | null;
  channel: InboxChannel | null;
  initiatedBy: InboxInitiator | null;
  lastMessageAt: Date | null;
  providerMetadata: ThreadProviderMetadata | null;
  status: ThreadStatus;
  createdAt: Date;
}

export interface Message {
  id: string;
  threadId: string;
  direction: MessageDirection;
  contentText: string | null;
  contentMedia: MediaAttachment[] | null;
  externalMessageId: string | null;
  authorExternalId: string | null;
  authorDisplayName: string | null;
  sentAt: Date | null;
  providerMetadata: MessageProviderMetadata | null;
  createdAt: Date;
}

// ───────────────────────────────────────────
// Post provider metadata
// ───────────────────────────────────────────

export interface XThreadPostSegment {
  contentText: string;
}

export interface XPostProviderMetadata {
  /** 引用対象の X post/tweet ID */
  quotePostId?: string | null;
  /** 1 件目の投稿に続けて self-reply で連投するセグメント */
  threadPosts?: XThreadPostSegment[] | null;
  /** 公開後に確定した thread 全体の post ID 群（root を含む） */
  publishedThreadIds?: string[] | null;
}

export interface PostProviderMetadata {
  x?: XPostProviderMetadata;
}

// ───────────────────────────────────────────
// UsageRecord
// ───────────────────────────────────────────
export type ActorType = "user" | "agent";

export interface UsageRecord {
  id: string;
  workspaceId: string;
  platform: string;
  endpoint: string;
  actorId: string | null;
  actorType: ActorType;
  requestCount: number;
  success: boolean;
  estimatedCostUsd: number | null;
  recordedAt: Date;
  createdAt: Date;
}

// ───────────────────────────────────────────
// BudgetPolicy
// ───────────────────────────────────────────
export type BudgetScopeType = "workspace" | "platform" | "endpoint";
export type BudgetPeriod = "daily" | "weekly" | "monthly";

export interface BudgetPolicy {
  id: string;
  workspaceId: string;
  scopeType: BudgetScopeType;
  scopeValue: string | null;
  period: BudgetPeriod;
  limitAmountUsd: number;
  actionOnExceed: BudgetAction;
  createdAt: Date;
  updatedAt: Date;
}

// ───────────────────────────────────────────
// LlmRoute
// ───────────────────────────────────────────
export interface LlmRoute {
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
  createdAt: Date;
  updatedAt: Date;
}

// ───────────────────────────────────────────
// LLM Provider Credential
// ───────────────────────────────────────────
export type LlmProviderCredentialProvider = "openai-codex";
export type LlmProviderCredentialStatus = "connected" | "expired" | "reauth_required";

export interface LlmProviderCredential {
  id: string;
  workspaceId: string;
  provider: LlmProviderCredentialProvider;
  status: LlmProviderCredentialStatus;
  /**
   * Encrypted token material only. Raw OAuth tokens must be encrypted before
   * they enter the repository layer.
   */
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string | null;
  expiresAt: Date | null;
  scopes: string[] | null;
  subject: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

// ───────────────────────────────────────────
// SkillPackage
// ───────────────────────────────────────────
export interface SkillPackage {
  id: string;
  workspaceId: string;
  name: string;
  version: string;
  platform: string;
  llmProvider: string;
  manifest: Record<string, unknown>;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ───────────────────────────────────────────
// ApprovalRequest
// ───────────────────────────────────────────
export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";

export interface ApprovalRequest {
  id: string;
  workspaceId: string;
  resourceType: string;
  resourceId: string;
  payload: unknown | null;
  requestedBy: string;
  requestedAt: Date;
  status: ApprovalStatus;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  reason: string | null;
}

// ───────────────────────────────────────────
// AuditLog
// ───────────────────────────────────────────
export type AuditActorType = "user" | "agent" | "system";

export interface AuditLog {
  id: string;
  workspaceId: string;
  actorId: string;
  actorType: AuditActorType;
  action: string;
  resourceType: string;
  resourceId: string | null;
  platform: string | null;
  socialAccountId: string | null;
  inputSummary: unknown | null;
  resultSummary: unknown | null;
  estimatedCostUsd: number | null;
  requestId: string | null;
  createdAt: Date;
}
