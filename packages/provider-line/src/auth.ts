/**
 * LINE Channel Access Token v2.1 (JWT)
 *
 * LINE Developers Console で Assertion Signing Key (JWK / RSA) を発行し、
 * それで署名した JWT を client_assertion として提示することで、
 * 長期 (最大 30 日) の Channel Access Token を取得する。
 *
 * フロー:
 *   1. Console で RSA 鍵ペアを登録し、kid を得る
 *   2. 本モジュールの `issueChannelAccessToken` で JWT を組み立て → /oauth2/v2.1/token に POST
 *   3. レスポンスの access_token を以降の Messaging API リクエストで使用
 *
 * ※ v1 では「呼び出し側が private key (PKCS#8 PEM) を ENV / シークレットストアから渡す」前提。
 * JWK → PEM 変換は利用者側で済ませた状態でこの関数を呼ぶ。
 *
 * design.md セクション 1.7 (provider OAuth): LINE は長期トークン (期限管理のみ) で運用する。
 */
import { createSign } from "node:crypto";
import { ProviderError } from "@sns-agent/core";
import { LineApiClient, LINE_TOKEN_URL, LINE_REVOKE_URL } from "./http-client.js";

export interface LineOAuthConfig {
  /** LINE Developers Console の Channel ID */
  channelId: string;
  /** Assertion signing key の kid */
  assertionKid: string;
  /** Assertion signing key (PKCS#8 PEM 形式の秘密鍵) */
  assertionPrivateKeyPem: string;
  /**
   * Channel Secret (Webhook 署名検証で使用)。
   * トークン発行には不要だが 1 config にまとめると利用側が便利。
   */
  channelSecret?: string;
  /**
   * トークンの有効期間 (秒)。
   * LINE 仕様上は 30 日 (2592000 秒) が上限。デフォルトは 30 日。
   */
  tokenTtlSeconds?: number;
}

export interface LineTokenResult {
  accessToken: string;
  /** 期限 (Date)。LINE の expires_in は秒 */
  expiresAt: Date | null;
  tokenType: string;
  /** v2.1 発行トークンの kid (失効時に指定が必要) */
  keyId: string | null;
}

/** LINE の JWT 仕様上の最大 TTL (30 日) */
export const LINE_TOKEN_MAX_TTL_SECONDS = 60 * 60 * 24 * 30;
/** デフォルト TTL (30 日) */
export const LINE_TOKEN_DEFAULT_TTL_SECONDS = LINE_TOKEN_MAX_TTL_SECONDS;

/**
 * Channel Access Token v2.1 を取得する。
 *
 * 内部的には RS256 で署名した JWT を作り、
 * client_assertion として /oauth2/v2.1/token に POST する。
 */
export async function issueChannelAccessToken(
  config: LineOAuthConfig,
  httpClient: LineApiClient,
  now: Date = new Date(),
): Promise<LineTokenResult> {
  const ttl = Math.min(
    config.tokenTtlSeconds ?? LINE_TOKEN_DEFAULT_TTL_SECONDS,
    LINE_TOKEN_MAX_TTL_SECONDS,
  );

  const jwt = signAssertionJwt(
    {
      iss: config.channelId,
      sub: config.channelId,
      aud: "https://api.line.me/",
      // exp は token_exp と別。JWT 自体は 30 分以内とする。
      exp: Math.floor(now.getTime() / 1000) + 30 * 60,
      // Channel Access Token の有効期限を秒数で指定
      token_exp: ttl,
    },
    {
      kid: config.assertionKid,
      privateKeyPem: config.assertionPrivateKeyPem,
    },
  );

  const form: Record<string, string> = {
    grant_type: "client_credentials",
    client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: jwt,
  };

  const res = await httpClient.request<RawTokenResponse>({
    method: "POST",
    path: LINE_TOKEN_URL,
    form,
  });
  return parseTokenResponse(res.data);
}

/**
 * Channel Access Token v2.1 を失効させる。
 * 無効になったトークンを明示的に revoke したい場合に使用する。
 */
export async function revokeChannelAccessToken(
  config: LineOAuthConfig,
  accessToken: string,
  httpClient: LineApiClient,
): Promise<void> {
  await httpClient.request<unknown>({
    method: "POST",
    path: LINE_REVOKE_URL,
    form: {
      client_id: config.channelId,
      access_token: accessToken,
    },
  });
}

// ───────────────────────────────────────────
// JWT 署名 (RS256)
// ───────────────────────────────────────────

interface JwtPayload {
  iss: string;
  sub: string;
  aud: string;
  exp: number;
  token_exp: number;
}

interface JwtSignOptions {
  kid: string;
  privateKeyPem: string;
}

export function signAssertionJwt(payload: JwtPayload, opts: JwtSignOptions): string {
  const header = {
    alg: "RS256",
    typ: "JWT",
    kid: opts.kid,
  };
  const encodedHeader = base64UrlEncode(Buffer.from(JSON.stringify(header), "utf8"));
  const encodedPayload = base64UrlEncode(Buffer.from(JSON.stringify(payload), "utf8"));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  let signature: Buffer;
  try {
    const signer = createSign("RSA-SHA256");
    signer.update(signingInput);
    signer.end();
    signature = signer.sign(opts.privateKeyPem);
  } catch (err) {
    throw new ProviderError(`LINE JWT sign failed: ${(err as Error).message}`, {
      cause: String(err),
    });
  }

  return `${signingInput}.${base64UrlEncode(signature)}`;
}

// ───────────────────────────────────────────
// 内部ヘルパー
// ───────────────────────────────────────────

interface RawTokenResponse {
  access_token?: string;
  expires_in?: number;
  token_type?: string;
  key_id?: string;
}

function parseTokenResponse(raw: RawTokenResponse): LineTokenResult {
  if (!raw.access_token) {
    throw new ProviderError("LINE OAuth: access_token missing in response", { raw });
  }
  const expiresAt =
    typeof raw.expires_in === "number" ? new Date(Date.now() + raw.expires_in * 1000) : null;
  return {
    accessToken: raw.access_token,
    expiresAt,
    tokenType: raw.token_type ?? "Bearer",
    keyId: raw.key_id ?? null,
  };
}

function base64UrlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
