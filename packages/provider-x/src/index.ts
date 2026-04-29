/**
 * @sns-agent/provider-x - X (Twitter) プロバイダ
 *
 * Task 2003: SocialProvider インターフェースの X 実装。
 *
 * design.md セクション 6 (Provider IF) / セクション 11 (投稿バリデーション) /
 * セクション 1.7 (OAuth 2.0 PKCE + refresh_token) に準拠。
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
  SendReplyInput,
  SendReplyResult,
  ListFollowersInput,
  FollowerListResult,
  RefreshResult,
  ListEngagementRepliesInput,
  EngagementReplyListResult,
  CheckEngagementConditionsInput,
  EngagementConditionResult,
  PerformEngagementActionInput,
  EngagementActionResult,
  ListQuoteTweetsInput,
  QuoteTweetListResult,
} from "@sns-agent/core";
import { ProviderError } from "@sns-agent/core";
import { XApiClient } from "./http-client.js";
import { X_CAPABILITIES } from "./capabilities.js";
import {
  generatePkcePair,
  getAuthUrl,
  exchangeCode,
  refreshToken as refreshOAuthToken,
  type XOAuthConfig,
} from "./auth.js";
import { extractXRefreshToken, serializeXOAuth2Credentials } from "./credentials.js";
import { validatePost, publishPost, deletePost } from "./post.js";
import { listThreads, getMessages, sendReply as sendReplyImpl } from "./inbox.js";
import { listFollowers, listFollowing } from "./followers.js";
import {
  checkEngagementConditions as checkEngagementConditionsImpl,
  listEngagementReplies as listEngagementRepliesImpl,
} from "./engagement-gates.js";
import { performEngagementAction as performEngagementActionImpl } from "./engagement-actions.js";
import { listQuoteTweets as listQuoteTweetsImpl } from "./quote-tweets.js";

export interface XProviderOptions {
  /** X OAuth 2.0 クライアント設定 */
  oauth: XOAuthConfig;
  /** HTTP クライアント (テスト差し替え用) */
  httpClient?: XApiClient;
  /** Premium プランか (テキスト上限に影響) */
  premium?: boolean;
  /**
   * PKCE の code_verifier を state と紐づけて永続化するためのストレージ。
   * v1 は in-memory のデフォルト実装を用意するが、apps/api では session / DB に差し替える想定。
   */
  verifierStore?: VerifierStore;
}

/**
 * code_verifier を state に紐づけて保存する抽象。
 * OAuth 開始時に put、コールバック時に take（取得と同時に削除）。
 */
export interface VerifierStore {
  put(state: string, verifier: string): Promise<void>;
  take(state: string): Promise<string | null>;
}

/** デフォルト実装 (in-memory)。単一プロセスのローカル開発用 */
class InMemoryVerifierStore implements VerifierStore {
  private readonly store = new Map<string, { verifier: string; expiresAt: number }>();
  private readonly ttlMs: number;

  constructor(ttlMs = 10 * 60 * 1000) {
    this.ttlMs = ttlMs;
  }

  async put(state: string, verifier: string): Promise<void> {
    this.store.set(state, { verifier, expiresAt: Date.now() + this.ttlMs });
  }

  async take(state: string): Promise<string | null> {
    const entry = this.store.get(state);
    if (!entry) return null;
    this.store.delete(state);
    if (entry.expiresAt < Date.now()) return null;
    return entry.verifier;
  }
}

/**
 * X (Twitter) プロバイダ実装
 */
export class XProvider implements SocialProvider {
  readonly platform: Platform = "x";

  private readonly oauth: XOAuthConfig;
  private readonly httpClient: XApiClient;
  private readonly premium: boolean;
  private readonly verifierStore: VerifierStore;

  constructor(options: XProviderOptions) {
    this.oauth = options.oauth;
    this.httpClient = options.httpClient ?? new XApiClient();
    this.premium = options.premium ?? false;
    this.verifierStore = options.verifierStore ?? new InMemoryVerifierStore();
  }

  getCapabilities(): ProviderCapabilities {
    return X_CAPABILITIES;
  }

  /**
   * OAuth 接続フロー:
   * - authorizationCode が無い場合: state + PKCE を生成し認可 URL を返す
   * - authorizationCode がある場合: code を access_token に交換し account 情報を返す
   */
  async connectAccount(input: ConnectAccountInput): Promise<ConnectAccountResult> {
    if (!input.authorizationCode) {
      // Phase 1: 認可 URL を発行する
      const pkce = generatePkcePair();
      const state = input.state;
      if (!state) {
        throw new ProviderError("X connectAccount: state is required to initiate OAuth");
      }
      await this.verifierStore.put(state, pkce.codeVerifier);
      const url = getAuthUrl(this.oauth, {
        redirectUri: input.redirectUrl,
        state,
        codeChallenge: pkce.codeChallenge,
      });
      return { authorizationUrl: url };
    }

    // Phase 2: コールバック。state から verifier を取り出し code と交換
    if (!input.state) {
      throw new ProviderError("X connectAccount: state is required to complete OAuth");
    }
    const verifier = await this.verifierStore.take(input.state);
    if (!verifier) {
      throw new ProviderError("X connectAccount: PKCE verifier not found for state", {
        state: input.state,
      });
    }

    const token = await exchangeCode(
      this.oauth,
      {
        code: input.authorizationCode,
        codeVerifier: verifier,
        redirectUri: input.redirectUrl,
      },
      this.httpClient,
    );

    // /2/users/me でアカウント情報を取得
    const me = await this.fetchMe(token.accessToken);

    const credentials = serializeXOAuth2Credentials(token, me.id);

    return {
      account: {
        externalAccountId: me.id,
        displayName: me.username ?? me.name ?? me.id,
        credentialsEncrypted: credentials,
        tokenExpiresAt: token.expiresAt,
        capabilities: X_CAPABILITIES,
      },
    };
  }

