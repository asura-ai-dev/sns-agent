/**
 * SocialProvider インターフェース定義
 *
 * design.md セクション 6 に準拠。
 * 各 SNS プロバイダ (provider-x, provider-line, provider-instagram) がこのインターフェースを実装する。
 */
import type { Platform } from "@sns-agent/config";
import type { ProviderCapabilities, MediaAttachment } from "../domain/entities.js";

// ───────────────────────────────────────────
// 入出力型
// ───────────────────────────────────────────

export interface ConnectAccountInput {
  workspaceId: string;
  platform: Platform;
  /** OAuth コールバック URL */
  redirectUrl: string;
  /** OAuth 認可コード（コールバック後に渡される） */
  authorizationCode?: string;
  /** OAuth state パラメータ */
  state?: string;
}

export interface ConnectAccountResult {
  /** OAuth 認可 URL（初回呼び出し時） */
  authorizationUrl?: string;
  /** 接続完了時のアカウント情報 */
  account?: {
    externalAccountId: string;
    displayName: string;
    credentialsEncrypted: string;
    tokenExpiresAt: Date | null;
    capabilities: ProviderCapabilities;
  };
}

export interface ValidatePostInput {
  platform: Platform;
  contentText: string | null;
  contentMedia: MediaAttachment[] | null;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export interface ValidationIssue {
  field: string;
  message: string;
  /** 制約値（例: 文字数上限） */
  constraint?: unknown;
}

export interface PublishPostInput {
  accountCredentials: string;
  contentText: string | null;
  contentMedia: MediaAttachment[] | null;
  /** 冪等性キー */
  idempotencyKey?: string;
}

export interface PublishResult {
  success: boolean;
  platformPostId: string | null;
  publishedAt: Date | null;
  error?: string;
}

export interface DeletePostInput {
  accountCredentials: string;
  platformPostId: string;
}

export interface DeleteResult {
  success: boolean;
  error?: string;
}

export interface ListThreadsInput {
  accountCredentials: string;
  limit?: number;
  cursor?: string;
}

export interface ThreadListResult {
  threads: {
    externalThreadId: string;
    participantName: string | null;
    lastMessageAt: Date | null;
  }[];
  nextCursor: string | null;
}

export interface GetMessagesInput {
  accountCredentials: string;
  externalThreadId: string;
  limit?: number;
  cursor?: string;
}

export interface MessageListResult {
  messages: {
    externalMessageId: string;
    direction: "inbound" | "outbound";
    contentText: string | null;
    contentMedia: MediaAttachment[] | null;
    sentAt: Date | null;
  }[];
  nextCursor: string | null;
}

export interface SendReplyInput {
  accountCredentials: string;
  externalThreadId: string;
  contentText: string;
  contentMedia?: MediaAttachment[];
}

export interface SendReplyResult {
  success: boolean;
  externalMessageId: string | null;
  error?: string;
}

export interface WebhookInput {
  headers: Record<string, string>;
  body: unknown;
}

export interface WebhookResult {
  verified: boolean;
  events: WebhookEvent[];
}

export interface WebhookEvent {
  type: "message" | "follow" | "unfollow" | "postback" | "other";
  externalThreadId: string | null;
  externalMessageId: string | null;
  data: unknown;
}

export interface RefreshResult {
  success: boolean;
  credentialsEncrypted: string | null;
  tokenExpiresAt: Date | null;
  error?: string;
}

// ───────────────────────────────────────────
// SocialProvider インターフェース
// ───────────────────────────────────────────

export interface SocialProvider {
  readonly platform: Platform;

  getCapabilities(): ProviderCapabilities;

  connectAccount(input: ConnectAccountInput): Promise<ConnectAccountResult>;

  validatePost(input: ValidatePostInput): Promise<ValidationResult>;

  publishPost(input: PublishPostInput): Promise<PublishResult>;

  deletePost(input: DeletePostInput): Promise<DeleteResult>;

  /** 受信スレッド一覧（対応プロバイダのみ） */
  listThreads?(input: ListThreadsInput): Promise<ThreadListResult>;

  /** スレッド内メッセージ取得（対応プロバイダのみ） */
  getMessages?(input: GetMessagesInput): Promise<MessageListResult>;

  /** 返信送信（対応プロバイダのみ） */
  sendReply?(input: SendReplyInput): Promise<SendReplyResult>;

  /** Webhook 受信処理（対応プロバイダのみ） */
  handleWebhook?(input: WebhookInput): Promise<WebhookResult>;

  /** トークン更新（対応プロバイダのみ） */
  refreshToken?(accountId: string): Promise<RefreshResult>;
}
