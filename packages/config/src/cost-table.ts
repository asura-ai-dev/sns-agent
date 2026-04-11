/**
 * 推定コスト単価テーブル
 *
 * Task 4003: SNS API / LLM API の推定コスト単価を定義する。
 * v1 では概算値とし、正確な料金は v1.5 で対応する。
 *
 * - SNS API 側は「1 リクエストあたりの USD」を保持する
 * - LLM 側は「1K トークンあたりの USD」を保持する
 * - `estimateCost` で actualUnits (リクエスト数 or 1K トークン単位数) を掛けて算出する
 */

/** プラットフォーム × エンドポイント の単価エントリ */
export interface CostRate {
  /** 単価の算定方法: per-request = 1 リクエスト固定、per-1k-tokens = 1K トークン単価 */
  unit: "per-request" | "per-1k-tokens";
  /** 単価 (USD) */
  costUsd: number;
}

/**
 * 単価テーブル
 *
 * キーは `${platform}:${endpoint}` 形式。
 * 例: `x:tweet.create`, `line:messaging.push`, `openai:gpt-4o`。
 *
 * 未登録のキーは `DEFAULT_COST_PER_REQUEST` で扱う。
 */
export const COST_TABLE: Record<string, CostRate> = {
  // ─── X (Twitter) ───────────────────────────
  "x:tweet.create": { unit: "per-request", costUsd: 0.001 },
  "x:tweet.delete": { unit: "per-request", costUsd: 0.0005 },
  "x:user.lookup": { unit: "per-request", costUsd: 0.0002 },
  "x:timeline.read": { unit: "per-request", costUsd: 0.0002 },

  // ─── LINE ──────────────────────────────────
  "line:messaging.push": { unit: "per-request", costUsd: 0.0001 },
  "line:messaging.reply": { unit: "per-request", costUsd: 0.0001 },
  "line:messaging.broadcast": { unit: "per-request", costUsd: 0.0005 },

  // ─── Instagram ─────────────────────────────
  "instagram:media.publish": { unit: "per-request", costUsd: 0.0008 },
  "instagram:media.delete": { unit: "per-request", costUsd: 0.0004 },
  "instagram:comment.reply": { unit: "per-request", costUsd: 0.0002 },

  // ─── OpenAI ────────────────────────────────
  "openai:gpt-4o": { unit: "per-1k-tokens", costUsd: 0.01 },
  "openai:gpt-4o-mini": { unit: "per-1k-tokens", costUsd: 0.0015 },
  "openai:gpt-3.5-turbo": { unit: "per-1k-tokens", costUsd: 0.0005 },

  // ─── Anthropic ─────────────────────────────
  "anthropic:claude-3-5-sonnet": { unit: "per-1k-tokens", costUsd: 0.015 },
  "anthropic:claude-3-haiku": { unit: "per-1k-tokens", costUsd: 0.00025 },
};

/** テーブル未登録エンドポイントのフォールバック単価 (USD/リクエスト) */
export const DEFAULT_COST_PER_REQUEST = 0.0005;

/**
 * コスト単価を取得する。未登録なら DEFAULT を返す。
 */
export function getCostRate(platform: string, endpoint: string): CostRate {
  const key = `${platform}:${endpoint}`;
  return COST_TABLE[key] ?? { unit: "per-request", costUsd: DEFAULT_COST_PER_REQUEST };
}

/**
 * 推定コストを計算する。
 *
 * - per-request: requestCount × costUsd
 * - per-1k-tokens: (tokenCount / 1000) × costUsd
 *
 * @param platform 'x' | 'line' | 'instagram' | 'openai' | 'anthropic' 等
 * @param endpoint メソッド名 (例: 'tweet.create', 'gpt-4o')
 * @param actualUnits 課金対象量 (リクエスト数 or トークン数)。省略時は 1 リクエスト扱い
 */
export function estimateCost(platform: string, endpoint: string, actualUnits: number = 1): number {
  const rate = getCostRate(platform, endpoint);
  if (rate.unit === "per-1k-tokens") {
    return (actualUnits / 1000) * rate.costUsd;
  }
  return actualUnits * rate.costUsd;
}
