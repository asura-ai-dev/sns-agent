/**
 * SnsAgentClient - fetch ベースの HTTP クライアント
 *
 * CLI と Web UI が共通利用する API クライアント SDK。
 * Authorization / Content-Type / X-Idempotency-Key ヘッダを自動付与し、
 * エラーレスポンスを SdkError に変換する。
 */

import { SdkError } from "./errors.js";
import type {
  AgentChatInput,
  AgentChatResponse,
  AgentExecuteInput,
  AgentExecuteResponse,
  AgentHistoryEntry,
  AgentHistoryParams,
  ApiResponse,
  BudgetPolicyDto,
  BudgetStatusDto,
  CampaignListItemDto,
  CampaignRecordDto,
  CaptureFollowerSnapshotDto,
  CaptureFollowerSnapshotResultDto,
  CaptureFollowerSnapshotsForWorkspaceResultDto,
  ConsumeEngagementGateDeliveryTokenDto,
  ConsumeEngagementGateDeliveryTokenResultDto,
  ConnectAccountInput,
  CreateCampaignDto,
  CreateEngagementGateDto,
  CreateBudgetPolicyDto,
  CreatePostInput,
  CreateScheduleInput,
  CreateStepSequenceDto,
  CreateTagDto,
  EnrollStepSequenceDto,
  EngagementGateDto,
  FollowerAnalyticsParams,
  FollowerAnalyticsResultDto,
  FollowerDto,
  FollowerTagInput,
  ListEngagementGatesParams,
  ListFollowersParams,
  ListPostsParams,
  ListQuoteTweetsParams,
  ListSchedulesParams,
  ListStepSequencesParams,
  ListTagsParams,
  OffsetApiResponse,
  Post,
  ProcessEngagementGateRepliesDto,
  ProcessEngagementGateRepliesResultDto,
  QuoteTweetActionDto,
  QuoteTweetActionResultDto,
  QuoteTweetDto,
  RunDueSchedulesInput,
  RunDueSchedulesResult,
  ScheduledJob,
  SocialAccount,
  StepSequenceDto,
  StepSequenceEnrollmentDto,
  SyncFollowersInput,
  SyncFollowersResultDto,
  SyncQuoteTweetsDto,
  SyncQuoteTweetsResultDto,
  TagDto,
  UpdateBudgetPolicyDto,
  UpdateEngagementGateDto,
  UpdatePostInput,
  UpdateScheduleInput,
  UpdateTagDto,
  UsageRecord,
  UsageReportEntry,
  UsageReportMeta,
  UsageReportParams,
  UsageSummary,
  UsageSummaryReport,
  VerifyEngagementGateParams,
  VerifyEngagementGateResultDto,
} from "./types.js";

// ───────────────────────────────────────────
// クライアント設定
// ───────────────────────────────────────────

export interface SnsAgentClientOptions {
  /** API のベース URL (例: http://localhost:3001) */
  baseUrl: string;
  /** API キー (Authorization: Bearer <apiKey>) */
  apiKey: string;
  /** セッションユーザー ID（Web UI 用。指定すると X-Session-User-Id ヘッダを送信） */
  sessionUserId?: string;
  /** カスタム fetch 実装（テスト用） */
  fetch?: typeof globalThis.fetch;
}

export type SnsAgentHttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export interface SnsAgentRequestOptions {
  params?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
}

// ───────────────────────────────────────────
// ユーティリティ
// ───────────────────────────────────────────

