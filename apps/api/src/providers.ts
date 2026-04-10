/**
 * Provider 初期化・登録
 *
 * Task 2003: 起動時に各 SocialProvider を ProviderRegistry に登録する。
 * 現状は X プロバイダのみ。provider-line / provider-instagram は Phase 4 で追加する。
 *
 * design.md セクション 6 (Provider IF) / 非機能要件 (拡張性) に準拠。
 */
import { ProviderRegistry } from "@sns-agent/core";
import { XProvider } from "@sns-agent/provider-x";

/**
 * 環境変数から ProviderRegistry を初期化する。
 *
 * 必須環境変数:
 * - X_CLIENT_ID      : X OAuth 2.0 クライアント ID
 *
 * 任意環境変数:
 * - X_CLIENT_SECRET  : confidential client の場合
 * - X_PREMIUM        : "true" で Premium プラン (25,000 文字上限)
 *
 * 環境変数が未設定の場合は X プロバイダの登録をスキップし、警告ログを出す。
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
