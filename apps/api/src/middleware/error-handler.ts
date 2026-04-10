/**
 * エラーハンドリングミドルウェア
 *
 * 未処理エラーを捕捉し、design.md セクション 4.3 のエラーレスポンス形式で返す。
 * - DomainError: code / message / details をそのまま変換
 * - ValidationError: 400
 * - AuthorizationError: 403
 * - NotFoundError: 404
 * - BudgetExceededError: 429
 * - RateLimitError: 429
 * - ProviderError: 502
 * - その他 DomainError: 400
 * - それ以外: 500 SYSTEM_ERROR
 */
import type { ErrorHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  DomainError,
  ValidationError,
  AuthorizationError,
  NotFoundError,
  BudgetExceededError,
  ProviderError,
  RateLimitError,
} from "@sns-agent/core";

function getStatusCode(err: DomainError): ContentfulStatusCode {
  if (err instanceof ValidationError) return 400;
  if (err instanceof AuthorizationError) return 403;
  if (err instanceof NotFoundError) return 404;
  if (err instanceof BudgetExceededError) return 429;
  if (err instanceof RateLimitError) return 429;
  if (err instanceof ProviderError) return 502;
  return 400;
}

export const errorHandler: ErrorHandler = (err, c) => {
  if (err instanceof DomainError) {
    const status = getStatusCode(err);
    return c.json(
      {
        error: {
          code: err.code,
          message: err.message,
          details: err.details,
        },
      },
      status,
    );
  }

  // 未知のエラー -> 500 SYSTEM_ERROR
  console.error("Unhandled error:", err);
  return c.json(
    {
      error: {
        code: "SYSTEM_ERROR",
        message: "An unexpected error occurred",
      },
    },
    500 as ContentfulStatusCode,
  );
};
