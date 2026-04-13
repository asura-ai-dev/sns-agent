/**
 * アカウント管理ユースケース
 *
 * Task 2002: SocialAccount の CRUD と OAuth 接続フロー。
 * design.md セクション 3.1, 4.2, 6, 8 に準拠。
 */
import { randomBytes } from "node:crypto";
import type { Platform } from "@sns-agent/config";
import type { SocialAccount } from "../domain/entities.js";
import type { AccountRepository } from "../interfaces/repositories.js";
import type { SocialProvider, ConnectAccountInput } from "../interfaces/social-provider.js";
import { encrypt, decrypt } from "../domain/crypto.js";
import { NotFoundError, ValidationError, ProviderError } from "../errors/domain-error.js";

// ───────────────────────────────────────────
// 型定義
// ───────────────────────────────────────────

/** トークンなしのアカウント情報（レスポンス用） */
export interface AccountSummary {
  id: string;
  workspaceId: string;
  platform: Platform;
  displayName: string;
  externalAccountId: string;
  tokenExpiresAt: Date | null;
  status: SocialAccount["status"];
  capabilities: SocialAccount["capabilities"];
  /** 期限切れ間近（7日以内）の場合 true */
  tokenExpiryWarning: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** OAuth state に埋め込む情報 */
export interface OAuthStatePayload {
  workspaceId: string;
  platform: Platform;
  /** CSRF 対策用のランダムトークン */
  nonce: string;
}

// ───────────────────────────────────────────
// ヘルパー
// ───────────────────────────────────────────

const TOKEN_EXPIRY_WARNING_DAYS = 7;

/** SocialAccount からトークン情報を除いた AccountSummary を生成する */
function toSummary(account: SocialAccount): AccountSummary {
  const now = new Date();
  const warningThreshold = new Date(
    now.getTime() + TOKEN_EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000,
  );

  let tokenExpiryWarning = false;
  if (account.tokenExpiresAt) {
    tokenExpiryWarning = account.tokenExpiresAt <= warningThreshold;
  }

  return {
    id: account.id,
    workspaceId: account.workspaceId,
    platform: account.platform,
    displayName: account.displayName,
    externalAccountId: account.externalAccountId,
    tokenExpiresAt: account.tokenExpiresAt,
    status: account.status,
    capabilities: account.capabilities,
    tokenExpiryWarning,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

/** OAuth state を暗号化して生成する */
function encodeOAuthState(payload: OAuthStatePayload, encryptionKey: string): string {
  return encrypt(JSON.stringify(payload), encryptionKey);
}

/** OAuth state を復号してパースする */
function decodeOAuthState(state: string, encryptionKey: string): OAuthStatePayload {
  try {
    const json = decrypt(state, encryptionKey);
    return JSON.parse(json) as OAuthStatePayload;
  } catch {
    throw new ValidationError("Invalid OAuth state parameter");
  }
}

/** ランダムな nonce を生成する */
function generateNonce(): string {
  return randomBytes(16).toString("hex");
}

// ───────────────────────────────────────────
// 依存注入コンテキスト
// ───────────────────────────────────────────

export interface AccountUsecaseDeps {
  accountRepo: AccountRepository;
  /** platform -> SocialProvider のマッピング */
  providers: Map<Platform, SocialProvider>;
  /** AES-256-GCM 用の暗号化キー（hex 文字列 64 文字） */
  encryptionKey: string;
  /** OAuth コールバック URL のベース（例: http://localhost:3001/api/accounts/callback） */
  callbackBaseUrl: string;
}

// ───────────────────────────────────────────
// ユースケース関数
// ───────────────────────────────────────────

/**
 * ワークスペースのアカウント一覧を返す（トークンは含めない）。
 */
export async function listAccounts(
  deps: AccountUsecaseDeps,
  workspaceId: string,
): Promise<AccountSummary[]> {
  const accounts = await deps.accountRepo.findByWorkspace(workspaceId);
  return accounts.map(toSummary);
}

/**
 * アカウント詳細を返す（トークンは含めない）。
 */
export async function getAccount(
  deps: AccountUsecaseDeps,
  accountId: string,
): Promise<AccountSummary> {
  const account = await deps.accountRepo.findById(accountId);
  if (!account) {
    throw new NotFoundError("SocialAccount", accountId);
  }
  return toSummary(account);
}

/**
 * OAuth 接続を開始する。Provider の connectAccount を呼び、認可 URL を返す。
 *
 * state パラメータに workspaceId, platform, nonce を暗号化して埋め込む。
 */
export async function initiateConnection(
  deps: AccountUsecaseDeps,
  workspaceId: string,
  platform: Platform,
): Promise<{ authUrl: string }> {
  const provider = deps.providers.get(platform);
  if (!provider) {
    throw new ValidationError(`Unsupported platform: ${platform}`);
  }

  const nonce = generateNonce();
  const state = encodeOAuthState({ workspaceId, platform, nonce }, deps.encryptionKey);

  const input: ConnectAccountInput = {
    workspaceId,
    platform,
    redirectUrl: deps.callbackBaseUrl,
    state,
  };

  const result = await provider.connectAccount(input);
  if (!result.authorizationUrl) {
    throw new ProviderError(`Provider ${platform} did not return an authorization URL`);
  }

  return { authUrl: result.authorizationUrl };
}

/**
 * OAuth コールバックを処理する。
 *
 * 1. state パラメータを復号して workspaceId, platform を取得
 * 2. Provider の connectAccount を code 付きで再呼び出し
 * 3. トークンを暗号化して DB に保存
 */
export async function handleOAuthCallback(
  deps: AccountUsecaseDeps,
  code: string,
  state: string,
): Promise<AccountSummary> {
  // state を復号
  const payload = decodeOAuthState(state, deps.encryptionKey);
  const { workspaceId, platform } = payload;

  const provider = deps.providers.get(platform);
  if (!provider) {
    throw new ValidationError(`Unsupported platform: ${platform}`);
  }

  // Provider に code を渡してトークンを取得
  const input: ConnectAccountInput = {
    workspaceId,
    platform,
    redirectUrl: deps.callbackBaseUrl,
    authorizationCode: code,
    state,
  };

  const result = await provider.connectAccount(input);
  if (!result.account) {
    throw new ProviderError(`Provider ${platform} did not return account information`);
  }

  // credentials を暗号化して保存する
  const credentialsEncrypted = encrypt(result.account.credentialsEncrypted, deps.encryptionKey);

  // DB に保存
  const account = await deps.accountRepo.create({
    workspaceId,
    platform,
    displayName: result.account.displayName,
    externalAccountId: result.account.externalAccountId,
    credentialsEncrypted,
    tokenExpiresAt: result.account.tokenExpiresAt,
    status: "active",
    capabilities: result.account.capabilities,
  });

  return toSummary(account);
}

/**
 * アカウントを論理削除する（status を 'revoked' に変更）。
 */
export async function disconnectAccount(
  deps: AccountUsecaseDeps,
  accountId: string,
): Promise<void> {
  const account = await deps.accountRepo.findById(accountId);
  if (!account) {
    throw new NotFoundError("SocialAccount", accountId);
  }

  await deps.accountRepo.update(accountId, { status: "revoked" });
}

/**
 * アカウントのトークンをリフレッシュする。
 * Provider の refreshToken を呼び、新しいトークンで DB を更新する。
 */
export async function refreshAccountToken(
  deps: AccountUsecaseDeps,
  accountId: string,
): Promise<AccountSummary> {
  const account = await deps.accountRepo.findById(accountId);
  if (!account) {
    throw new NotFoundError("SocialAccount", accountId);
  }

  const provider = deps.providers.get(account.platform);
  if (!provider) {
    throw new ProviderError(`No provider available for platform: ${account.platform}`);
  }

  if (!provider.refreshToken) {
    throw new ProviderError(`Provider ${account.platform} does not support token refresh`);
  }

  // Provider に復号済みの credentials を渡すため、accountId を使う
  const result = await provider.refreshToken(accountId);

  if (!result.success) {
    // リフレッシュ失敗時は status を error に更新
    await deps.accountRepo.update(accountId, { status: "error" });
    throw new ProviderError(result.error ?? `Token refresh failed for account ${accountId}`);
  }

  // 新しいトークンを暗号化して保存
  const updateData: Partial<SocialAccount> = {
    status: "active",
    tokenExpiresAt: result.tokenExpiresAt,
  };

  if (result.credentialsEncrypted) {
    updateData.credentialsEncrypted = result.credentialsEncrypted;
  }

  const updated = await deps.accountRepo.update(accountId, updateData);
  return toSummary(updated);
}

/**
 * ワークスペース内で期限切れ間近のアカウントを検出する。
 * token_expires_at が 7 日以内、または既に expired のアカウントを返す。
 */
export async function checkTokenExpiry(
  deps: AccountUsecaseDeps,
  workspaceId: string,
): Promise<AccountSummary[]> {
  const accounts = await deps.accountRepo.findByWorkspace(workspaceId);
  const now = new Date();
  const warningThreshold = new Date(
    now.getTime() + TOKEN_EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000,
  );

  return accounts
    .filter((account) => {
      if (account.status === "expired" || account.status === "error") {
        return true;
      }
      if (account.tokenExpiresAt && account.tokenExpiresAt <= warningThreshold) {
        return true;
      }
      return false;
    })
    .map(toSummary);
}
