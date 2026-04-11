/**
 * @sns-agent/provider-instagram - Instagram プロバイダ
 *
 * Task 4002: SocialProvider インターフェースの Instagram 実装。
 *
 * design.md セクション 6 (Provider IF) / セクション 11 (投稿バリデーション) /
 * セクション 1.7 (long-lived token + refresh) に準拠。
 */
import type { Platform } from "@sns-agent/config";
import type {
  SocialProvider,
  ProviderCapabilities,
  ConnectAccountInput,
  ConnectAccountResult,
  ValidatePostInput,
  ValidationResult,
  PublishPostInput,
  PublishResult,
  DeletePostInput,
  DeleteResult,
  ListThreadsInput,
  ThreadListResult,
  GetMessagesInput,
  MessageListResult,
  WebhookInput,
  WebhookResult,
  RefreshResult,
} from "@sns-agent/core";
import { ProviderError } from "@sns-agent/core";
import { InstagramApiClient } from "./http-client.js";
import { INSTAGRAM_CAPABILITIES } from "./capabilities.js";
import {
  getAuthUrl,
  exchangeCode,
  exchangeForLongLivedToken,
  refreshLongLivedToken,
  fetchInstagramBusinessAccount,
  type InstagramOAuthConfig,
  type InstagramTokenResult,
} from "./auth.js";
import { validatePost, publishPost, deletePost } from "./post.js";
import { listThreads, getMessages } from "./inbox.js";
import { handleWebhook, type InstagramWebhookConfig } from "./webhook.js";

export interface InstagramProviderOptions {
  /** Instagram (Facebook Login) OAuth 設定 */
  oauth: InstagramOAuthConfig;
  /** Webhook 検証用の App Secret (未設定時は oauth.clientSecret を流用) */
  webhook?: InstagramWebhookConfig;
  /** HTTP クライアント (テスト差し替え用) */
  httpClient?: InstagramApiClient;
}

/**
 * Instagram プロバイダ実装
 */
export class InstagramProvider implements SocialProvider {
  readonly platform: Platform = "instagram";

  private readonly oauth: InstagramOAuthConfig;
  private readonly httpClient: InstagramApiClient;
  private readonly webhookConfig: InstagramWebhookConfig;

  constructor(options: InstagramProviderOptions) {
    this.oauth = options.oauth;
    this.httpClient = options.httpClient ?? new InstagramApiClient();
    this.webhookConfig = options.webhook ?? { appSecret: options.oauth.clientSecret };
  }

  getCapabilities(): ProviderCapabilities {
    return INSTAGRAM_CAPABILITIES;
  }

  /**
   * OAuth 接続フロー:
   * - authorizationCode が無い場合: state 付きで Facebook の認可 URL を返す
   * - authorizationCode がある場合:
   *     1) short-lived token に交換
   *     2) long-lived token (60 日) に昇格
   *     3) /me/accounts から IG Business Account を解決
   */
  async connectAccount(input: ConnectAccountInput): Promise<ConnectAccountResult> {
    if (!input.authorizationCode) {
      // Phase 1: 認可 URL を発行
      const state = input.state;
      if (!state) {
        throw new ProviderError("Instagram connectAccount: state is required to initiate OAuth");
      }
      const url = getAuthUrl(this.oauth, {
        redirectUri: input.redirectUrl,
        state,
      });
      return { authorizationUrl: url };
    }

    // Phase 2: コールバック
    const shortLived = await exchangeCode(
      this.oauth,
      { code: input.authorizationCode, redirectUri: input.redirectUrl },
      this.httpClient,
    );

    const longLived = await exchangeForLongLivedToken(
      this.oauth,
      shortLived.accessToken,
      this.httpClient,
    );

    const ig = await fetchInstagramBusinessAccount(longLived.accessToken, this.httpClient);

    const credentials = serializeCredentials(longLived, {
      igUserId: ig.igUserId,
      pageAccessToken: ig.pageAccessToken,
    });

    return {
      account: {
        externalAccountId: ig.igUserId,
        displayName: ig.username ?? ig.igUserId,
        credentialsEncrypted: credentials,
        tokenExpiresAt: longLived.expiresAt,
        capabilities: INSTAGRAM_CAPABILITIES,
      },
    };
  }

