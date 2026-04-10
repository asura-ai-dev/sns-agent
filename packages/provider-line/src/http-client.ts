/**
 * LINE Messaging API 向け薄い HTTP クライアント
 *
 * - fetch ベース
 * - HTTP エラー / 非 2xx レスポンスを ProviderError / RateLimitError に変換する
 *
 * design.md セクション 9 (エラーハンドリング) に準拠。
 */
import { ProviderError, RateLimitError } from "@sns-agent/core";

/** LINE Messaging API の基底 URL */
export const LINE_API_BASE_URL = "https://api.line.me";
/** LINE data API (コンテンツダウンロード等) */
export const LINE_DATA_API_BASE_URL = "https://api-data.line.me";
/** LINE OAuth 2.1 トークンエンドポイント (Channel Access Token v2.1 / JWT 用) */
export const LINE_TOKEN_URL = "https://api.line.me/oauth2/v2.1/token";
/** LINE OAuth 2.1 トークン失効エンドポイント */
export const LINE_REVOKE_URL = "https://api.line.me/oauth2/v2.1/revoke";

export interface LineApiResponse<T> {
  data: T;
  status: number;
}

export interface LineApiRequestOptions {
  method: "GET" | "POST" | "DELETE" | "PATCH" | "PUT";
  path: string;
  /** Bearer アクセストークン (Channel Access Token) */
  accessToken?: string;
  /** JSON ボディ。Content-Type: application/json で送信される */
  json?: unknown;
  /** application/x-www-form-urlencoded 形式のボディ。OAuth トークン発行等で使用 */
  form?: Record<string, string>;
  /** 追加ヘッダ */
  headers?: Record<string, string>;
  /** 絶対 URL を使う場合に baseUrl を上書き */
  absoluteUrl?: string;
}

/** fetch をラップして LINE API を呼ぶ。呼び出し元が差し替え可能。 */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export class LineApiClient {
  private readonly fetchImpl: FetchLike;
  private readonly baseUrl: string;

  constructor(options: { baseUrl?: string; fetchImpl?: FetchLike } = {}) {
    this.baseUrl = options.baseUrl ?? LINE_API_BASE_URL;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  async request<T>(opts: LineApiRequestOptions): Promise<LineApiResponse<T>> {
    const url =
      opts.absoluteUrl ??
      (opts.path.startsWith("http") ? opts.path : `${this.baseUrl}${opts.path}`);
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
      throw new ProviderError(`LINE API request failed: ${(err as Error).message}`, {
        cause: String(err),
        path: opts.path,
      });
    }

    // 204 No Content / 200 with empty body は LINE Messaging API でよくある
    if (response.status === 204) {
      return { data: undefined as unknown as T, status: 204 };
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
      const message = extractErrorMessage(parsed) ?? `LINE API ${response.status}`;
      const details = {
        status: response.status,
        path: opts.path,
        body: parsed,
      };

      if (response.status === 429) {
        throw new RateLimitError(message, details);
      }
      throw new ProviderError(message, details);
    }

    return { data: parsed as T, status: response.status };
  }
}

// ───────────────────────────────────────────
// ヘルパー
// ───────────────────────────────────────────

function extractErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const obj = body as Record<string, unknown>;

  // LINE Messaging API のエラー形式:
  // { message: "...", details: [{ message, property }] }
  if (typeof obj.message === "string") return obj.message;
  if (typeof obj.error_description === "string") return obj.error_description;
  if (typeof obj.error === "string") return obj.error;

  if (Array.isArray(obj.details) && obj.details.length > 0) {
    const first = obj.details[0] as Record<string, unknown>;
    if (typeof first.message === "string") return first.message;
  }
  return null;
}
