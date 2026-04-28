/**
 * X API v2 向け薄い HTTP クライアント
 *
 * - fetch ベース
 * - レート制限ヘッダ (x-rate-limit-*) を解析して返す
 * - HTTP エラー / 非 2xx レスポンスを ProviderError / RateLimitError に変換する
 *
 * design.md セクション 9 (エラーハンドリング) に準拠。
 */
import { ProviderError, RateLimitError } from "@sns-agent/core";

/** X API の基底 URL */
export const X_API_BASE_URL = "https://api.twitter.com";
/** X OAuth 2.0 の基底 URL */
export const X_OAUTH_BASE_URL = "https://twitter.com/i/oauth2";
/** X トークンエンドポイント */
export const X_TOKEN_URL = "https://api.twitter.com/2/oauth2/token";

/** レート制限情報 */
export interface RateLimitInfo {
  /** 残リクエスト数 */
  remaining: number | null;
  /** 最大リクエスト数 */
  limit: number | null;
  /** リセット時刻 (unix epoch sec) */
  resetAt: number | null;
}

/** Retry-After ヘッダから読める再試行目安 */
export interface RetryInfo {
  /** 秒数形式、または HTTP date との差分を秒に丸めた値 */
  retryAfterSeconds: number | null;
  /** HTTP date 形式で指定されていた場合の unix epoch ms */
  retryAt: number | null;
}

/** HTTP レスポンスとレート制限メタデータ */
export interface XApiResponse<T> {
  data: T;
  rateLimit: RateLimitInfo;
  status: number;
}

export interface XApiRequestOptions {
  method: "GET" | "POST" | "DELETE" | "PATCH" | "PUT";
  path: string;
  /** Bearer アクセストークン */
  accessToken?: string;
  /** クエリ文字列 */
  query?: Record<string, string | number | boolean | undefined>;
  /** JSON ボディ。Content-Type: application/json で送信される */
  json?: unknown;
  /** application/x-www-form-urlencoded 形式のボディ。OAuth トークン交換等で使用 */
  form?: Record<string, string>;
  /** multipart/form-data。media upload で使用 */
  formData?: FormData;
  /** 追加ヘッダ */
  headers?: Record<string, string>;
}

/**
 * fetch をラップして X API を呼ぶ。呼び出し元が差し替え可能。
 * テストでは globalThis.fetch をモックするか、または
 * XApiClient の fetchImpl を差し替える。
 */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export class XApiClient {
  private readonly fetchImpl: FetchLike;
  private readonly baseUrl: string;

  constructor(options: { baseUrl?: string; fetchImpl?: FetchLike } = {}) {
    this.baseUrl = options.baseUrl ?? X_API_BASE_URL;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  async request<T>(opts: XApiRequestOptions): Promise<XApiResponse<T>> {
    const rawUrl = opts.path.startsWith("http") ? opts.path : `${this.baseUrl}${opts.path}`;
    const url = buildUrl(rawUrl, opts.query);
    const headers: Record<string, string> = { ...opts.headers };

    if (opts.accessToken) {
      headers["Authorization"] = `Bearer ${opts.accessToken}`;
    }

    let body: string | FormData | undefined;
    if (opts.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.json);
    } else if (opts.form !== undefined) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      body = new URLSearchParams(opts.form).toString();
    } else if (opts.formData !== undefined) {
      body = opts.formData;
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: opts.method,
        headers,
        body,
      });
    } catch (err) {
      throw new ProviderError(`X API request failed: ${(err as Error).message}`, {
        cause: String(err),
        path: opts.path,
      });
    }

    const rateLimit = parseRateLimit(response.headers);
    const retryInfo = parseRetryInfo(response.headers);

    // 204 No Content は deletePost 等で発生
    if (response.status === 204) {
      return { data: undefined as unknown as T, rateLimit, status: 204 };
    }

    let parsed: unknown = null;
    const text = await response.text();
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        // JSON でないレスポンスはそのまま text を返す
        parsed = text;
      }
    }

    if (!response.ok) {
      const message = extractErrorMessage(parsed) ?? `X API ${response.status}`;
      const details = {
        status: response.status,
        path: opts.path,
        body: parsed,
        rateLimit,
        retryAfterSeconds: retryInfo.retryAfterSeconds,
        retryAt: retryInfo.retryAt,
      };

      if (response.status === 429) {
        throw new RateLimitError(message, details);
      }
      throw new ProviderError(message, details);
    }

    return { data: parsed as T, rateLimit, status: response.status };
  }
}

// ───────────────────────────────────────────
// ヘルパー
// ───────────────────────────────────────────

function parseRateLimit(headers: Headers): RateLimitInfo {
  const remaining = headers.get("x-rate-limit-remaining");
  const limit = headers.get("x-rate-limit-limit");
  const reset = headers.get("x-rate-limit-reset");
  return {
    remaining: remaining != null ? Number(remaining) : null,
    limit: limit != null ? Number(limit) : null,
    resetAt: reset != null ? Number(reset) : null,
  };
}

function parseRetryInfo(headers: Headers): RetryInfo {
  const raw = headers.get("retry-after");
  if (!raw) {
    return { retryAfterSeconds: null, retryAt: null };
  }

  const seconds = Number(raw);
  if (Number.isFinite(seconds)) {
    return { retryAfterSeconds: seconds, retryAt: null };
  }

  const retryAt = Date.parse(raw);
  if (Number.isNaN(retryAt)) {
    return { retryAfterSeconds: null, retryAt: null };
  }

  return {
    retryAfterSeconds: Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)),
    retryAt,
  };
}

function extractErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const obj = body as Record<string, unknown>;

  // X API v2 のエラー形式: { title, detail, errors: [...] }
  if (typeof obj.detail === "string") return obj.detail;
  if (typeof obj.title === "string") return obj.title;
  if (typeof obj.error_description === "string") return obj.error_description;
  if (typeof obj.error === "string") return obj.error;

  if (Array.isArray(obj.errors) && obj.errors.length > 0) {
    const first = obj.errors[0] as Record<string, unknown>;
    if (typeof first.message === "string") return first.message;
    if (typeof first.detail === "string") return first.detail;
  }
  return null;
}

function buildUrl(
  rawUrl: string,
  query?: Record<string, string | number | boolean | undefined>,
): string {
  if (!query) return rawUrl;

  const url = new URL(rawUrl);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}
