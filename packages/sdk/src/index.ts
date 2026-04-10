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
  UsageReportParams,
  UsageSummary,
  SocialAccount,
  Post,
  ScheduledJob,
  UsageRecord,
  MediaAttachment,
  Platform,
} from "./types.js";

// Errors
export { SdkError } from "./errors.js";
