/**
 * @sns-agent/sdk - TypeScript SDK
 *
 * CLI と Web UI が共通利用する API クライアント SDK。
 * fetch ベースの HTTP クライアント、リソース別メソッド、型定義、エラー型を提供する。
 */

// Client
export { SnsAgentClient } from "./client.js";
export type {
  SnsAgentClientOptions,
  AccountsResource,
  PostsResource,
  SchedulesResource,
  UsageResource,
  BudgetResource,
  AgentResource,
} from "./client.js";

// Types
export type {
  ApiResponse,
  ApiErrorResponse,
  PaginationMeta,
  ConnectAccountInput,
  ListPostsParams,
  CreatePostInput,
  UpdatePostInput,
  ListSchedulesParams,
  CreateScheduleInput,
  UpdateScheduleInput,
  RunDueSchedulesInput,
  RunDueSchedulesJobResult,
  RunDueSchedulesResult,
  UsageReportParams,
  UsagePeriod,
  UsageReportEntry,
  UsageReportMeta,
  UsageSummary,
  UsageSummaryReport,
  BudgetScopeType,
  BudgetPeriodType,
  BudgetActionOnExceed,
  BudgetPolicyDto,
  BudgetStatusDto,
  CreateBudgetPolicyDto,
  UpdateBudgetPolicyDto,
  SocialAccount,
  Post,
  PostProviderMetadata,
  ScheduledJob,
  UsageRecord,
  MediaAttachment,
  Platform,
  AgentExecutionMode,
  AgentSkillIntent,
  AgentSkillPreview,
  AgentChatTextResponse,
  AgentChatPreviewResponse,
  AgentChatResponse,
  AgentChatInput,
  AgentExecuteInput,
  AgentExecuteResponse,
  AgentHistoryEntry,
  AgentHistoryParams,
} from "./types.js";

// Errors
export { SdkError } from "./errors.js";
