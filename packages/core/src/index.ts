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
  Follower,
  Tag,
  EngagementGate,
  EngagementGateActionType,
  EngagementGateConditions,
  EngagementGateDelivery,
  EngagementGateDeliveryStatus,
  EngagementGateStatus,
  EngagementGateTriggerType,
  ProviderCapabilities,
  MediaAttachment,
  PostProviderMetadata,
  Post,
  ScheduledJob,
  ConversationThread,
  Message,
  InboxChannel,
  InboxInitiator,
  XInboxEntryType,
  ThreadProviderMetadata,
  MessageProviderMetadata,
  XThreadProviderMetadata,
  XMessageProviderMetadata,
  XPostProviderMetadata,
  XThreadPostSegment,
  UsageRecord,
  BudgetPolicy,
  LlmRoute,
  LlmProviderCredential,
  LlmProviderCredentialProvider,
  LlmProviderCredentialStatus,
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
  FollowerRepository,
  FollowerListFilters,
  FollowerUpsertInput,
  MarkMissingFollowersInput,
  MarkMissingFollowingInput,
  TagRepository,
  TagListFilters,
  TagCreateInput,
  TagUpdateInput,
  FollowerTagInput,
  EngagementGateRepository,
  EngagementGateListFilters,
  EngagementGateCreateInput,
  EngagementGateUpdateInput,
  EngagementGateDeliveryRepository,
  EngagementGateDeliveryCreateInput,
  EngagementGateDeliveryCreateResult,
  PostRepository,
  PostListFilters,
  PostOrderBy,
  ScheduledJobRepository,
  UsageRepository,
  UsageAggregation,
  BudgetPolicyRepository,
  LlmRouteRepository,
  LlmProviderCredentialRepository,
  SkillPackageRepository,
  AuditLogRepository,
  AuditLogFilterOptions,
  ApprovalRepository,
  ApprovalFilterOptions,
  ConversationRepository,
  ConversationFilterOptions,
  MessageRepository,
  MessageFilterOptions,
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
  ListFollowersInput,
  FollowerProviderProfile,
  FollowerListResult,
  EngagementReply,
  ListEngagementRepliesInput,
  EngagementReplyListResult,
  CheckEngagementConditionsInput,
  EngagementConditionResult,
  JobQueue,
} from "./interfaces/index.js";
export { ProviderRegistry } from "./interfaces/index.js";

// Policies
export { PERMISSIONS, rolePermissions, checkPermission } from "./policies/index.js";
export type { Permission } from "./policies/index.js";
export { requiresApproval, DEFAULT_APPROVAL_POLICY } from "./policies/index.js";
export type { ApprovalAction, ApprovalContext, ApprovalPolicyConfig } from "./policies/index.js";
export {
  evaluateBudgetPolicy,
  getPeriodStart as getBudgetPeriodStart,
  getPeriodEnd as getBudgetPeriodEnd,
} from "./policies/index.js";
export type {
  EvaluateBudgetPolicyDeps,
  EvaluateBudgetPolicyInput,
  BudgetEvaluation,
} from "./policies/index.js";

// Usecases
export { resolveActorByApiKey, resolveActorByUserId } from "./usecases/auth.js";
export type { Actor, AuthUserRepository, AuthAgentIdentityRepository } from "./usecases/auth.js";

export {
  listAccounts,
  getAccount,
  initiateConnection,
  handleOAuthCallback,
  disconnectAccount,
  refreshAccountToken,
  checkTokenExpiry,
} from "./usecases/account.js";
export type { AccountSummary, AccountUsecaseDeps, OAuthStatePayload } from "./usecases/account.js";

export { listFollowers, syncFollowersFromProvider } from "./usecases/followers.js";
export type {
  FollowerUsecaseDeps,
  ListFollowersResult,
  SyncFollowersFromProviderInput,
  SyncFollowersFromProviderResult,
} from "./usecases/followers.js";

export {
  attachFollowerTag,
  createTag,
  deleteTag,
  detachFollowerTag,
  listTags,
  updateTag,
} from "./usecases/tags.js";
export type {
  CreateTagInput,
  FollowerTagUsecaseInput,
  TagUsecaseDeps,
  UpdateTagInput,
} from "./usecases/tags.js";

export {
  consumeEngagementGateDeliveryToken,
  createEngagementGate,
  deleteEngagementGate,
  getEngagementGate,
  listEngagementGates,
  processEngagementGateReplies,
  updateEngagementGate,
  verifyEngagementGate,
} from "./usecases/engagement-gates.js";
export type {
  ConsumeEngagementGateDeliveryTokenInput,
  ConsumeEngagementGateDeliveryTokenResult,
  CreateEngagementGateInput,
  EngagementGateUsecaseDeps,
  ProcessEngagementGateRepliesInput,
  ProcessEngagementGateRepliesResult,
  UpdateEngagementGateInput,
  VerifyEngagementGateInput,
  VerifyEngagementGateResult,
} from "./usecases/engagement-gates.js";

