/**
 * Repository インターフェース定義
 *
 * DB 実装に依存しない抽象。packages/db で具象化する。
 * design.md セクション 3 のスキーマに対応。
 */
import type {
  SocialAccount,
  Post,
  ScheduledJob,
  UsageRecord,
  BudgetPolicy,
  LlmRoute,
  AuditLog,
  ApprovalRequest,
  ApprovalStatus,
  ConversationThread,
  Message,
  ThreadStatus,
} from "../domain/entities.js";
import type { Platform } from "@sns-agent/config";

// ───────────────────────────────────────────
// AccountRepository
// ───────────────────────────────────────────
export interface AccountRepository {
  findById(id: string): Promise<SocialAccount | null>;
  findByWorkspace(workspaceId: string): Promise<SocialAccount[]>;
  create(account: Omit<SocialAccount, "id" | "createdAt" | "updatedAt">): Promise<SocialAccount>;
  update(id: string, data: Partial<SocialAccount>): Promise<SocialAccount>;
  delete(id: string): Promise<void>;
}

// ───────────────────────────────────────────
// PostRepository
// ───────────────────────────────────────────
export interface PostRepository {
  findById(id: string): Promise<Post | null>;
  findByWorkspace(
    workspaceId: string,
    options?: { platform?: string; status?: string; limit?: number; offset?: number },
  ): Promise<Post[]>;
  create(post: Omit<Post, "id" | "createdAt" | "updatedAt">): Promise<Post>;
  update(id: string, data: Partial<Post>): Promise<Post>;
  delete(id: string): Promise<void>;
  findByIdempotencyKey(key: string): Promise<Post | null>;
}

// ───────────────────────────────────────────
// ScheduledJobRepository
// ───────────────────────────────────────────
export interface ScheduledJobRepository {
  findById(id: string): Promise<ScheduledJob | null>;
  findPendingJobs(limit: number): Promise<ScheduledJob[]>;
  create(job: Omit<ScheduledJob, "id" | "createdAt">): Promise<ScheduledJob>;
  update(id: string, data: Partial<ScheduledJob>): Promise<ScheduledJob>;
  /**
   * ジョブをアトミックにロックする。
   * pending 状態のジョブを locked に遷移し、locked_at を設定する。
   * 既にロックされている場合は null を返す。
   */
  lockJob(id: string): Promise<ScheduledJob | null>;
}

// ───────────────────────────────────────────
// UsageRepository
// ───────────────────────────────────────────
export interface UsageAggregation {
  platform: string;
  totalRequests: number;
  successCount: number;
  failureCount: number;
  totalCostUsd: number;
}

export interface UsageRepository {
  record(usage: Omit<UsageRecord, "id" | "createdAt">): Promise<UsageRecord>;
  aggregate(
    workspaceId: string,
    options: {
      platform?: string;
      startDate: Date;
      endDate: Date;
    },
  ): Promise<UsageAggregation[]>;
}

// ───────────────────────────────────────────
// BudgetPolicyRepository
// ───────────────────────────────────────────
export interface BudgetPolicyRepository {
  findByWorkspace(workspaceId: string): Promise<BudgetPolicy[]>;
  create(policy: Omit<BudgetPolicy, "id" | "createdAt" | "updatedAt">): Promise<BudgetPolicy>;
  update(id: string, data: Partial<BudgetPolicy>): Promise<BudgetPolicy>;
  delete(id: string): Promise<void>;
}

// ───────────────────────────────────────────
// LlmRouteRepository
// ───────────────────────────────────────────
export interface LlmRouteRepository {
  findByWorkspace(workspaceId: string): Promise<LlmRoute[]>;
  /**
   * platform / action / workspace を元に最適なルートを解決する。
   * priority が高い順にマッチングし、最初にマッチしたルートを返す。
   */
  resolve(
    workspaceId: string,
    options: { platform?: string; action?: string },
  ): Promise<LlmRoute | null>;
  create(route: Omit<LlmRoute, "id" | "createdAt" | "updatedAt">): Promise<LlmRoute>;
  update(id: string, data: Partial<LlmRoute>): Promise<LlmRoute>;
  delete(id: string): Promise<void>;
}

// ───────────────────────────────────────────
// AuditLogRepository
// ───────────────────────────────────────────
// 追記のみ: UPDATE / DELETE メソッドなし（design.md セクション 3）

export interface AuditLogFilterOptions {
  actorId?: string;
  actorType?: string;
  action?: string;
  resourceType?: string;
  platform?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

export interface AuditLogRepository {
  create(log: Omit<AuditLog, "id">): Promise<AuditLog>;
  findByWorkspace(workspaceId: string, options?: AuditLogFilterOptions): Promise<AuditLog[]>;
  countByWorkspace(
    workspaceId: string,
    options?: Omit<AuditLogFilterOptions, "limit" | "offset">,
  ): Promise<number>;
}

// ───────────────────────────────────────────
// ApprovalRepository
// ───────────────────────────────────────────

export interface ApprovalFilterOptions {
  status?: ApprovalStatus;
  resourceType?: string;
  requestedBy?: string;
  limit?: number;
  offset?: number;
}

export interface ApprovalRepository {
  findById(id: string): Promise<ApprovalRequest | null>;
  findByWorkspace(workspaceId: string, options?: ApprovalFilterOptions): Promise<ApprovalRequest[]>;
  countByWorkspace(
    workspaceId: string,
    options?: Omit<ApprovalFilterOptions, "limit" | "offset">,
  ): Promise<number>;
  create(req: Omit<ApprovalRequest, "id">): Promise<ApprovalRequest>;
  update(id: string, data: Partial<ApprovalRequest>): Promise<ApprovalRequest>;
  /**
   * requestedAt が cutoff より古い pending を expired に更新し、対象件数を返す。
   */
  expirePending(cutoff: Date): Promise<number>;
}

// ───────────────────────────────────────────
// ConversationRepository / MessageRepository
// ───────────────────────────────────────────

export interface ConversationFilterOptions {
  platform?: Platform;
  status?: ThreadStatus;
  limit?: number;
  offset?: number;
}

export interface ConversationRepository {
  findById(id: string): Promise<ConversationThread | null>;
  findByWorkspace(
    workspaceId: string,
    options?: ConversationFilterOptions,
  ): Promise<ConversationThread[]>;
  countByWorkspace(
    workspaceId: string,
    options?: Omit<ConversationFilterOptions, "limit" | "offset">,
  ): Promise<number>;
  /**
   * (workspaceId, socialAccountId, externalThreadId) の組で既存スレッドを検索する。
   * 受信イベント処理時に既存スレッドの特定に使う。
   */
  findByExternalThread(
    workspaceId: string,
    socialAccountId: string,
    externalThreadId: string,
  ): Promise<ConversationThread | null>;
  create(thread: Omit<ConversationThread, "id" | "createdAt">): Promise<ConversationThread>;
  update(id: string, data: Partial<ConversationThread>): Promise<ConversationThread>;
}

export interface MessageFilterOptions {
  limit?: number;
  offset?: number;
}

export interface MessageRepository {
  findByThread(threadId: string, options?: MessageFilterOptions): Promise<Message[]>;
  countByThread(threadId: string): Promise<number>;
  create(message: Omit<Message, "id" | "createdAt">): Promise<Message>;
}
