/**
 * Instagram Graph API OAuth (Facebook Login 経由)
 *
 * design.md セクション 1.7 (Provider OAuth 更新) に準拠。
 * Instagram Business / Creator アカウントは Facebook Login 経由で接続し、
 * long-lived token (60 日) を発行する。期限切れ前に "refresh" エンドポイントで延長する。
 *
 * フロー:
 * 1. getAuthUrl(...) で Facebook の dialog/oauth に誘導
 * 2. コールバック code を exchangeCode で short-lived user access token に交換
 * 3. exchangeForLongLivedToken で 60 日 token に昇格
 * 4. 期限切れ前に refreshLongLivedToken で延長
 *
 * IG Business Account ID は、Facebook Page に紐づく instagram_business_account.id を
 * /me/accounts から解決する (fetchInstagramBusinessAccount)。
 */
import { ProviderError } from "@sns-agent/core";
import {
  InstagramApiClient,
  INSTAGRAM_OAUTH_AUTHORIZE_URL,
  INSTAGRAM_TOKEN_URL,
} from "./http-client.js";

/**
 * Instagram (Facebook Login) で要求するスコープ。
 * 投稿 / DM / コメント / 管理に必要なものを列挙する。
 */
export const INSTAGRAM_DEFAULT_SCOPES = [
  "instagram_basic",
  "instagram_content_publish",
  "instagram_manage_comments",
  "instagram_manage_messages",
  "pages_show_list",
  "pages_read_engagement",
  "business_management",
];

export interface InstagramOAuthConfig {
  /** Facebook App ID (= client_id) */
  clientId: string;
  /** Facebook App Secret */
  clientSecret: string;
  scopes?: string[];
}

export interface InstagramTokenResult {
  accessToken: string;
  /** 期限 (Date)。long-lived token は約 60 日 */
  expiresAt: Date | null;
  tokenType: string;
  /** Instagram は refresh_token を返さない (long-lived token 自体を使い回し、refresh endpoint で延長) */
  refreshToken: null;
}

/**
 * 認可 URL を生成する。
 * state は CSRF 対策として呼び出し側で管理する。
 */
export function getAuthUrl(
  config: InstagramOAuthConfig,
  params: {
    redirectUri: string;
    state: string;
  },
): string {
  const scopes = config.scopes ?? INSTAGRAM_DEFAULT_SCOPES;
  const query = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: params.redirectUri,
    scope: scopes.join(","),
    state: params.state,
  });
  return `${INSTAGRAM_OAUTH_AUTHORIZE_URL}?${query.toString()}`;
}

/**
 * 認可コードを short-lived user access token に交換する。
 * Facebook Graph API の /oauth/access_token を呼ぶ。
 */
export async function exchangeCode(
  config: InstagramOAuthConfig,
  params: {
    code: string;
    redirectUri: string;
  },
  httpClient: InstagramApiClient,
): Promise<InstagramTokenResult> {
  const res = await httpClient.request<RawTokenResponse>({
    method: "GET",
    path: INSTAGRAM_TOKEN_URL,
    query: {
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: params.redirectUri,
      code: params.code,
    },
  });
  return parseTokenResponse(res.data);
}

/**
 * short-lived token を long-lived token (60 日) に昇格する。
 * GET /oauth/access_token?grant_type=fb_exchange_token&fb_exchange_token=...
 */
export async function exchangeForLongLivedToken(
  config: InstagramOAuthConfig,
  shortLivedToken: string,
  httpClient: InstagramApiClient,
): Promise<InstagramTokenResult> {
  const res = await httpClient.request<RawTokenResponse>({
    method: "GET",
    path: INSTAGRAM_TOKEN_URL,
    query: {
      grant_type: "fb_exchange_token",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      fb_exchange_token: shortLivedToken,
    },
  });
  return parseTokenResponse(res.data);
}

/**
 * long-lived token を延長する。
 * Instagram Graph API の /refresh_access_token は IG user access token 専用。
 * Facebook Login 経由の場合は exchangeForLongLivedToken を再呼び出しして延長する。
 */
export async function refreshLongLivedToken(
  config: InstagramOAuthConfig,
  longLivedToken: string,
  httpClient: InstagramApiClient,
): Promise<InstagramTokenResult> {
  // Facebook long-lived user token は fb_exchange_token で再延長可能
  return exchangeForLongLivedToken(config, longLivedToken, httpClient);
}

/**
 * /me/accounts を叩いて、管理している Facebook Page に紐づく Instagram Business Account ID
 * と表示名を取得する。v1 は最初に見つかった IG アカウントを使う。
 */
export async function fetchInstagramBusinessAccount(
  accessToken: string,
  httpClient: InstagramApiClient,
): Promise<{ igUserId: string; username: string | null; pageAccessToken: string | null }> {
  const res = await httpClient.request<{
    data?: Array<{
      id: string;
      name?: string;
      access_token?: string;
      instagram_business_account?: { id: string };
    }>;
  }>({
    method: "GET",
    path: "/me/accounts",
    accessToken,
    query: { fields: "id,name,access_token,instagram_business_account" },
  });

  const pages = res.data?.data ?? [];
  const pageWithIg = pages.find((p) => p.instagram_business_account?.id);
  if (!pageWithIg?.instagram_business_account?.id) {
    throw new ProviderError(
      "Instagram: no instagram_business_account found on any managed Facebook Page",
      { pages: pages.map((p) => ({ id: p.id, hasIg: Boolean(p.instagram_business_account) })) },
    );
  }

  const igUserId = pageWithIg.instagram_business_account.id;
  const pageAccessToken = pageWithIg.access_token ?? null;

  // IG ユーザー名を取得
  let username: string | null = null;
  try {
    const meRes = await httpClient.request<{ id?: string; username?: string }>({
      method: "GET",
      path: `/${encodeURIComponent(igUserId)}`,
      accessToken: pageAccessToken ?? accessToken,
      query: { fields: "id,username" },
    });
    username = meRes.data?.username ?? null;
  } catch {
    // username 取得失敗は致命的ではない
  }

  return { igUserId, username, pageAccessToken };
}

// ───────────────────────────────────────────
// 内部
// ───────────────────────────────────────────

interface RawTokenResponse {
  access_token?: string;
  expires_in?: number;
  token_type?: string;
}

function parseTokenResponse(raw: RawTokenResponse): InstagramTokenResult {
  if (!raw.access_token) {
    throw new ProviderError("Instagram OAuth: access_token missing in response", { raw });
  }
  const expiresAt =
    typeof raw.expires_in === "number" ? new Date(Date.now() + raw.expires_in * 1000) : null;
  return {
    accessToken: raw.access_token,
    refreshToken: null,
    expiresAt,
    tokenType: raw.token_type ?? "bearer",
  };
}
