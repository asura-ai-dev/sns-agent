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
  LlmProviderCredential,
  LlmProviderCredentialProvider,
  AuditLog,
  ApprovalRequest,
  ApprovalStatus,
  ConversationThread,
  Message,
  ThreadStatus,
  SkillPackage,
  Follower,
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
// FollowerRepository
// ───────────────────────────────────────────

export interface FollowerListFilters {
  socialAccountId?: string;
  isFollowed?: boolean;
  isFollowing?: boolean;
  limit?: number;
  offset?: number;
}

export type FollowerUpsertInput = Omit<Follower, "id" | "createdAt" | "updatedAt">;

export interface MarkMissingFollowersInput {
  workspaceId: string;
  socialAccountId: string;
  currentExternalUserIds: string[];
  unfollowedAt: Date;
}

export interface MarkMissingFollowingInput {
  workspaceId: string;
  socialAccountId: string;
  currentExternalUserIds: string[];
  updatedAt: Date;
}

export interface FollowerRepository {
  findByWorkspace(workspaceId: string, filters?: FollowerListFilters): Promise<Follower[]>;
  findByAccountAndExternalUser(
    socialAccountId: string,
    externalUserId: string,
  ): Promise<Follower | null>;
  upsert(follower: FollowerUpsertInput): Promise<Follower>;
  markMissingFollowersUnfollowed(input: MarkMissingFollowersInput): Promise<number>;
  markMissingFollowingInactive(input: MarkMissingFollowingInput): Promise<number>;
}

// ───────────────────────────────────────────
// PostRepository
// ───────────────────────────────────────────

/**
 * 投稿一覧のソートキー。
 * - createdAt: 作成日時（デフォルト、降順）
 * - publishedAt: 公開日時（降順。NULL は末尾）
 * - scheduledAt: 予約日時（scheduled_jobs.scheduled_at を参照）
 */
export type PostOrderBy = "createdAt" | "publishedAt" | "scheduledAt";

export interface PostListFilters {
  /** 単一プラットフォーム（後方互換） */
  platform?: string;
  /** 複数プラットフォーム（OR 条件） */
  platforms?: string[];
  /** 単一ステータス（後方互換） */
  status?: string;
  /** 複数ステータス（OR 条件） */
  statuses?: string[];
  /** created_at の下限（inclusive） */
  from?: Date;
  /** created_at の上限（inclusive） */
  to?: Date;
  /** contentText の部分一致検索 */
  search?: string;
  /** ソートキー（デフォルト createdAt） */
  orderBy?: PostOrderBy;
  limit?: number;
  offset?: number;
}

export interface PostRepository {
  findById(id: string): Promise<Post | null>;
  findByWorkspace(workspaceId: string, options?: PostListFilters): Promise<Post[]>;
  /**
   * findByWorkspace と同じフィルタで該当件数を返す。
   * limit/offset/orderBy は無視される。
   */
  countByWorkspace(
    workspaceId: string,
    options?: Omit<PostListFilters, "limit" | "offset" | "orderBy">,
  ): Promise<number>;
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
   * pending / retrying / 期限切れ locked 状態のジョブを locked に遷移し、locked_at を設定する。
   * 既にロックされている場合は null を返す。
   */
  lockJob(
    id: string,
    options?: {
      now?: Date;
      lockTimeoutMs?: number;
    },
  ): Promise<ScheduledJob | null>;
  /**
   * 指定した post_id 群に紐づく予約ジョブを返す。
   * 投稿一覧の schedule 情報（scheduledAt, status）を埋めるために使う。
   * 1 post に対し複数ジョブが存在する場合もあるが、呼び出し側は
   * 最新（scheduled_at 降順の先頭）を選択する。
   */
  findByPostIds(postIds: string[]): Promise<ScheduledJob[]>;
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
      /** 指定時はこのエンドポイントに限定して集計する（Task 4004 予算 scope=endpoint 用） */
      endpoint?: string;
      startDate: Date;
      endDate: Date;
    },
  ): Promise<UsageAggregation[]>;
}

// ───────────────────────────────────────────
// BudgetPolicyRepository
// ───────────────────────────────────────────
export interface BudgetPolicyRepository {
  findById(id: string): Promise<BudgetPolicy | null>;
  findByWorkspace(workspaceId: string): Promise<BudgetPolicy[]>;
  create(policy: Omit<BudgetPolicy, "id" | "createdAt" | "updatedAt">): Promise<BudgetPolicy>;
  update(id: string, data: Partial<BudgetPolicy>): Promise<BudgetPolicy>;
  delete(id: string): Promise<void>;
}

// ───────────────────────────────────────────
// SkillPackageRepository
// ───────────────────────────────────────────
/**
 * skill_packages テーブル向けの Repository (Task 5002)。
 * Agent Gateway が system prompt 構築時に「有効化済みの skill package」を読み出す。
 */
export interface SkillPackageRepository {
  findById(id: string): Promise<SkillPackage | null>;
  /**
   * ワークスペースの skill package を返す。
   * onlyEnabled=true の場合 enabled=true の行だけを返す。
   */
  findByWorkspace(workspaceId: string, onlyEnabled?: boolean): Promise<SkillPackage[]>;
  findByName(workspaceId: string, name: string): Promise<SkillPackage | null>;
  create(pkg: Omit<SkillPackage, "id" | "createdAt" | "updatedAt">): Promise<SkillPackage>;
  update(id: string, data: Partial<SkillPackage>): Promise<SkillPackage>;
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
// LlmProviderCredentialRepository
// ───────────────────────────────────────────
export interface LlmProviderCredentialRepository {
  findByWorkspaceAndProvider(
    workspaceId: string,
    provider: LlmProviderCredentialProvider,
  ): Promise<LlmProviderCredential | null>;
  upsert(
    credential: Omit<LlmProviderCredential, "id" | "createdAt" | "updatedAt">,
  ): Promise<LlmProviderCredential>;
  deleteByWorkspaceAndProvider(
    workspaceId: string,
    provider: LlmProviderCredentialProvider,
  ): Promise<void>;
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
  resourceId?: string;
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
  findByExternalMessage(threadId: string, externalMessageId: string): Promise<Message | null>;
  create(message: Omit<Message, "id" | "createdAt">): Promise<Message>;
}
