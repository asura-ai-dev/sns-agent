/**
 * Instagram Graph API 向け薄い HTTP クライアント
 *
 * - fetch ベース
 * - Instagram Graph API (Facebook Graph API) を呼ぶ
 * - Meta の X-App-Usage / X-Business-Use-Case-Usage ヘッダを解析してレート制限情報を返す
 * - HTTP エラー / 非 2xx レスポンスを ProviderError / RateLimitError に変換する
 *
 * design.md セクション 9 (エラーハンドリング) に準拠。
 */
import { ProviderError, RateLimitError } from "@sns-agent/core";

/** Instagram Graph API (Facebook Graph API) の基底 URL */
export const INSTAGRAM_API_BASE_URL = "https://graph.facebook.com/v19.0";
/** Facebook OAuth 認可 URL */
export const INSTAGRAM_OAUTH_AUTHORIZE_URL = "https://www.facebook.com/v19.0/dialog/oauth";
/** アクセストークン交換 URL (short-lived) */
export const INSTAGRAM_TOKEN_URL = "https://graph.facebook.com/v19.0/oauth/access_token";

/**
 * Instagram (Meta) のレート制限情報。
 * X-App-Usage (app 単位) と X-Business-Use-Case-Usage (BUC, IG Business Account 単位) の両方を見る。
 */
export interface InstagramRateLimitInfo {
  /** アプリ使用率 (0-100)。X-App-Usage.call_count 等の最大値 */
  appUsagePercent: number | null;
  /** Business Use Case 使用率 (0-100)。最大値 */
  businessUsagePercent: number | null;
  /** 推定リセットまでの秒数 (X-Business-Use-Case-Usage.estimated_time_to_regain_access) */
  estimatedTimeToRegainAccessSec: number | null;
}

/** HTTP レスポンスとレート制限メタデータ */
export interface InstagramApiResponse<T> {
  data: T;
  rateLimit: InstagramRateLimitInfo;
  status: number;
}

export interface InstagramApiRequestOptions {
  method: "GET" | "POST" | "DELETE" | "PATCH" | "PUT";
  /** フル URL または `/...` のパス */
  path: string;
  /** Bearer アクセストークン */
  accessToken?: string;
  /** JSON ボディ */
  json?: unknown;
  /** application/x-www-form-urlencoded 形式 */
  form?: Record<string, string>;
  /** クエリパラメータ */
  query?: Record<string, string | number | undefined>;
  /** 追加ヘッダ */
  headers?: Record<string, string>;
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export class InstagramApiClient {
  private readonly fetchImpl: FetchLike;
  private readonly baseUrl: string;

  constructor(options: { baseUrl?: string; fetchImpl?: FetchLike } = {}) {
    this.baseUrl = options.baseUrl ?? INSTAGRAM_API_BASE_URL;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  async request<T>(opts: InstagramApiRequestOptions): Promise<InstagramApiResponse<T>> {
    let url = opts.path.startsWith("http") ? opts.path : `${this.baseUrl}${opts.path}`;

    // Instagram Graph API はクエリ経由で access_token を受け付けるパターンも多いが、
    // ここでは Authorization: Bearer を原則使う。query に明示指定がある場合はそちらを優先。
    if (opts.query) {
      const entries = Object.entries(opts.query).filter(([, v]) => v !== undefined);
      if (entries.length > 0) {
        const qs = new URLSearchParams();
        for (const [k, v] of entries) {
          qs.set(k, String(v));
        }
        url += (url.includes("?") ? "&" : "?") + qs.toString();
      }
    }

    const headers: Record<string, string> = { ...opts.headers };

    if (opts.accessToken) {
      headers["Authorization"] = `Bearer ${opts.accessToken}`;
    }

    let body: string | undefined;
    if (opts.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.json);
    } else if (opts.form !== undefined) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      body = new URLSearchParams(opts.form).toString();
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: opts.method,
        headers,
        body,
      });
    } catch (err) {
      throw new ProviderError(`Instagram API request failed: ${(err as Error).message}`, {
        cause: String(err),
        path: opts.path,
      });
    }

    const rateLimit = parseRateLimit(response.headers);

    // 204 No Content は削除等で発生しうる
    if (response.status === 204) {
      return { data: undefined as unknown as T, rateLimit, status: 204 };
    }

    let parsed: unknown = null;
    const text = await response.text();
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    if (!response.ok) {
      const message = extractErrorMessage(parsed) ?? `Instagram API ${response.status}`;
      const details = {
        status: response.status,
        path: opts.path,
        body: parsed,
        rateLimit,
      };

      if (response.status === 429) {
        throw new RateLimitError(message, details);
      }
      // Meta の rate limit は 4 (App rate limit) / 17 (User rate limit) / 32 (Page rate limit) /
      // 613 (Custom rate limit) を error.code に載せて 400 で返すことがある
      const code = extractErrorCode(parsed);
      if (code != null && [4, 17, 32, 613].includes(code)) {
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

/**
 * X-App-Usage: {"call_count":28,"total_cputime":25,"total_time":25}
 * X-Business-Use-Case-Usage: {"<biz_id>":[{"type":"instagram","call_count":10,"total_cputime":5,
 *   "total_time":5,"estimated_time_to_regain_access":0}]}
 */
function parseRateLimit(headers: Headers): InstagramRateLimitInfo {
  let appUsagePercent: number | null = null;
  let businessUsagePercent: number | null = null;
  let estimated: number | null = null;

  const appUsageRaw = headers.get("x-app-usage");
  if (appUsageRaw) {
    try {
      const parsed = JSON.parse(appUsageRaw) as Record<string, number>;
      const vals = Object.values(parsed).filter((v) => typeof v === "number");
      if (vals.length > 0) {
        appUsagePercent = Math.max(...vals);
      }
    } catch {
      // ignore parse errors
    }
  }

  const bucRaw = headers.get("x-business-use-case-usage");
  if (bucRaw) {
    try {
      const parsed = JSON.parse(bucRaw) as Record<string, Array<Record<string, number>>>;
      for (const entries of Object.values(parsed)) {
        if (!Array.isArray(entries)) continue;
        for (const entry of entries) {
          const usageFields = ["call_count", "total_cputime", "total_time"];
          for (const f of usageFields) {
            const v = entry[f];
            if (typeof v === "number") {
              businessUsagePercent = Math.max(businessUsagePercent ?? 0, v);
            }
          }
          const eta = entry["estimated_time_to_regain_access"];
          if (typeof eta === "number" && eta > 0) {
            estimated = Math.max(estimated ?? 0, eta);
          }
        }
      }
    } catch {
      // ignore
    }
  }

  return {
    appUsagePercent,
    businessUsagePercent,
    estimatedTimeToRegainAccessSec: estimated,
  };
}

function extractErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const obj = body as Record<string, unknown>;

  // Meta Graph API: { error: { message, type, code, error_subcode, fbtrace_id } }
  if (obj.error && typeof obj.error === "object") {
    const err = obj.error as Record<string, unknown>;
    if (typeof err.message === "string") return err.message;
    if (typeof err.type === "string") return err.type;
  }

  if (typeof obj.error_description === "string") return obj.error_description;
  if (typeof obj.message === "string") return obj.message;

  return null;
}

function extractErrorCode(body: unknown): number | null {
  if (!body || typeof body !== "object") return null;
  const obj = body as Record<string, unknown>;
  if (obj.error && typeof obj.error === "object") {
    const err = obj.error as Record<string, unknown>;
    if (typeof err.code === "number") return err.code;
  }
  return null;
}
