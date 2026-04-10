/**
 * @sns-agent/llm - LLM アダプタ & Route Resolver
 *
 * design.md セクション 1.5 / 3.1 / 4.2 に準拠。
 */

// Types
export type {
  ChatMessage,
  ChatOptions,
  ChatResponse,
  ChatStreamEvent,
  ChatUsage,
  LlmAdapter,
} from "./types.js";

// Adapters
export { OpenAiAdapter } from "./adapters/openai.js";
export type { OpenAiAdapterConfig } from "./adapters/openai.js";
export { AnthropicAdapter } from "./adapters/anthropic.js";
export type { AnthropicAdapterConfig } from "./adapters/anthropic.js";

// Router
export { resolveLlmRoute, executeLlmCall, buildDefaultAdapters } from "./router.js";
export type {
  ResolveRouteOptions,
  ResolvedRoute,
  ExecuteLlmDeps,
  ExecuteLlmOptions,
  BuildAdaptersConfig,
} from "./router.js";

// Cost
export { estimateCostUsd, resolvePricing } from "./cost.js";