export {
  createPost,
  updatePost,
  publishPost,
  publishPostChecked,
  deletePost,
  listPosts,
  getPost,
} from "./usecases/post.js";
export type {
  PostUsecaseDeps,
  CreatePostInput,
  UpdatePostInput,
  ListPostsFilters,
  ListPostsResult,
  PostListItem,
  PublishPostResult,
} from "./usecases/post.js";

export {
  schedulePost,
  updateSchedule,
  cancelSchedule,
  listSchedules,
  getSchedule,
  getScheduleOperationalView,
  executeJob,
  findExecutableJobs,
  dispatchDueJobs,
  RETRY_BACKOFF_SECONDS,
  LOCK_TIMEOUT_MS,
  POLL_BATCH_SIZE,
} from "./usecases/schedule.js";
export type {
  ScheduleUsecaseDeps,
  SchedulePostInput,
  ListSchedulesFilters,
  ExecuteJobResult,
  DispatchDueJobsItem,
  DispatchDueJobsResult,
  ScheduleNotificationTarget,
  ScheduleExecutionLog,
  ScheduleOperationalView,
} from "./usecases/schedule.js";

export {
  recordUsage,
  getUsageReport,
  getUsageSummary,
  getMonthStart,
  getMonthEnd,
  formatPeriodKey,
} from "./usecases/usage.js";
export type {
  UsageUsecaseDeps,
  UsagePeriod,
  RecordUsageInput,
  UsageReportFilters,
  UsageReportEntry,
  UsageReport,
  UsageSummary,
} from "./usecases/usage.js";

export {
  listThreads,
  getThread,
  processInboundMessage,
  syncInboxFromProvider,
  sendReply as sendInboxReply,
} from "./usecases/inbox.js";
export type {
  InboxUsecaseDeps,
  ListThreadsFilters,
  ListThreadsResult,
  GetThreadResult,
  InboundMessageInput,
  InboundMessageResult,
  SyncInboxFromProviderInput,
  SyncInboxFromProviderResult,
  SendReplyInput as InboxSendReplyInput,
  SendReplyResult as InboxSendReplyResult,
} from "./usecases/inbox.js";

export {
  listPolicies as listBudgetPolicies,
  createPolicy as createBudgetPolicy,
  updatePolicy as updateBudgetPolicy,
  deletePolicy as deleteBudgetPolicy,
  getBudgetStatus,
} from "./usecases/budget.js";
export type {
  BudgetUsecaseDeps,
  CreateBudgetPolicyInput,
  UpdateBudgetPolicyInput,
  BudgetPolicyStatus,
  BudgetStatusResult,
} from "./usecases/budget.js";

export {
  getLlmProviderCredential,
  getLlmProviderStatus,
  saveLlmProviderCredential,
  disconnectLlmProvider,
} from "./usecases/llm-provider-credentials.js";
export type {
  LlmProviderCredentialsDeps,
  LlmProviderConnectionStatus,
  LlmProviderStatusResult,
  SaveLlmProviderCredentialInput,
} from "./usecases/llm-provider-credentials.js";

export { recordAudit, listAuditLogs, exportAuditLogs } from "./usecases/audit.js";
export type {
  RecordAuditInput,
  ListAuditLogsInput,
  ListAuditLogsResult,
  ExportAuditLogsInput,
} from "./usecases/audit.js";

export {
  listSkillPackages,
  generateSkillPackage,
  enableSkillPackage,
  disableSkillPackage,
  getSkillManifest,
  getActiveSkills,
} from "./usecases/skills.js";
export type {
  SkillsUsecaseDeps,
  SkillManifestBuilder,
  SkillManifestLike,
  GenerateSkillPackageUsecaseInput,
} from "./usecases/skills.js";

export {
  handleChatMessage,
  executeAgentAction,
  buildSystemPrompt,
} from "./usecases/agent-gateway.js";
export type {
  AgentGatewayDeps,
  AgentActor,
  AgentExecutionMode,
  AgentSkillIntent,
  AgentLlmDecision,
  AgentLlmInvoker,
  AgentDryRunInvoker,
  AgentExecuteInvoker,
  AgentDryRunPreview,
  AgentExecutionOutcome,
  HandleChatMessageInput,
  HandleChatMessageResult,
  ExecuteAgentActionInput,
  ExecuteAgentActionResult,
} from "./usecases/agent-gateway.js";

export {
  createApprovalRequest,
  approveRequest,
  rejectRequest,
  listApprovals,
  listPendingApprovals,
  countPendingApprovals,
  expireStaleRequests,
  getApprovalRequest,
  APPROVAL_STALE_MS,
} from "./usecases/approval.js";
export type {
  ApprovalUsecaseDeps,
  ApprovalExecutor,
  CreateApprovalRequestInput,
  ApproveRequestInput,
  RejectRequestInput,
  ListPendingApprovalsInput,
  ListApprovalsResult,
  ApproveResult,
} from "./usecases/approval.js";

// Errors
export {
  DomainError,
  ValidationError,
  AuthorizationError,
  NotFoundError,
  BudgetExceededError,
  ProviderError,
  RateLimitError,
  LlmError,
} from "./errors/index.js";
