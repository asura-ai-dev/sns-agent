/**
 * Anthropic LLM アダプタ
 *
 * @anthropic-ai/sdk を使い、messages.create でチャットとストリームを実装する。
 *
 * 注意点:
 *  - Anthropic の messages API は system メッセージを別パラメータで受け取る。
 *    ChatMessage[] の role=system を抜き出して system 文字列として渡す。
 *  - max_tokens は Anthropic 側で必須。未指定時はデフォルト 1024 を使用。
 *
 * エラーは LlmError に変換する。
 */
import Anthropic from "@anthropic-ai/sdk";
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
const DEFAULT_MAX_TOKENS = 1024;

export interface AnthropicAdapterConfig {
  apiKey: string;
  baseURL?: string;
  /** 依存注入用 (テストモック用) */
  client?: Anthropic;
}

export class AnthropicAdapter implements LlmAdapter {
  readonly provider = "anthropic";
  private readonly client: Anthropic;

  constructor(config: AnthropicAdapterConfig) {
    if (config.client) {
      this.client = config.client;
    } else {
      if (!config.apiKey) {
        throw new LlmError("LLM_AUTH_ERROR", "Anthropic API key is required", this.provider);
      }
      this.client = new Anthropic({
        apiKey: config.apiKey,
        baseURL: config.baseURL,
      });
    }
  }

  async chat(messages: ChatMessage[], options: ChatOptions): Promise<ChatResponse> {
    const { system, conversation } = splitSystemMessage(messages);
    try {
      const res = await this.client.messages.create(
        {
          model: options.model,
          system: system || undefined,
          messages: conversation.map((m) => ({
            role: m.role === "assistant" ? "assistant" : "user",
            content: m.content,
          })),
          temperature: options.temperature,
          max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
        },
        { timeout: options.timeout ?? DEFAULT_TIMEOUT_MS },
      );

      // content は ContentBlock[] なので text ブロックのみ集める
      const content = (res.content ?? [])
        .map((block) => {
          if (typeof block === "object" && block && "type" in block && block.type === "text") {
            return (block as { text: string }).text;
          }
          return "";
        })
        .join("");

      const usage: ChatUsage = {
        promptTokens: res.usage?.input_tokens ?? 0,
        completionTokens: res.usage?.output_tokens ?? 0,
        totalTokens: (res.usage?.input_tokens ?? 0) + (res.usage?.output_tokens ?? 0),
      };

      return {
        content,
        usage,
        model: res.model ?? options.model,
      };
    } catch (err) {
      throw translateAnthropicError(err);
    }
  }

  async *stream(messages: ChatMessage[], options: ChatOptions): AsyncIterable<ChatStreamEvent> {
    const { system, conversation } = splitSystemMessage(messages);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let streamIter: any;
    try {
      streamIter = await this.client.messages.create(
        {
          model: options.model,
          system: system || undefined,
          messages: conversation.map((m) => ({
            role: m.role === "assistant" ? "assistant" : "user",
            content: m.content,
          })),
          temperature: options.temperature,
          max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
          stream: true,
        },
        { timeout: options.timeout ?? DEFAULT_TIMEOUT_MS },
      );
    } catch (err) {
      throw translateAnthropicError(err);
    }

    let inputTokens = 0;
    let outputTokens = 0;

    try {
      for await (const event of streamIter) {
        // event.type に応じた処理
        const type = event?.type as string | undefined;
        if (type === "message_start") {
          inputTokens = event?.message?.usage?.input_tokens ?? 0;
          outputTokens = event?.message?.usage?.output_tokens ?? 0;
          continue;
        }
        if (type === "content_block_delta") {
          const delta = event?.delta;
          if (delta?.type === "text_delta" && typeof delta.text === "string") {
            if (delta.text.length > 0) {
              yield { delta: delta.text, done: false };
            }
          }
          continue;
        }
        if (type === "message_delta") {
          // 最終トークン数は message_delta.usage に含まれる
          outputTokens = event?.usage?.output_tokens ?? outputTokens;
          continue;
        }
        // message_stop / content_block_start / content_block_stop などは無視
      }
    } catch (err) {
      throw translateAnthropicError(err);
    }

    const usage: ChatUsage = {
      promptTokens: inputTokens,
      completionTokens: outputTokens,
      totalTokens: inputTokens + outputTokens,
    };
    yield { delta: "", usage, done: true };
  }
}

/** Anthropic は system を別パラメータで受け取るため分離する */
function splitSystemMessage(messages: ChatMessage[]): {
  system: string;
  conversation: ChatMessage[];
} {
  const systemParts: string[] = [];
  const conversation: ChatMessage[] = [];
  for (const m of messages) {
    if (m.role === "system") {
      systemParts.push(m.content);
    } else {
      conversation.push(m);
    }
  }
  return { system: systemParts.join("\n\n"), conversation };
}

function translateAnthropicError(err: unknown): LlmError {
  if (err instanceof LlmError) return err;
  const e = err as {
    name?: string;
    status?: number;
    message?: string;
    code?: string;
  };
  const message = e?.message ?? "Anthropic request failed";

  if (e?.status === 401 || e?.status === 403) {
    return new LlmError("LLM_AUTH_ERROR", message, "anthropic", { status: e?.status });
  }
  if (e?.status === 429) {
    return new LlmError("LLM_RATE_LIMIT", message, "anthropic", { status: 429 });
  }
  if ((e?.status ?? 0) >= 400 && (e?.status ?? 0) < 500) {
    return new LlmError("LLM_INVALID_REQUEST", message, "anthropic", { status: e?.status });
  }
  if (
    e?.name === "APIConnectionTimeoutError" ||
    e?.code === "ETIMEDOUT" ||
    /timeout/i.test(message)
  ) {
    return new LlmError("LLM_TIMEOUT", message, "anthropic");
  }
  return new LlmError("LLM_API_ERROR", message, "anthropic", { status: e?.status });
}
