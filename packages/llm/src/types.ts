/**
 * LLM アダプタ型定義
 *
 * design.md セクション 1.5（LLM 実行モード）、spec.md 技術選定（LLM プロバイダアダプタ）に準拠。
 * OpenAI / Anthropic 等のプロバイダ差異を吸収する統一インターフェース。
 */

/**
 * チャットメッセージ 1 通分。
 * OpenAI の messages 配列、Anthropic の messages 配列の共通形。
 */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * LLM 呼び出し時のオプション。
 * すべて optional で、未指定時はアダプタ側が合理的なデフォルトを使う。
 */
export interface ChatOptions {
  /** モデル名 (例: "gpt-4o-mini", "claude-3-5-sonnet-latest") */
  model: string;
  /** 0.0 - 2.0 */
  temperature?: number;
  /** 出力最大トークン */
  maxTokens?: number;
  /** リクエストタイムアウト (ms)。デフォルト 30000 */
  timeout?: number;
}

/**
 * チャット呼び出しのトークン使用量。
 * recordUsage の estimatedCostUsd 計算に使う。
 */
export interface ChatUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * 非ストリーミングチャット応答。
 */
export interface ChatResponse {
  /** 生成されたテキスト (最初の choice の content) */
  content: string;
  usage: ChatUsage;
  /** 実際に応答を返したモデル名 (プロバイダが返した値) */
  model: string;
}

/**
 * ストリーミング時の差分イベント。
 * delta はトークン単位ではなく「このイベントで追加された文字列」を表す。
 */
export interface ChatStreamEvent {
  /** この差分で追加されたテキスト。空文字も許容。 */
  delta: string;
  /** 終了時に最終 usage を含む。途中イベントでは null */
  usage?: ChatUsage | null;
  /** 最終イベントで true。 */
  done: boolean;
}

/**
 * LLM プロバイダアダプタの統一インターフェース。
 *
 * 実装クラス: OpenAiAdapter, AnthropicAdapter
 */
export interface LlmAdapter {
  /** プロバイダ識別子 ("openai" | "anthropic" 等) */
  readonly provider: string;
  /**
   * 非ストリーミングチャット呼び出し。
   * 失敗時は LlmError をスローする。
   */
  chat(messages: ChatMessage[], options: ChatOptions): Promise<ChatResponse>;
  /**
   * ストリーミングチャット呼び出し。
   * 最後に done=true のイベントを 1 回だけ発行し、その時点で usage を含める。
   * 失敗時は LlmError をスローする (イテレータ内 throw でも可)。
   */
  stream(messages: ChatMessage[], options: ChatOptions): AsyncIterable<ChatStreamEvent>;
}
