/**
 * @sns-agent/provider-line - LINE プロバイダ
 *
 * Task 4001: SocialProvider インターフェースの LINE 実装。
 *
 * design.md セクション 6 (Provider IF) / セクション 11.1 (LINE 投稿制約 5,000 文字) /
 * セクション 1.7 (LINE は Channel Access Token v2.1 / JWT) に準拠。
 *
 * LINE 固有の考慮事項:
 * - LINE にフィード型の投稿は無い。push message / multicast / broadcast が「投稿」に相当する。
 * - broadcast は全友だちへの配信 -> 承認フロー (Phase 6) と連携する設計。
 * - メッセージ削除は API 非対応 -> deletePost は ProviderError を返す。
 * - Flex Message は v1 では拡張ポイント (extra.messages) 経由でのみ受け付ける。
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
  WebhookInput,
  WebhookResult,
  RefreshResult,
} from "@sns-agent/core";
import { ProviderError } from "@sns-agent/core";
import { LineApiClient } from "./http-client.js";
import { LINE_CAPABILITIES } from "./capabilities.js";
import {
  issueChannelAccessToken,
  revokeChannelAccessToken,
  type LineOAuthConfig,
  type LineTokenResult,
} from "./auth.js";
import { validatePost, publishPost, deletePost } from "./post.js";
import {
  listThreads as listThreadsImpl,
  getMessages as getMessagesImpl,
  sendReply as sendReplyImpl,
  EMPTY_LINE_INBOX_STORE,
  type LineInboxStore,
} from "./inbox.js";
import { handleWebhook as handleWebhookImpl } from "./webhook.js";

export interface LineProviderOptions {
  /** LINE OAuth / JWT 設定 */
  oauth: LineOAuthConfig;
  /** HTTP クライアント (テスト差し替え用) */
  httpClient?: LineApiClient;
  /**
   * Inbox ストア。usecase 層が Webhook 経由で蓄積した会話データを返す実装。
   * 省略時は空結果を返す。
   */
  inboxStore?: LineInboxStore;
}

/**
 * LINE プロバイダ実装
 */
export class LineProvider implements SocialProvider {
  readonly platform: Platform = "line";

  private readonly oauth: LineOAuthConfig;
  private readonly httpClient: LineApiClient;
  private readonly inboxStore: LineInboxStore;

  constructor(options: LineProviderOptions) {
    this.oauth = options.oauth;
    this.httpClient = options.httpClient ?? new LineApiClient();
    this.inboxStore = options.inboxStore ?? EMPTY_LINE_INBOX_STORE;
  }

  getCapabilities(): ProviderCapabilities {
    return LINE_CAPABILITIES;
  }

  /**
   * LINE のアカウント「接続」は以下のフローを取る:
   *
   * - LINE は他 SNS のような user OAuth ではなく、Messaging API Channel を
   *   事前に LINE Developers Console で作成する前提。
   * - 本プロバイダでは「接続 = Channel ID / Secret / Assertion Key を受け取り、
   *   JWT 発行で Channel Access Token v2.1 を入手する」までを担当する。
   * - authorizationCode / redirectUrl は使用しない (authorizationUrl も返さない)。
   *
   * 呼び出し元 (usecase 層) は事前にチャンネル情報を保存しておき、
   * connectAccount で token 取得を行ってから SocialAccount を作成する。
   */
  async connectAccount(input: ConnectAccountInput): Promise<ConnectAccountResult> {
    void input; // LINE では redirectUrl / state は使わない
    const token = await issueChannelAccessToken(this.oauth, this.httpClient);
    const credentials = serializeCredentials(token, this.oauth);

    return {
      account: {
        externalAccountId: this.oauth.channelId,
        displayName: `LINE Channel ${this.oauth.channelId}`,
        credentialsEncrypted: credentials,
        tokenExpiresAt: token.expiresAt,
        capabilities: LINE_CAPABILITIES,
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
    // deletePost は ProviderError を throw する (LINE は API 非対応)
    return deletePost(input);
  }

  async listThreads(input: ListThreadsInput): Promise<ThreadListResult> {
    return listThreadsImpl(input, this.inboxStore);
  }

  async getMessages(input: GetMessagesInput): Promise<MessageListResult> {
    return getMessagesImpl(input, this.inboxStore);
  }

  async sendReply(input: SendReplyInput): Promise<SendReplyResult> {
    return sendReplyImpl(input, this.httpClient);
  }

  async handleWebhook(input: WebhookInput): Promise<WebhookResult> {
    return handleWebhookImpl(input, {
      channelSecret: this.oauth.channelSecret,
    });
  }

  /**
   * LINE の Channel Access Token v2.1 はリフレッシュではなく「発行し直し」。
   * assertionPrivateKeyPem と channelId があれば任意のタイミングで新しいトークンを発行できる。
   *
   * 本メソッドは accountId 引数を使わず、constructor で渡された oauth config を使って
   * 再発行するだけ。usecase 層は新しい credentials を DB に書き戻す責務を持つ。
   */
  async refreshToken(_accountId: string): Promise<RefreshResult> {
    try {
      const token = await issueChannelAccessToken(this.oauth, this.httpClient);
      return {
        success: true,
        credentialsEncrypted: serializeCredentials(token, this.oauth),
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

  /**
   * Channel Access Token を明示失効させる補助メソッド (SocialProvider IF 外)。
   */
  async revokeToken(accessToken: string): Promise<void> {
    await revokeChannelAccessToken(this.oauth, accessToken, this.httpClient);
  }
}

// ───────────────────────────────────────────
// ヘルパー
// ───────────────────────────────────────────

/** credentials JSON をシリアライズ (usecase 側で暗号化する想定) */
function serializeCredentials(token: LineTokenResult, oauth: LineOAuthConfig): string {
  return JSON.stringify({
    accessToken: token.accessToken,
    expiresAt: token.expiresAt ? token.expiresAt.toISOString() : null,
    keyId: token.keyId,
    tokenType: token.tokenType,
    // channelSecret を credentials に含めておくと、Webhook ハンドラで使える。
    // 暗号化前提なので同等の保護強度。
    channelSecret: oauth.channelSecret ?? null,
  });
}

/** ProviderError を re-export (consumer 側が判別に使う) */
export { ProviderError };

// ───────────────────────────────────────────
// 再エクスポート
// ───────────────────────────────────────────

export {
  LINE_CAPABILITIES,
  LINE_TEXT_LIMIT,
  LINE_MAX_MESSAGES_PER_REQUEST,
} from "./capabilities.js";
export { LineApiClient, LINE_API_BASE_URL, LINE_TOKEN_URL } from "./http-client.js";
export {
  issueChannelAccessToken,
  revokeChannelAccessToken,
  signAssertionJwt,
  LINE_TOKEN_MAX_TTL_SECONDS,
  LINE_TOKEN_DEFAULT_TTL_SECONDS,
} from "./auth.js";
export type { LineOAuthConfig, LineTokenResult } from "./auth.js";
export {
  validatePost,
  publishPost,
  deletePost,
  buildLineMessages,
  type LinePublishExtras,
} from "./post.js";
export {
  parseLineCredentials,
  type LineAccessCredentials,
  type LinePublishMode,
} from "./credentials.js";
export {
  listThreads as listLineThreads,
  getMessages as getLineMessages,
  sendReply as sendLineReply,
  EMPTY_LINE_INBOX_STORE,
  type LineInboxStore,
} from "./inbox.js";
export { handleWebhook, verifyLineSignature, type LineWebhookOptions } from "./webhook.js";
