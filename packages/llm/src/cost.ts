/**
 * LLM コスト見積もりテーブル
 *
 * トークン数から概算の USD コストを計算する。
 * 料金は公開情報に基づくが、常に最新ではないため「推定値」として扱う。
 * (recordUsage の estimatedCostUsd は参考値であり、請求突合は v1 スコープ外)
 *
 * 単位: USD per 1K tokens
 */
import type { ChatUsage } from "./types.js";

interface ModelPricing {
  inputPer1K: number;
  outputPer1K: number;
}

/**
 * 既知モデルの価格表。プレフィックスマッチで柔軟に解決する。
 * 未知モデルはデフォルト (GPT-4o-mini 相当) で概算する。
 */
const PRICING_TABLE: Array<{ prefix: string; pricing: ModelPricing }> = [
  // OpenAI
  { prefix: "gpt-4o-mini", pricing: { inputPer1K: 0.00015, outputPer1K: 0.0006 } },
  { prefix: "gpt-4o", pricing: { inputPer1K: 0.0025, outputPer1K: 0.01 } },
  { prefix: "gpt-4-turbo", pricing: { inputPer1K: 0.01, outputPer1K: 0.03 } },
  { prefix: "gpt-4", pricing: { inputPer1K: 0.03, outputPer1K: 0.06 } },
  { prefix: "gpt-3.5-turbo", pricing: { inputPer1K: 0.0005, outputPer1K: 0.0015 } },
  { prefix: "o1-mini", pricing: { inputPer1K: 0.003, outputPer1K: 0.012 } },
  { prefix: "o1", pricing: { inputPer1K: 0.015, outputPer1K: 0.06 } },
  // Anthropic
  { prefix: "claude-3-5-sonnet", pricing: { inputPer1K: 0.003, outputPer1K: 0.015 } },
  { prefix: "claude-3-5-haiku", pricing: { inputPer1K: 0.0008, outputPer1K: 0.004 } },
  { prefix: "claude-3-opus", pricing: { inputPer1K: 0.015, outputPer1K: 0.075 } },
  { prefix: "claude-3-sonnet", pricing: { inputPer1K: 0.003, outputPer1K: 0.015 } },
  { prefix: "claude-3-haiku", pricing: { inputPer1K: 0.00025, outputPer1K: 0.00125 } },
];

const DEFAULT_PRICING: ModelPricing = { inputPer1K: 0.00015, outputPer1K: 0.0006 };

export function resolvePricing(model: string): ModelPricing {
  const normalized = model.toLowerCase();
  for (const entry of PRICING_TABLE) {
    if (normalized.startsWith(entry.prefix)) {
      return entry.pricing;
    }
  }
  return DEFAULT_PRICING;
}

/**
 * 使用量から概算コスト (USD) を計算する。
 * 小数点以下 6 桁で丸める (usage_records.estimated_cost_usd は decimal(10,6))。
 */
export function estimateCostUsd(model: string, usage: ChatUsage): number {
  const pricing = resolvePricing(model);
  const inputCost = (usage.promptTokens / 1000) * pricing.inputPer1K;
  const outputCost = (usage.completionTokens / 1000) * pricing.outputPer1K;
  const total = inputCost + outputCost;
  return Math.round(total * 1_000_000) / 1_000_000;
}
