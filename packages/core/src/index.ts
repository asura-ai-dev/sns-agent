/**
 * @sns-agent/core - ドメインロジックパッケージ
 *
 * ビジネスルールの中心。UI や CLI に依存しない。
 * Provider 共通インターフェース、Repository 抽象、RBAC ポリシー、エラー型を提供する。
 */

// Domain entities & crypto
export type {
  Workspace,
  User,
  AgentIdentity,
  SocialAccount,
  ProviderCapabilities,
  MediaAttachment,
  Post,
  ScheduledJob,
  ConversationThread,
  Message,
  UsageRecord,
  BudgetPolicy,
  LlmRoute,
  SkillPackage,
  ApprovalRequest,
  AuditLog,
  ThreadStatus,
  MessageDirection,
  ActorType,
  AuditActorType,
  ApprovalStatus,
  BudgetScopeType,
  BudgetPeriod,
} from "./domain/index.js";
export { encrypt, decrypt } from "./domain/index.js";

// Interfaces
export type {
  AccountRepository,
  PostRepository,
  ScheduledJobRepository,
  UsageRepository,
  UsageAggregation,
  BudgetPolicyRepository,
  LlmRouteRepository,
  AuditLogRepository,
  SocialProvider,
  ConnectAccountInput,
  ConnectAccountResult,
  ValidatePostInput,
  ValidationResult,
  ValidationIssue,
  PublishPostInput,
  PublishResult,
  DeletePostInput,
  DeleteResult,
  ListThreadsInput,
  ThreadListResult,
  GetMessagesInput,
  MessageListResult,
  SendReplyInput,
  SendReplyResult,
  WebhookInput,
  WebhookResult,
  WebhookEvent,
  RefreshResult,
  JobQueue,
} from "./interfaces/index.js";

// Policies
export { PERMISSIONS, rolePermissions, checkPermission } from "./policies/index.js";
export type { Permission } from "./policies/index.js";

// Usecases
export { resolveActorByApiKey, resolveActorByUserId } from "./usecases/auth.js";
export type { Actor, AuthUserRepository, AuthAgentIdentityRepository } from "./usecases/auth.js";

// Errors
export {
  DomainError,
  ValidationError,
  AuthorizationError,
  NotFoundError,
  BudgetExceededError,
  ProviderError,
  RateLimitError,
} from "./errors/index.js";
