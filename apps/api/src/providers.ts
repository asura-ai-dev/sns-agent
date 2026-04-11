/**
 * Provider 初期化・登録
 *
 * Task 2003 / 4001 / 4002: 起動時に各 SocialProvider を ProviderRegistry に登録する。
 * X / LINE / Instagram の 3 プロバイダ全てを扱う。
 *
 * design.md セクション 6 (Provider IF) / 非機能要件 (拡張性) に準拠。
 */
import { ProviderRegistry } from "@sns-agent/core";
import { XProvider } from "@sns-agent/provider-x";
import { InstagramProvider } from "@sns-agent/provider-instagram";
import { LineProvider } from "@sns-agent/provider-line";

/**
 * 環境変数から ProviderRegistry を初期化する。
 *
 * 必須環境変数:
 * - X_CLIENT_ID                : X OAuth 2.0 クライアント ID
 * - INSTAGRAM_CLIENT_ID        : Facebook App ID (Instagram Graph API 用)
 * - INSTAGRAM_CLIENT_SECRET    : Facebook App Secret
 * - LINE_CHANNEL_ID            : LINE Messaging API チャンネル ID
 * - LINE_ASSERTION_KID         : Assertion Signing Key の kid
 * - LINE_ASSERTION_PRIVATE_KEY : Assertion Signing Key の PKCS#8 PEM 秘密鍵
 *
 * 任意環境変数:
 * - X_CLIENT_SECRET            : confidential client の場合
 * - X_PREMIUM                  : "true" で Premium プラン (25,000 文字上限)
 * - INSTAGRAM_WEBHOOK_SECRET   : Webhook 署名検証用 (未指定時は INSTAGRAM_CLIENT_SECRET を使う)
 * - LINE_CHANNEL_SECRET        : LINE Webhook 署名検証用 (未指定でも provider 登録は可能)
 * - LINE_TOKEN_TTL_SECONDS     : Channel Access Token の有効期間 (秒、最大 2592000)
 *
 * 環境変数が未設定の場合は該当 provider の登録をスキップし、警告ログを出す。
 * （CI やテスト環境で provider を要求しないケースを許容するため）
 */
export function createProviderRegistry(): ProviderRegistry {
  const registry = new ProviderRegistry();

  const xClientId = process.env.X_CLIENT_ID;
  if (xClientId) {
    registry.register(
      new XProvider({
        oauth: {
          clientId: xClientId,
          clientSecret: process.env.X_CLIENT_SECRET,
        },
        premium: process.env.X_PREMIUM === "true",
      }),
    );
  } else {
    // eslint-disable-next-line no-console
    console.warn(
      "[providers] X_CLIENT_ID not set; XProvider will not be registered. " +
        "OAuth / publish operations for X will fail until env vars are provided.",
    );
  }

  const igClientId = process.env.INSTAGRAM_CLIENT_ID;
  const igClientSecret = process.env.INSTAGRAM_CLIENT_SECRET;
  if (igClientId && igClientSecret) {
    registry.register(
      new InstagramProvider({
        oauth: {
          clientId: igClientId,
          clientSecret: igClientSecret,
        },
        webhook: {
          appSecret: process.env.INSTAGRAM_WEBHOOK_SECRET ?? igClientSecret,
        },
      }),
    );
  } else {
    // eslint-disable-next-line no-console
    console.warn(
      "[providers] INSTAGRAM_CLIENT_ID / INSTAGRAM_CLIENT_SECRET not set; " +
        "InstagramProvider will not be registered. OAuth / publish operations for Instagram " +
        "will fail until env vars are provided.",
    );
  }

  const lineChannelId = process.env.LINE_CHANNEL_ID;
  const lineAssertionKid = process.env.LINE_ASSERTION_KID;
  const lineAssertionKey = process.env.LINE_ASSERTION_PRIVATE_KEY;
  if (lineChannelId && lineAssertionKid && lineAssertionKey) {
    const ttlEnv = process.env.LINE_TOKEN_TTL_SECONDS;
    const ttl = ttlEnv ? Number(ttlEnv) : undefined;
    registry.register(
      new LineProvider({
        oauth: {
          channelId: lineChannelId,
          assertionKid: lineAssertionKid,
          // LINE 秘密鍵は PEM 文字列を env に入れる際に改行を \n エスケープしている
          // ケースがあるため、実運用では復元する
          assertionPrivateKeyPem: lineAssertionKey.replace(/\\n/g, "\n"),
          channelSecret: process.env.LINE_CHANNEL_SECRET,
          tokenTtlSeconds: Number.isFinite(ttl) ? ttl : undefined,
        },
      }),
    );
  } else {
    // eslint-disable-next-line no-console
    console.warn(
      "[providers] LINE_CHANNEL_ID / LINE_ASSERTION_KID / LINE_ASSERTION_PRIVATE_KEY " +
        "not set; LineProvider will not be registered. Token issue / publish operations " +
        "for LINE will fail until env vars are provided.",
    );
  }

  return registry;
}

/**
 * プロセス単位でレジストリを使い回すためのシングルトン取得関数。
 * ルート層は必ずこの関数経由で取得する。
 */
let cached: ProviderRegistry | null = null;
export function getProviderRegistry(): ProviderRegistry {
  if (!cached) {
    cached = createProviderRegistry();
  }
  return cached;
}

/** テスト / ホットリロード用に明示リセット */
export function resetProviderRegistry(): void {
  cached = null;
}

/**
 * テスト専用: ProviderRegistry を直接差し替える。
 * createProviderRegistry() は環境変数依存のため、統合テストではモック provider
 * を組んだ registry を外部注入する必要がある。
 */
export function setProviderRegistry(registry: ProviderRegistry): void {
  cached = registry;
}