  async validatePost(input: ValidatePostInput): Promise<ValidationResult> {
    return validatePost(input);
  }

  async publishPost(input: PublishPostInput): Promise<PublishResult> {
    return publishPost(input, this.httpClient);
  }

  async deletePost(input: DeletePostInput): Promise<DeleteResult> {
    return deletePost(input, this.httpClient);
  }

  async listThreads(input: ListThreadsInput): Promise<ThreadListResult> {
    return listThreads(input, this.httpClient);
  }

  async getMessages(input: GetMessagesInput): Promise<MessageListResult> {
    return getMessages(input, this.httpClient);
  }

  async handleWebhook(input: WebhookInput): Promise<WebhookResult> {
    return handleWebhook(input, this.webhookConfig);
  }

  /**
   * トークンリフレッシュ (long-lived token の延長)
   *
   * provider-x と同様、引数は以下を許容する:
   * 1. credentials JSON 文字列 ({ accessToken, ... }) -> accessToken を延長対象とする
   * 2. plain string -> そのまま long-lived token として扱う
   */
  async refreshToken(accountIdOrCredentials: string): Promise<RefreshResult> {
    let longLivedToken: string | null = null;
    let parsedCreds: Record<string, unknown> | null = null;
    try {
      const parsed = JSON.parse(accountIdOrCredentials) as Record<string, unknown>;
      parsedCreds = parsed;
      if (typeof parsed.accessToken === "string") {
        longLivedToken = parsed.accessToken;
      }
    } catch {
      if (accountIdOrCredentials.length > 0 && !accountIdOrCredentials.includes(" ")) {
        longLivedToken = accountIdOrCredentials;
      }
    }

    if (!longLivedToken) {
      return {
        success: false,
        credentialsEncrypted: null,
        tokenExpiresAt: null,
        error: "access_token not found in credentials",
      };
    }

    try {
      const token = await refreshLongLivedToken(this.oauth, longLivedToken, this.httpClient);
      const igUserId =
        parsedCreds && typeof parsedCreds.igUserId === "string" ? parsedCreds.igUserId : "";
      const pageAccessToken =
        parsedCreds && typeof parsedCreds.pageAccessToken === "string"
          ? (parsedCreds.pageAccessToken as string)
          : null;
      return {
        success: true,
        credentialsEncrypted: serializeCredentials(token, { igUserId, pageAccessToken }),
        tokenExpiresAt: token.expiresAt,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        credentialsEncrypted: null,
        tokenExpiresAt: null,
        error: message,
      };
    }
  }
}

/** credentials JSON をシリアライズ (usecase 側で暗号化する) */
function serializeCredentials(
  token: InstagramTokenResult,
  extras: { igUserId: string; pageAccessToken: string | null },
): string {
  return JSON.stringify({
    accessToken: token.accessToken,
    refreshToken: null,
    expiresAt: token.expiresAt ? token.expiresAt.toISOString() : null,
    tokenType: token.tokenType,
    igUserId: extras.igUserId,
    pageAccessToken: extras.pageAccessToken,
  });
}

// ───────────────────────────────────────────
// 再エクスポート
// ───────────────────────────────────────────

export { INSTAGRAM_CAPABILITIES } from "./capabilities.js";
export {
  INSTAGRAM_TEXT_LIMIT,
  INSTAGRAM_MAX_IMAGES,
  INSTAGRAM_MAX_VIDEOS,
} from "./capabilities.js";
export { InstagramApiClient } from "./http-client.js";
export {
  getAuthUrl,
  exchangeCode,
  exchangeForLongLivedToken,
  refreshLongLivedToken,
  fetchInstagramBusinessAccount,
  INSTAGRAM_DEFAULT_SCOPES,
} from "./auth.js";
export type { InstagramOAuthConfig, InstagramTokenResult } from "./auth.js";
export { validatePost, publishPost, deletePost } from "./post.js";
export { listThreads, getMessages } from "./inbox.js";
export { handleWebhook, verifySignature } from "./webhook.js";
export type { InstagramWebhookConfig } from "./webhook.js";
