/**
 * LLM Route Resolver
 *
 * design.md セクション 1.5 (LLM 実行モード), セクション 3.1 (llm_routes テーブル) に準拠。
 *
 * - resolveLlmRoute: llm_routes から workspace / platform / action に応じたルートを解決する
 *   優先度: (platform + action 両一致) > (platform のみ一致) > (action のみ一致) > (どちらも NULL = default)
 *   同じ specificity なら priority 降順。
 *
 * - executeLlmCall: 解決済みルートに沿って LLM を呼び、失敗時は fallback に切り替え、
 *   成功可否にかかわらず usage_records に記録する。
 */
import type { LlmRoute, LlmRouteRepository, ActorType } from "@sns-agent/core";
import { LlmError, recordUsage } from "@sns-agent/core";
import type { UsageUsecaseDeps } from "@sns-agent/core";
import type { ChatMessage, ChatOptions, ChatResponse, LlmAdapter } from "./types.js";
import { OpenAiAdapter } from "./adapters/openai.js";
import { AnthropicAdapter } from "./adapters/anthropic.js";
import { estimateCostUsd } from "./cost.js";

// ───────────────────────────────────────────
// 型
// ───────────────────────────────────────────

export interface ResolveRouteOptions {
  platform?: string;
  action?: string;
}

/**
 * resolveLlmRoute の結果。
 * provider + model + fallback 情報をセットで返す。
 */
export interface ResolvedRoute {
  route: LlmRoute;
  primary: {
    provider: string;
    model: string;
    temperature: number | null;
    maxTokens: number | null;
  };
  fallback: {
    provider: string;
    model: string;
  } | null;
}

/**
 * executeLlmCall の依存注入。
 * アダプタは provider 名 → LlmAdapter のマップとして渡す。
 * (テストではモックアダプタを注入できる)
 */
export interface ExecuteLlmDeps extends UsageUsecaseDeps {
  adapters: Record<string, LlmAdapter>;
  /** usage 記録用 actor 情報 */
  actor: {
    workspaceId: string;
    actorId: string | null;
    actorType: ActorType;
  };
}

export interface ExecuteLlmOptions {
  /**
   * ChatOptions を route の値で上書きする場合に指定。
   * model / temperature / maxTokens は通常 route から取るためここでは timeout 等のみ。
   */
  timeout?: number;
}

// ───────────────────────────────────────────
// resolveLlmRoute
// ───────────────────────────────────────────

/**
 * workspace / platform / action に応じた最適な LlmRoute を 1 件返す。
 * 該当が無ければ null を返す。
 *
 * Repository の resolve() を直接叩かず、findByWorkspace() 全件から specificity スコアで
 * アプリ層マッチングする。これにより Repository 側の SQL 複雑度を下げ、テスト容易性を確保する。
 *
 * マッチ条件:
 *   - route.platform が NULL または options.platform と一致
 *   - route.action   が NULL または options.action   と一致
 *
 * スコアリング (高いほど優先):
 *   platform 一致 = 2 点
 *   action   一致 = 1 点
 *   同点なら route.priority 降順
 */
export async function resolveLlmRoute(
  repo: LlmRouteRepository,
  workspaceId: string,
  options: ResolveRouteOptions = {},
): Promise<ResolvedRoute | null> {
  const all = await repo.findByWorkspace(workspaceId);
  if (all.length === 0) return null;

  type Scored = { route: LlmRoute; score: number };
  const candidates: Scored[] = [];

  for (const route of all) {
    // platform 不一致 (route は platform 指定あり && options.platform と一致しない) → 除外
    if (route.platform !== null && route.platform !== options.platform) continue;
    if (route.action !== null && route.action !== options.action) continue;

    let score = 0;
    if (route.platform !== null && route.platform === options.platform) score += 2;
    if (route.action !== null && route.action === options.action) score += 1;
    candidates.push({ route, score });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.route.priority - a.route.priority;
  });

  const winner = candidates[0].route;
  return {
    route: winner,
    primary: {
      provider: winner.provider,
      model: winner.model,
      temperature: winner.temperature,
      maxTokens: winner.maxTokens,
    },
    fallback:
      winner.fallbackProvider && winner.fallbackModel
        ? { provider: winner.fallbackProvider, model: winner.fallbackModel }
        : null,
  };
}

// ───────────────────────────────────────────
// executeLlmCall
// ───────────────────────────────────────────