  async validatePost(input: ValidatePostInput): Promise<ValidationResult> {
    return validatePost(input, { premium: this.premium });
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

  async sendReply(input: SendReplyInput): Promise<SendReplyResult> {
    return sendReplyImpl(input, this.httpClient);
  }

  async listFollowers(input: ListFollowersInput): Promise<FollowerListResult> {
    return listFollowers(input, this.httpClient);
  }

  async listFollowing(input: ListFollowersInput): Promise<FollowerListResult> {
    return listFollowing(input, this.httpClient);
  }

  async listEngagementReplies(
    input: ListEngagementRepliesInput,
  ): Promise<EngagementReplyListResult> {
    return listEngagementRepliesImpl(input, this.httpClient);
  }

  async checkEngagementConditions(
    input: CheckEngagementConditionsInput,
  ): Promise<EngagementConditionResult> {
    return checkEngagementConditionsImpl(input, this.httpClient);
  }

  async performEngagementAction(
    input: PerformEngagementActionInput,
  ): Promise<EngagementActionResult> {
    return performEngagementActionImpl(input, this.httpClient);
  }

  async listQuoteTweets(input: ListQuoteTweetsInput): Promise<QuoteTweetListResult> {
    return listQuoteTweetsImpl(input, this.httpClient);
  }

  /**
   * トークンリフレッシュ
   *
   * SocialProvider.refreshToken の引数は accountId だが、v1 の provider-x は
   * refresh_token 自体を呼び出し側から渡せるよう credentials を扱う。
   * usecase 層 (packages/core/src/usecases/account.ts) からは復号済み credentials
   * を再利用するため、ここでは accountId を「credentials 文字列」として受け付ける
   * 実装も許容する。
   *
   * 具体的には、以下の順で解釈する:
   * 1. 引数が JSON.parse 可能かつ refreshToken フィールドを含む -> そのトークンを使う
   * 2. それ以外は accountId として受け、エラーを返す（外部ストアから取り出せないため）
   */
  async refreshToken(accountIdOrCredentials: string): Promise<RefreshResult> {
    const { refreshToken: refreshTokenValue, xUserId } =
      extractXRefreshToken(accountIdOrCredentials);

    if (!refreshTokenValue) {
      return {
        success: false,
        credentialsEncrypted: null,
        tokenExpiresAt: null,
        error: "refresh_token not found in credentials",
      };
    }

    try {
      const token = await refreshOAuthToken(this.oauth, refreshTokenValue, this.httpClient);
      return {
        success: true,
        credentialsEncrypted: serializeXOAuth2Credentials(token, xUserId),
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

  // ───────────────────────────────────────────
  // 内部
  // ───────────────────────────────────────────

  private async fetchMe(accessToken: string): Promise<{
    id: string;
    name?: string;
    username?: string;
  }> {
    const res = await this.httpClient.request<{
      data?: { id?: string; name?: string; username?: string };
    }>({
      method: "GET",
      path: "/2/users/me",
      accessToken,
    });
    const user = res.data?.data;
    if (!user?.id) {
      throw new ProviderError("X /2/users/me response missing user id", { body: res.data });
    }
    return { id: user.id, name: user.name, username: user.username };
  }
}

// ───────────────────────────────────────────
// 再エクスポート
// ───────────────────────────────────────────

export { X_CAPABILITIES } from "./capabilities.js";
export { XApiClient } from "./http-client.js";
export { XApi } from "./x-api.js";
export type {
  XCreateDmConversationInput,
  XCreateTweetInput,
  XDataResponse,
  XDmEvent,
  XDmEventOptions,
  XDmMessageInput,
  XIncludes,
  XListResponse,
  XPaginationMeta,
  XPaginationQueryOptions,
  XProblem,
  XSearchRecentTweetsOptions,
  XTimelineOptions,
  XTweet,
  XTweetQueryOptions,
  XUser,
} from "./x-api.js";
export {
  generatePkcePair,
  getAuthUrl,
  exchangeCode,
  refreshToken as refreshXToken,
  X_DEFAULT_SCOPES,
} from "./auth.js";
export type { XOAuthConfig, TokenResult, PkcePair } from "./auth.js";
export { validatePost, publishPost, deletePost } from "./post.js";
export { listThreads, getMessages, sendReply } from "./inbox.js";
export { checkEngagementConditions, listEngagementReplies } from "./engagement-gates.js";
export { listQuoteTweets } from "./quote-tweets.js";
export {
  X_CREDENTIAL_VERSION,
  X_OAUTH_1A_OPERATIONS,
  extractXRefreshToken,
  parseXCredentials,
  requireXAccessTokenCredentials,
  requireXOAuth1aCredentials,
  serializeXOAuth2Credentials,
} from "./credentials.js";
export type {
  XAccessTokenCredentials,
  XCredentialType,
  XCredentials,
  XOAuth1aCredentials,
  XOAuth1aOperation,
  XOAuth2Credentials,
} from "./credentials.js";
export { InMemoryVerifierStore };