/** crypto.randomUUID がなければフォールバック */
function generateIdempotencyKey(): string {
  if (typeof globalThis.crypto !== "undefined" && globalThis.crypto.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  // Node.js 環境用フォールバック
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/** クエリパラメータオブジェクトを URLSearchParams に変換する。undefined は除外する */
function toSearchParams(params?: Record<string, string | number | boolean | undefined>): string {
  if (!params) return "";
  const entries = Object.entries(params).filter(
    (entry): entry is [string, string | number | boolean] => entry[1] !== undefined,
  );
  if (entries.length === 0) return "";
  const sp = new URLSearchParams();
  for (const [key, value] of entries) {
    sp.set(key, String(value));
  }
  return `?${sp.toString()}`;
}

// ───────────────────────────────────────────
// リソースアクセサ型
// ───────────────────────────────────────────

export interface AccountsResource {
  list(): Promise<ApiResponse<SocialAccount[]>>;
  get(id: string): Promise<ApiResponse<SocialAccount>>;
  connect(input: ConnectAccountInput): Promise<ApiResponse<SocialAccount>>;
  disconnect(id: string): Promise<ApiResponse<{ success: boolean }>>;
}

export interface PostsResource {
  list(params?: ListPostsParams): Promise<ApiResponse<Post[]>>;
  get(id: string): Promise<ApiResponse<Post>>;
  create(input: CreatePostInput): Promise<ApiResponse<Post>>;
  update(id: string, input: UpdatePostInput): Promise<ApiResponse<Post>>;
  delete(id: string): Promise<ApiResponse<{ success: boolean }>>;
  publish(id: string): Promise<ApiResponse<Post>>;
}

export interface SchedulesResource {
  list(params?: ListSchedulesParams): Promise<ApiResponse<ScheduledJob[]>>;
  create(input: CreateScheduleInput): Promise<ApiResponse<ScheduledJob>>;
  update(id: string, input: UpdateScheduleInput): Promise<ApiResponse<ScheduledJob>>;
  cancel(id: string): Promise<ApiResponse<ScheduledJob>>;
  runDue(input?: RunDueSchedulesInput): Promise<ApiResponse<RunDueSchedulesResult>>;
}

export interface UsageResource {
  /**
   * Legacy report endpoint kept for SDK compatibility — returns raw `UsageRecord[]`
   * for older callers that call it as a list. New callers should use `reportAggregated`.
   */
  report(params?: UsageReportParams): Promise<ApiResponse<UsageRecord[]>>;
  /**
   * Period-aggregated report from `/api/usage`. Each entry is one bucket
   * (day/week/month) × platform with totals and success rate.
   */
  reportAggregated(
    params?: UsageReportParams,
  ): Promise<ApiResponse<UsageReportEntry[]> & { meta?: UsageReportMeta }>;
  summary(): Promise<ApiResponse<UsageSummary>>;
  /** New shape for `/api/usage/summary` matching the API wire format. */
  summaryReport(): Promise<ApiResponse<UsageSummaryReport>>;
}

export interface BudgetResource {
  listPolicies(): Promise<ApiResponse<BudgetPolicyDto[]>>;
  createPolicy(input: CreateBudgetPolicyDto): Promise<ApiResponse<BudgetPolicyDto>>;
  updatePolicy(id: string, input: UpdateBudgetPolicyDto): Promise<ApiResponse<BudgetPolicyDto>>;
  deletePolicy(id: string): Promise<ApiResponse<{ id: string; deleted: boolean }>>;
  status(): Promise<ApiResponse<BudgetStatusDto[]>>;
}

export interface EngagementGatesResource {
  list(params?: ListEngagementGatesParams): Promise<ApiResponse<EngagementGateDto[]>>;
  get(id: string): Promise<ApiResponse<EngagementGateDto>>;
  create(input: CreateEngagementGateDto): Promise<ApiResponse<EngagementGateDto>>;
  update(id: string, input: UpdateEngagementGateDto): Promise<ApiResponse<EngagementGateDto>>;
  delete(id: string): Promise<ApiResponse<{ success: boolean }>>;
  process(
    input?: ProcessEngagementGateRepliesDto,
  ): Promise<ApiResponse<ProcessEngagementGateRepliesResultDto>>;
  verify(
    id: string,
    params: VerifyEngagementGateParams,
  ): Promise<ApiResponse<VerifyEngagementGateResultDto>>;
  consumeDeliveryToken(
    id: string,
    input: ConsumeEngagementGateDeliveryTokenDto,
  ): Promise<ApiResponse<ConsumeEngagementGateDeliveryTokenResultDto>>;
}

export interface FollowersResource {
  list(params?: ListFollowersParams): Promise<OffsetApiResponse<FollowerDto[]>>;
  sync(input: SyncFollowersInput): Promise<ApiResponse<SyncFollowersResultDto>>;
  attachTag(
    followerId: string,
    tagId: string,
    input: FollowerTagInput,
  ): Promise<ApiResponse<{ success: boolean }>>;
  detachTag(
    followerId: string,
    tagId: string,
    input: FollowerTagInput,
  ): Promise<ApiResponse<{ success: boolean }>>;
}

export interface TagsResource {
  list(params?: ListTagsParams): Promise<ApiResponse<TagDto[]>>;
  create(input: CreateTagDto): Promise<ApiResponse<TagDto>>;
  update(id: string, input: UpdateTagDto): Promise<ApiResponse<TagDto>>;
  delete(id: string): Promise<ApiResponse<{ success: boolean }>>;
}

export interface FollowerAnalyticsResource {
  get(params: FollowerAnalyticsParams): Promise<ApiResponse<FollowerAnalyticsResultDto>>;
  captureSnapshot(
    input?: CaptureFollowerSnapshotDto,
  ): Promise<
    ApiResponse<CaptureFollowerSnapshotResultDto | CaptureFollowerSnapshotsForWorkspaceResultDto>
  >;
}

export interface CampaignsResource {
  /** Agent usage example: create a draft/publish/schedule campaign from one typed payload. */
  create(input: CreateCampaignDto): Promise<ApiResponse<CampaignRecordDto>>;
  list(): Promise<ApiResponse<CampaignListItemDto[]>>;
}

export interface QuoteTweetsResource {
  list(params?: ListQuoteTweetsParams): Promise<ApiResponse<QuoteTweetDto[]>>;
  sync(input: SyncQuoteTweetsDto): Promise<ApiResponse<SyncQuoteTweetsResultDto>>;
  get(id: string): Promise<ApiResponse<QuoteTweetDto>>;
  action(id: string, input: QuoteTweetActionDto): Promise<ApiResponse<QuoteTweetActionResultDto>>;
}

export interface StepSequencesResource {
  /** Agent/MCP usage example: reserved X step sequence list path with typed query params. */
  list(params?: ListStepSequencesParams): Promise<ApiResponse<StepSequenceDto[]>>;
  create(input: CreateStepSequenceDto): Promise<ApiResponse<StepSequenceDto>>;
  enroll(
    sequenceId: string,
    input: EnrollStepSequenceDto,
  ): Promise<ApiResponse<StepSequenceEnrollmentDto>>;
}

export interface AgentResource {
  chat(input: AgentChatInput): Promise<ApiResponse<AgentChatResponse>>;
  execute(input: AgentExecuteInput): Promise<ApiResponse<AgentExecuteResponse>>;
  history(params?: AgentHistoryParams): Promise<ApiResponse<AgentHistoryEntry[]>>;
}

// ───────────────────────────────────────────
// SnsAgentClient
// ───────────────────────────────────────────

export class SnsAgentClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly sessionUserId?: string;
  private readonly _fetch: typeof globalThis.fetch;

  public readonly accounts: AccountsResource;
  public readonly posts: PostsResource;
  public readonly schedules: SchedulesResource;
  public readonly usage: UsageResource;
  public readonly budget: BudgetResource;
  public readonly engagementGates: EngagementGatesResource;
  public readonly followers: FollowersResource;
  public readonly tags: TagsResource;
  public readonly followerAnalytics: FollowerAnalyticsResource;
  public readonly campaigns: CampaignsResource;
  public readonly quoteTweets: QuoteTweetsResource;
  public readonly stepSequences: StepSequencesResource;
  public readonly agent: AgentResource;

  constructor(options: SnsAgentClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.sessionUserId = options.sessionUserId;
    this._fetch = options.fetch ?? globalThis.fetch.bind(globalThis);

    // リソース別メソッドをバインド
    this.accounts = this._buildAccounts();
    this.posts = this._buildPosts();
    this.schedules = this._buildSchedules();
    this.usage = this._buildUsage();
    this.budget = this._buildBudget();
    this.engagementGates = this._buildEngagementGates();
    this.followers = this._buildFollowers();
    this.tags = this._buildTags();
    this.followerAnalytics = this._buildFollowerAnalytics();
    this.campaigns = this._buildCampaigns();
    this.quoteTweets = this._buildQuoteTweets();
    this.stepSequences = this._buildStepSequences();
    this.agent = this._buildAgent();
  }

  // ───────────────────────────────────────
  // 汎用 HTTP メソッド
  // ───────────────────────────────────────

  /**
   * GET リクエストを送信する。
   * @param path - API パス (例: /api/accounts)
   * @param params - クエリパラメータ
   */
  async get<T>(
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}${toSearchParams(params)}`;
    const res = await this._fetch(url, {
      method: "GET",
      headers: this._headers(),
    });
    return this._handleResponse<T>(res);
  }

  /**
   * POST リクエストを送信する。書き込み操作として X-Idempotency-Key を付与する。
   * @param path - API パス
   * @param body - リクエストボディ
   */
  async post<T>(path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await this._fetch(url, {
      method: "POST",
      headers: this._headers({ idempotency: true }),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return this._handleResponse<T>(res);
  }

  /**
   * PATCH リクエストを送信する。書き込み操作として X-Idempotency-Key を付与する。
   * @param path - API パス
   * @param body - リクエストボディ
   */
  async patch<T>(path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await this._fetch(url, {
      method: "PATCH",
      headers: this._headers({ idempotency: true }),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return this._handleResponse<T>(res);
  }

  /**
   * DELETE リクエストを送信する。書き込み操作として X-Idempotency-Key を付与する。
   * @param path - API パス
   */
  async delete<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await this._fetch(url, {
      method: "DELETE",
      headers: this._headers({ idempotency: true }),
    });
    return this._handleResponse<T>(res);
  }

  async request<T>(
    method: SnsAgentHttpMethod,
    path: string,
    options: SnsAgentRequestOptions = {},
  ): Promise<T> {
    const normalizedMethod = method.toUpperCase() as SnsAgentHttpMethod;
    const url = `${this.baseUrl}${path}${toSearchParams(options.params)}`;
    const hasBody = options.body !== undefined;
    const res = await this._fetch(url, {
      method: normalizedMethod,
      headers: this._headers({
        idempotency: normalizedMethod !== "GET",
      }),
      body: hasBody ? JSON.stringify(options.body) : undefined,
    });
    return this._handleResponse<T>(res);
  }

  // ───────────────────────────────────────
  // 内部ヘルパー
  // ───────────────────────────────────────

  private _headers(opts?: { idempotency?: boolean }): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      h["Authorization"] = `Bearer ${this.apiKey}`;
    }
    if (this.sessionUserId) {
      h["X-Session-User-Id"] = this.sessionUserId;
    }
    if (opts?.idempotency) {
      h["X-Idempotency-Key"] = generateIdempotencyKey();
    }
    return h;
  }

  private async _handleResponse<T>(res: Response): Promise<T> {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = null;
    }

    if (!res.ok) {
      throw SdkError.fromResponse(res.status, body);
    }

    return body as T;
  }

  // ───────────────────────────────────────
  // リソース別メソッドビルダー
  // ───────────────────────────────────────

  private _buildAccounts(): AccountsResource {
    return {
      list: () => this.get<ApiResponse<SocialAccount[]>>("/api/accounts"),
      get: (id) => this.get<ApiResponse<SocialAccount>>(`/api/accounts/${id}`),
      connect: (input) => this.post<ApiResponse<SocialAccount>>("/api/accounts", input),
      disconnect: (id) => this.delete<ApiResponse<{ success: boolean }>>(`/api/accounts/${id}`),
    };
  }

  private _buildPosts(): PostsResource {
    return {
      list: (params) =>
        this.get<ApiResponse<Post[]>>(
          "/api/posts",
          params as Record<string, string | number | boolean | undefined>,
        ),
      get: (id) => this.get<ApiResponse<Post>>(`/api/posts/${id}`),
      create: (input) => {
        const { publish, publishNow, ...body } = input;
        return this.post<ApiResponse<Post>>("/api/posts", {
          ...body,
          publishNow: publishNow ?? publish ?? false,
        });
      },
      update: (id, input) => this.patch<ApiResponse<Post>>(`/api/posts/${id}`, input),
      delete: (id) => this.delete<ApiResponse<{ success: boolean }>>(`/api/posts/${id}`),
      publish: (id) => this.post<ApiResponse<Post>>(`/api/posts/${id}/publish`),
    };
  }

  private _buildSchedules(): SchedulesResource {
    return {
      list: (params) =>
        this.get<ApiResponse<ScheduledJob[]>>(
          "/api/schedules",
          params as Record<string, string | number | boolean | undefined>,
        ),
      create: (input) => this.post<ApiResponse<ScheduledJob>>("/api/schedules", input),
      update: (id, input) => this.patch<ApiResponse<ScheduledJob>>(`/api/schedules/${id}`, input),
      cancel: (id) => this.delete<ApiResponse<ScheduledJob>>(`/api/schedules/${id}`),
      runDue: (input) =>
        this.post<ApiResponse<RunDueSchedulesResult>>("/api/schedules/run-due", input ?? {}),
    };
  }

  private _buildUsage(): UsageResource {
    return {
      report: (params) =>
        this.get<ApiResponse<UsageRecord[]>>(
          "/api/usage",
          params as Record<string, string | number | boolean | undefined>,
        ),
      reportAggregated: (params) =>
        this.get<ApiResponse<UsageReportEntry[]> & { meta?: UsageReportMeta }>(
          "/api/usage",
          params as Record<string, string | number | boolean | undefined>,
        ),
      summary: () => this.get<ApiResponse<UsageSummary>>("/api/usage/summary"),
      summaryReport: () => this.get<ApiResponse<UsageSummaryReport>>("/api/usage/summary"),
    };
  }

  private _buildBudget(): BudgetResource {
    return {
      listPolicies: () => this.get<ApiResponse<BudgetPolicyDto[]>>("/api/budget/policies"),
      createPolicy: (input) =>
        this.post<ApiResponse<BudgetPolicyDto>>("/api/budget/policies", input),
      updatePolicy: (id, input) =>
        this.patch<ApiResponse<BudgetPolicyDto>>(`/api/budget/policies/${id}`, input),
      deletePolicy: (id) =>
        this.delete<ApiResponse<{ id: string; deleted: boolean }>>(`/api/budget/policies/${id}`),
      status: () => this.get<ApiResponse<BudgetStatusDto[]>>("/api/budget/status"),
    };
  }

  private _buildEngagementGates(): EngagementGatesResource {
    return {
      list: (params) =>
        this.get<ApiResponse<EngagementGateDto[]>>(
          "/api/engagement-gates",
          params as Record<string, string | number | boolean | undefined>,
        ),
      get: (id) => this.get<ApiResponse<EngagementGateDto>>(`/api/engagement-gates/${id}`),
      create: (input) => this.post<ApiResponse<EngagementGateDto>>("/api/engagement-gates", input),
      update: (id, input) =>
        this.patch<ApiResponse<EngagementGateDto>>(`/api/engagement-gates/${id}`, input),
      delete: (id) => this.delete<ApiResponse<{ success: boolean }>>(`/api/engagement-gates/${id}`),
      process: (input) =>
        this.post<ApiResponse<ProcessEngagementGateRepliesResultDto>>(
          "/api/engagement-gates/process",
          input ?? {},
        ),
      verify: (id, params) =>
        this.get<ApiResponse<VerifyEngagementGateResultDto>>(`/api/engagement-gates/${id}/verify`, {
          username: params.username,
        }),
      consumeDeliveryToken: (id, input) =>
        this.post<ApiResponse<ConsumeEngagementGateDeliveryTokenResultDto>>(
          `/api/engagement-gates/${id}/deliveries/consume`,
          input,
        ),
    };
  }

  private _buildFollowers(): FollowersResource {
    return {
      list: (params) =>
        this.get<OffsetApiResponse<FollowerDto[]>>(
          "/api/followers",
          params as Record<string, string | number | boolean | undefined>,
        ),
      sync: (input) => this.post<ApiResponse<SyncFollowersResultDto>>("/api/followers/sync", input),
      attachTag: (followerId, tagId, input) =>
        this.post<ApiResponse<{ success: boolean }>>(
          `/api/followers/${followerId}/tags/${tagId}`,
          input,
        ),
      detachTag: (followerId, tagId, input) =>
        this.request<ApiResponse<{ success: boolean }>>(
          "DELETE",
          `/api/followers/${followerId}/tags/${tagId}`,
          { body: input },
        ),
    };
  }

  private _buildTags(): TagsResource {
    return {
      list: (params) =>
        this.get<ApiResponse<TagDto[]>>(
          "/api/tags",
          params as Record<string, string | number | boolean | undefined>,
        ),
      create: (input) => this.post<ApiResponse<TagDto>>("/api/tags", input),
      update: (id, input) => this.patch<ApiResponse<TagDto>>(`/api/tags/${id}`, input),
      delete: (id) => this.delete<ApiResponse<{ success: boolean }>>(`/api/tags/${id}`),
    };
  }

  private _buildFollowerAnalytics(): FollowerAnalyticsResource {
    return {
      get: (params) =>
        this.get<ApiResponse<FollowerAnalyticsResultDto>>("/api/analytics/followers", {
          socialAccountId: params.socialAccountId,
          asOfDate: params.asOfDate,
        }),
      captureSnapshot: (input) =>
        this.post<
          ApiResponse<
            CaptureFollowerSnapshotResultDto | CaptureFollowerSnapshotsForWorkspaceResultDto
          >
        >("/api/analytics/followers/snapshot", input ?? {}),
    };
  }

  private _buildCampaigns(): CampaignsResource {
    return {
      list: () => this.get<ApiResponse<CampaignListItemDto[]>>("/api/campaigns"),
      create: (input) => this.post<ApiResponse<CampaignRecordDto>>("/api/campaigns", input),
    };
  }

  private _buildQuoteTweets(): QuoteTweetsResource {
    return {
      list: (params) =>
        this.get<ApiResponse<QuoteTweetDto[]>>(
          "/api/quote-tweets",
          params as Record<string, string | number | boolean | undefined>,
        ),
      sync: (input) =>
        this.post<ApiResponse<SyncQuoteTweetsResultDto>>("/api/quote-tweets/sync", input),
      get: (id) => this.get<ApiResponse<QuoteTweetDto>>(`/api/quote-tweets/${id}`),
      action: (id, input) =>
        this.post<ApiResponse<QuoteTweetActionResultDto>>(`/api/quote-tweets/${id}/actions`, input),
    };
  }

  private _buildStepSequences(): StepSequencesResource {
    return {
      list: (params) =>
        this.get<ApiResponse<StepSequenceDto[]>>(
          "/api/step-sequences",
          params as Record<string, string | number | boolean | undefined>,
        ),
      create: (input) => this.post<ApiResponse<StepSequenceDto>>("/api/step-sequences", input),
      enroll: (sequenceId, input) =>
        this.post<ApiResponse<StepSequenceEnrollmentDto>>(
          `/api/step-sequences/${sequenceId}/enrollments`,
          input,
        ),
    };
  }

  private _buildAgent(): AgentResource {
    return {
      chat: (input) => this.post<ApiResponse<AgentChatResponse>>("/api/agent/chat", input),
      execute: (input) => this.post<ApiResponse<AgentExecuteResponse>>("/api/agent/execute", input),
      history: (params) =>
        this.get<ApiResponse<AgentHistoryEntry[]>>(
          "/api/agent/history",
          params as Record<string, string | number | boolean | undefined>,
        ),
    };
  }
}
