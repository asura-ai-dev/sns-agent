/**
 * X (Twitter) OAuth 2.0 PKCE 認証
 *
 * design.md セクション 1.7 (Provider OAuth 更新) に準拠。
 * X は OAuth 2.0 PKCE + refresh_token による自動更新を採用する。
 *
 * フロー:
 * 1. generatePkcePair() で code_verifier / code_challenge を生成
 * 2. getAuthUrl(redirectUri, state, challenge) で認可 URL を返し、ユーザーを遷移させる
 * 3. コールバックで受け取った code を exchangeCode(code, verifier, redirectUri) で
 *    access_token + refresh_token に交換
 * 4. 期限切れ時は refreshToken(refreshToken) でリフレッシュ
 */
import { createHash, randomBytes } from "node:crypto";
import { ProviderError } from "@sns-agent/core";
import { XApiClient, X_OAUTH_BASE_URL, X_TOKEN_URL } from "./http-client.js";

/** X OAuth 2.0 で要求するスコープ */
export const X_DEFAULT_SCOPES = [
  "tweet.read",
  "tweet.write",
  "users.read",
  "offline.access",
  "dm.read",
  "dm.write",
];

export interface XOAuthConfig {
  clientId: string;
  /** PKCE + confidential client の場合に必要 */
  clientSecret?: string;
  scopes?: string[];
}

export interface PkcePair {
  codeVerifier: string;
  codeChallenge: string;
  /** PKCE 仕様で固定: "S256" */
  codeChallengeMethod: "S256";
}

export interface TokenResult {
  accessToken: string;
  refreshToken: string | null;
  /** 期限 (Date)。X の expires_in は秒 */
  expiresAt: Date | null;
  tokenType: string;
  scope: string | null;
}

/**
 * PKCE の code_verifier / code_challenge を生成する。
 * RFC 7636 準拠: verifier は 43-128 文字の [A-Z, a-z, 0-9, -._~]
 */
export function generatePkcePair(): PkcePair {
  // 32 bytes -> base64url で約 43 文字
  const verifierBytes = randomBytes(32);
  const codeVerifier = base64UrlEncode(verifierBytes);
  const challengeBytes = createHash("sha256").update(codeVerifier).digest();
  const codeChallenge = base64UrlEncode(challengeBytes);
  return { codeVerifier, codeChallenge, codeChallengeMethod: "S256" };
}

/**
 * 認可 URL を生成する。
 * state は CSRF 対策。呼び出し側で管理・検証する。
 */
export function getAuthUrl(
  config: XOAuthConfig,
  params: {
    redirectUri: string;
    state: string;
    codeChallenge: string;
  },
): string {
  const scopes = config.scopes ?? X_DEFAULT_SCOPES;
  const query = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: params.redirectUri,
    scope: scopes.join(" "),
    state: params.state,
    code_challenge: params.codeChallenge,
    code_challenge_method: "S256",
  });
  return `${X_OAUTH_BASE_URL}/authorize?${query.toString()}`;
}

/**
 * 認可コードを access_token / refresh_token に交換する。
 */
export async function exchangeCode(
  config: XOAuthConfig,
  params: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  },
  httpClient: XApiClient,
): Promise<TokenResult> {
  const form: Record<string, string> = {
    code: params.code,
    grant_type: "authorization_code",
    client_id: config.clientId,
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier,
  };

  const headers: Record<string, string> = {};
  if (config.clientSecret) {
    // Confidential client の場合 Basic 認証を付与する
    headers["Authorization"] = `Basic ${Buffer.from(
      `${config.clientId}:${config.clientSecret}`,
    ).toString("base64")}`;
  }

  const res = await httpClient.request<RawTokenResponse>({
    method: "POST",
    path: X_TOKEN_URL,
    form,
    headers,
  });
  return parseTokenResponse(res.data);
}

/**
 * refresh_token を使って access_token を更新する。
 */
export async function refreshToken(
  config: XOAuthConfig,
  refreshTokenValue: string,
  httpClient: XApiClient,
): Promise<TokenResult> {
  const form: Record<string, string> = {
    refresh_token: refreshTokenValue,
    grant_type: "refresh_token",
    client_id: config.clientId,
  };

  const headers: Record<string, string> = {};
  if (config.clientSecret) {
    headers["Authorization"] = `Basic ${Buffer.from(
      `${config.clientId}:${config.clientSecret}`,
    ).toString("base64")}`;
  }

  const res = await httpClient.request<RawTokenResponse>({
    method: "POST",
    path: X_TOKEN_URL,
    form,
    headers,
  });
  return parseTokenResponse(res.data);
}

// ───────────────────────────────────────────
// 内部ヘルパー
// ───────────────────────────────────────────

interface RawTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
}

function parseTokenResponse(raw: RawTokenResponse): TokenResult {
  if (!raw.access_token) {
    throw new ProviderError("X OAuth: access_token missing in response", { raw });
  }
  const expiresAt =
    typeof raw.expires_in === "number" ? new Date(Date.now() + raw.expires_in * 1000) : null;
  return {
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token ?? null,
    expiresAt,
    tokenType: raw.token_type ?? "bearer",
    scope: raw.scope ?? null,
  };
}

function base64UrlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
