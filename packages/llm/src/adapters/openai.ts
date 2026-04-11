/**
 * OpenAI LLM アダプタ
 *
 * design.md セクション 1.5 / spec.md 技術選定（LLM プロバイダアダプタ）。
 * openai npm パッケージを使い、chat.completions.create でチャットとストリームを実装する。
 *
 * エラーは LlmError に変換する:
 *  - APIConnectionError / APIConnectionTimeoutError → LLM_TIMEOUT or LLM_API_ERROR
 *  - AuthenticationError → LLM_AUTH_ERROR
 *  - RateLimitError → LLM_RATE_LIMIT
 *  - BadRequestError → LLM_INVALID_REQUEST
 *  - その他 → LLM_API_ERROR
 */
import OpenAI from "openai";
import { LlmError } from "@sns-agent/core";
import type {
  ChatMessage,
  ChatOptions,
  ChatResponse,
  ChatStreamEvent,
  ChatUsage,
  LlmAdapter,
} from "../types.js";

const DEFAULT_TIMEOUT_MS = 30_000;

export interface OpenAiAdapterConfig {
  apiKey: string;
  baseURL?: string;
  /** 依存注入用: テストから OpenAI クライアントをモックできる */
  client?: OpenAI;
}

export class OpenAiAdapter implements LlmAdapter {
  readonly provider = "openai";
  private readonly client: OpenAI;

  constructor(config: OpenAiAdapterConfig) {
    if (config.client) {
      this.client = config.client;
    } else {
      if (!config.apiKey) {
        throw new LlmError("LLM_AUTH_ERROR", "OpenAI API key is required", this.provider);
      }
      this.client = new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseURL,
      });
    }
  }

  async chat(messages: ChatMessage[], options: ChatOptions): Promise<ChatResponse> {
    try {
      const res = await this.client.chat.completions.create(
        {
          model: options.model,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          temperature: options.temperature,
          max_tokens: options.maxTokens,
          stream: false,
        },
        { timeout: options.timeout ?? DEFAULT_TIMEOUT_MS },
      );

      const choice = res.choices[0];
      const content = choice?.message?.content ?? "";
      const usage: ChatUsage = {
        promptTokens: res.usage?.prompt_tokens ?? 0,
        completionTokens: res.usage?.completion_tokens ?? 0,
        totalTokens: res.usage?.total_tokens ?? 0,
      };
      return {
        content,
        usage,
        model: res.model ?? options.model,
      };
    } catch (err) {
      throw translateOpenAiError(err);
    }
  }

  async *stream(messages: ChatMessage[], options: ChatOptions): AsyncIterable<ChatStreamEvent> {
    let streamIter: Awaited<ReturnType<typeof this.client.chat.completions.create>>;
    try {
      streamIter = await this.client.chat.completions.create(
        {
          model: options.model,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          temperature: options.temperature,
          max_tokens: options.maxTokens,
          stream: true,
          stream_options: { include_usage: true },
        },
        { timeout: options.timeout ?? DEFAULT_TIMEOUT_MS },
      );
    } catch (err) {
      throw translateOpenAiError(err);
    }

    let finalUsage: ChatUsage | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for await (const chunk of streamIter as any) {
        const delta: string = chunk?.choices?.[0]?.delta?.content ?? "";
        if (chunk?.usage) {
          finalUsage = {
            promptTokens: chunk.usage.prompt_tokens ?? 0,
            completionTokens: chunk.usage.completion_tokens ?? 0,
            totalTokens: chunk.usage.total_tokens ?? 0,
          };
        }
        if (delta) {
          yield { delta, done: false };
        }
      }
    } catch (err) {
      throw translateOpenAiError(err);
    }

    yield { delta: "", usage: finalUsage, done: true };
  }
}

function translateOpenAiError(err: unknown): LlmError {
  if (err instanceof LlmError) return err;
  // openai v4 SDK exposes named error classes under OpenAI namespace
  const e = err as {
    name?: string;
    status?: number;
    message?: string;
    code?: string;
    type?: string;
  };
  const message = e?.message ?? "OpenAI request failed";

  // Authentication / authorization
  if (e?.status === 401 || e?.status === 403 || e?.name === "AuthenticationError") {
    return new LlmError("LLM_AUTH_ERROR", message, "openai", { status: e?.status });
  }
  // Rate limit
  if (e?.status === 429 || e?.name === "RateLimitError") {
    return new LlmError("LLM_RATE_LIMIT", message, "openai", { status: 429 });
  }
  // Bad request
  if ((e?.status ?? 0) >= 400 && (e?.status ?? 0) < 500) {
    return new LlmError("LLM_INVALID_REQUEST", message, "openai", { status: e?.status });
  }
  // Timeouts
  if (
    e?.name === "APIConnectionTimeoutError" ||
    e?.code === "ETIMEDOUT" ||
    /timeout/i.test(message)
  ) {
    return new LlmError("LLM_TIMEOUT", message, "openai");
  }
  return new LlmError("LLM_API_ERROR", message, "openai", { status: e?.status });
}