/**
 * 解決済み route に従い LLM を呼び出す。
 * primary 失敗時は fallback を試行する。
 * 成否にかかわらず usage_records に記録する。
 *
 * 失敗経路:
 *  - primary 失敗 & fallback 無し → 元の LlmError を throw
 *  - primary 失敗 & fallback 成功 → primary は failure として usage 記録、fallback は success として記録、正常応答を返す
 *  - primary 失敗 & fallback 失敗 → 両方 failure として usage 記録、fallback の LlmError を throw
 */
export async function executeLlmCall(
  deps: ExecuteLlmDeps,
  resolved: ResolvedRoute,
  messages: ChatMessage[],
  options: ExecuteLlmOptions = {},
): Promise<ChatResponse> {
  const primaryAdapter = deps.adapters[resolved.primary.provider];
  if (!primaryAdapter) {
    throw new LlmError(
      "LLM_UNSUPPORTED_PROVIDER",
      `No adapter registered for provider: ${resolved.primary.provider}`,
      resolved.primary.provider,
    );
  }

  const primaryChatOptions: ChatOptions = {
    model: resolved.primary.model,
    temperature: resolved.primary.temperature ?? undefined,
    maxTokens: resolved.primary.maxTokens ?? undefined,
    timeout: options.timeout,
  };

  try {
    const response = await primaryAdapter.chat(messages, primaryChatOptions);
    await safeRecordUsage(deps, {
      provider: resolved.primary.provider,
      model: resolved.primary.model,
      success: true,
      usage: response.usage,
    });
    return response;
  } catch (primaryErr) {
    // primary 失敗 → failure を記録
    await safeRecordUsage(deps, {
      provider: resolved.primary.provider,
      model: resolved.primary.model,
      success: false,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    });

    if (!resolved.fallback) {
      throw primaryErr;
    }

    const fallbackAdapter = deps.adapters[resolved.fallback.provider];
    if (!fallbackAdapter) {
      throw new LlmError(
        "LLM_UNSUPPORTED_PROVIDER",
        `No adapter registered for fallback provider: ${resolved.fallback.provider}`,
        resolved.fallback.provider,
      );
    }

    const fallbackChatOptions: ChatOptions = {
      model: resolved.fallback.model,
      temperature: resolved.primary.temperature ?? undefined,
      maxTokens: resolved.primary.maxTokens ?? undefined,
      timeout: options.timeout,
    };

    try {
      const response = await fallbackAdapter.chat(messages, fallbackChatOptions);
      await safeRecordUsage(deps, {
        provider: resolved.fallback.provider,
        model: resolved.fallback.model,
        success: true,
        usage: response.usage,
      });
      return response;
    } catch (fallbackErr) {
      await safeRecordUsage(deps, {
        provider: resolved.fallback.provider,
        model: resolved.fallback.model,
        success: false,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      });
      throw fallbackErr;
    }
  }
}

// ───────────────────────────────────────────
// usage 記録ヘルパー
// ───────────────────────────────────────────

/**
 * recordUsage は usage_records 挿入失敗時に throw するが、LLM 呼び出しの本筋を
 * 壊すのは望ましくないので catch してログだけ残す (v1 方針)。
 */
async function safeRecordUsage(
  deps: ExecuteLlmDeps,
  params: {
    provider: string;
    model: string;
    success: boolean;
    usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  },
): Promise<void> {
  const estimatedCostUsd = params.success ? estimateCostUsd(params.model, params.usage) : 0;
  try {
    await recordUsage(deps, {
      workspaceId: deps.actor.workspaceId,
      platform: params.provider,
      endpoint: params.model,
      actorId: deps.actor.actorId,
      actorType: deps.actor.actorType,
      success: params.success,
      estimatedCostUsd,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[llm] failed to record usage", {
      provider: params.provider,
      model: params.model,
      success: params.success,
      error: err instanceof Error ? err.message : err,
    });
  }
}

// ───────────────────────────────────────────
// アダプタファクトリ (api 層が DI しやすいように)
// ───────────────────────────────────────────

export interface BuildAdaptersConfig {
  openAiApiKey?: string;
  anthropicApiKey?: string;
}

/**
 * 環境変数等から取得した API キーで既定アダプタ一式を構築する。
 * API キーが無い provider はマップから除外される。
 */
export function buildDefaultAdapters(config: BuildAdaptersConfig): Record<string, LlmAdapter> {
  const adapters: Record<string, LlmAdapter> = {};
  if (config.openAiApiKey) {
    adapters["openai"] = new OpenAiAdapter({ apiKey: config.openAiApiKey });
  }
  if (config.anthropicApiKey) {
    adapters["anthropic"] = new AnthropicAdapter({ apiKey: config.anthropicApiKey });
  }
  return adapters;
}
