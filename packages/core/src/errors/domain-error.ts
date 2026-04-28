/**
 * ドメインエラー定義
 *
 * design.md セクション 9 に準拠。
 * エラーコード体系: AUTH_xxx, VALID_xxx, PROVIDER_xxx, BUDGET_xxx, LLM_xxx, SKILL_xxx, SYSTEM_xxx
 */

/**
 * 全ドメインエラーの基底クラス。
 * code フィールドで機械的なエラー判別を行う。
 */
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

/**
 * バリデーションエラー (VALID_xxx)
 * 入力値が不正な場合にスローする。
 */
export class ValidationError extends DomainError {
  constructor(message: string, details?: unknown) {
    super("VALID_ERROR", message, details);
    this.name = "ValidationError";
  }
}

/**
 * 認可エラー (AUTH_xxx)
 * ロールや権限が不足している場合にスローする。
 */
export class AuthorizationError extends DomainError {
  constructor(message: string, details?: unknown) {
    super("AUTH_FORBIDDEN", message, details);
    this.name = "AuthorizationError";
  }
}

/**
 * Not Found エラー
 * リソースが存在しない場合にスローする。
 */
export class NotFoundError extends DomainError {
  constructor(resourceType: string, resourceId: string) {
    super("NOT_FOUND", `${resourceType} not found: ${resourceId}`, {
      resourceType,
      resourceId,
    });
    this.name = "NotFoundError";
  }
}

/**
 * 予算超過エラー (BUDGET_xxx)
 * 予算ポリシーの上限を超過した場合にスローする。
 */
export class BudgetExceededError extends DomainError {
  constructor(message: string, details?: unknown) {
    super("BUDGET_EXCEEDED", message, details);
    this.name = "BudgetExceededError";
  }
}

/**
 * SNS プロバイダエラー (PROVIDER_xxx)
 * 外部 SNS API との通信でエラーが発生した場合にスローする。
 */
export class ProviderError extends DomainError {
  constructor(message: string, details?: unknown) {
    super("PROVIDER_ERROR", message, details);
    this.name = "ProviderError";
  }
}

/**
 * プロバイダ権限エラー (PROVIDER_PERMISSION_REQUIRED)
 * 外部SNS側のスコープ/権限不足で、ユーザーの再認可や設定変更が必要な場合に使う。
 */
export class ProviderPermissionError extends DomainError {
  constructor(message: string, details?: unknown) {
    super("PROVIDER_PERMISSION_REQUIRED", message, details);
    this.name = "ProviderPermissionError";
  }
}

/**
 * レート制限エラー (PROVIDER_RATE_LIMIT)
 * 外部 API のレート制限に到達した場合にスローする。
 */
export class RateLimitError extends DomainError {
  constructor(message: string, details?: unknown) {
    super("PROVIDER_RATE_LIMIT", message, details);
    this.name = "RateLimitError";
  }
}

/**
 * LLM エラー (LLM_xxx)
 * LLM プロバイダ (OpenAI / Anthropic 等) の呼び出し失敗時にスローする。
 *
 * code は以下を想定:
 *  - LLM_API_ERROR: API 呼び出し失敗 (HTTP 5xx, ネットワーク等)
 *  - LLM_AUTH_ERROR: 認証失敗 (APIキー不正)
 *  - LLM_RATE_LIMIT: レート制限
 *  - LLM_TIMEOUT: タイムアウト
 *  - LLM_INVALID_REQUEST: 不正なリクエスト (4xx)
 *  - LLM_ROUTE_NOT_FOUND: workspace に対する llm route が未設定
 *  - LLM_UNSUPPORTED_PROVIDER: 未対応の provider 指定
 */
export class LlmError extends DomainError {
  constructor(
    code: string,
    message: string,
    public readonly provider?: string,
    details?: unknown,
  ) {
    super(code, message, details);
    this.name = "LlmError";
  }
}
