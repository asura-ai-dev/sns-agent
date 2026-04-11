/**
 * Provider registry
 *
 * Task 2003: SocialProvider のプラットフォーム別登録と参照。
 * apps/api の起動時に各 provider を登録し、usecase から参照する。
 *
 * design.md セクション 6 / 非機能要件（拡張性: packages/provider-<name> を
 * core 変更なしに capability ベースで組み込める）に準拠。
 */
import type { Platform } from "@sns-agent/config";
import type { SocialProvider } from "./social-provider.js";

/**
 * ProviderRegistry
 *
 * - register(provider): プラットフォーム単位で provider を登録する。
 *   既に同じ platform が登録されている場合は上書きする（テスト・差し替え用）。
 * - get(platform): 登録済みの provider を返す。未登録なら undefined。
 * - getAll(): 登録された provider の Map を返す（AccountUsecaseDeps.providers 互換）。
 */
export class ProviderRegistry {
  private readonly providers: Map<Platform, SocialProvider> = new Map();

  register(provider: SocialProvider): void {
    this.providers.set(provider.platform, provider);
  }

  get(platform: Platform): SocialProvider | undefined {
    return this.providers.get(platform);
  }

  /**
   * 登録された全 provider を platform -> provider の Map で返す。
   * AccountUsecaseDeps.providers にそのまま渡せる形状。
   * （内部 Map の参照を返すため、外部での変更はレジストリに反映される点に注意）
   */
  getAll(): Map<Platform, SocialProvider> {
    return this.providers;
  }

  /** 登録数（テスト用） */
  size(): number {
    return this.providers.size;
  }
}
