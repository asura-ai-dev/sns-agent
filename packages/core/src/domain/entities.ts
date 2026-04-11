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

export interface ConversationThread {
  id: string;
  workspaceId: string;
  socialAccountId: string;
  platform: Platform;
  externalThreadId: string | null;
  participantName: string | null;
  lastMessageAt: Date | null;
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
  sentAt: Date | null;
  createdAt: Date;
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
