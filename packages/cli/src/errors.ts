/**
 * エラー変換ユーティリティ
 *
 * SDK の SdkError や一般的な Error を、
 * フォーマッターに渡せる { code, message, details } 形式に正規化する。
 */

import { SdkError } from "@sns-agent/sdk";

export interface NormalizedError {
  code: string;
  message: string;
  details?: unknown;
}

export function normalizeError(err: unknown): NormalizedError {
  if (err instanceof SdkError) {
    return {
      code: err.code,
      message: humanizeSdkError(err),
      details: err.details ?? undefined,
    };
  }
  if (err instanceof Error) {
    return {
      code: "CLI_ERROR",
      message: err.message,
    };
  }
  return {
    code: "UNKNOWN_ERROR",
    message: typeof err === "string" ? err : "Unknown error",
  };
}

/**
 * SdkError を人間可読なメッセージに変換する。
 * ステータスコードと code から典型的な状況を説明する。
 */
function humanizeSdkError(err: SdkError): string {
  const base = err.message;
  switch (err.statusCode) {
    case 401:
      return `Authentication failed: ${base}. Please check your --api-key or SNS_API_KEY.`;
    case 403:
      return `Forbidden: ${base}. Your account does not have permission for this action.`;
    case 404:
      return `Not found: ${base}`;
    case 409:
      return `Conflict: ${base}`;
    case 422:
      return `Validation error: ${base}`;
    case 429:
      return `Rate limited: ${base}. Please retry later.`;
    default:
      if (err.statusCode >= 500) {
        return `Server error (${err.statusCode}): ${base}`;
      }
      return base;
  }
}
