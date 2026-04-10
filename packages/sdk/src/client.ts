/**
 * SnsAgentClient - fetch ベースの HTTP クライアント
 *
 * CLI と Web UI が共通利用する API クライアント SDK。
 * Authorization / Content-Type / X-Idempotency-Key ヘッダを自動付与し、
 * エラーレスポンスを SdkError に変換する。
 */

import { SdkError } from "./errors.js";
import type {
  ApiResponse,
  ConnectAccountInput,
  CreatePostInput,
  CreateScheduleInput,
  ListPostsParams,
  ListSchedulesParams,
  UpdatePostInput,
  UpdateScheduleInput,
  UsageReportParams,
  UsageSummary,
  SocialAccount,
  Post,
  ScheduledJob,
  UsageRecord,
} from "./types.js";

// ───────────────────────────────────────────
// クライアント設定
// ───────────────────────────────────────────

export interface SnsAgentClientOptions {
  /** API のベース URL (例: http://localhost:3001) */
  baseUrl: string;
  /** API キー (Authorization: Bearer <apiKey>) */
  apiKey: string;
  /** カスタム fetch 実装（テスト用） */
  fetch?: typeof globalThis.fetch;
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
  cancel(id: string): Promise<ApiResponse<{ success: boolean }>>;
}

export interface UsageResource {
  report(params?: UsageReportParams): Promise<ApiResponse<UsageRecord[]>>;
  summary(): Promise<ApiResponse<UsageSummary>>;
}

// ───────────────────────────────────────────
// SnsAgentClient
// ───────────────────────────────────────────

export class SnsAgentClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly _fetch: typeof globalThis.fetch;

  public readonly accounts: AccountsResource;
  public readonly posts: PostsResource;
  public readonly schedules: SchedulesResource;
  public readonly usage: UsageResource;

  constructor(options: SnsAgentClientOptions) {
    // 末尾のスラッシュを除去
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this._fetch = options.fetch ?? globalThis.fetch.bind(globalThis);

    // リソース別メソッドをバインド
    this.accounts = this._buildAccounts();
    this.posts = this._buildPosts();
    this.schedules = this._buildSchedules();
    this.usage = this._buildUsage();
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

  // ───────────────────────────────────────
  // 内部ヘルパー
  // ───────────────────────────────────────

  private _headers(opts?: { idempotency?: boolean }): Record<string, string> {
    const h: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
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
      create: (input) => this.post<ApiResponse<Post>>("/api/posts", input),
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
      cancel: (id) => this.delete<ApiResponse<{ success: boolean }>>(`/api/schedules/${id}`),
    };
  }

  private _buildUsage(): UsageResource {
    return {
      report: (params) =>
        this.get<ApiResponse<UsageRecord[]>>(
          "/api/usage",
          params as Record<string, string | number | boolean | undefined>,
        ),
      summary: () => this.get<ApiResponse<UsageSummary>>("/api/usage/summary"),
    };
  }
}
