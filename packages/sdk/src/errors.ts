/**
 * SDK エラー型定義
 *
 * API レスポンスの { error: { code, message, details } } 形式を
 * クライアント側で扱うためのエラークラス。
 */

/**
 * SDK 操作で発生するエラー。
 * API の 4xx/5xx レスポンスをパースして生成される。
 */
export class SdkError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details: unknown;

  constructor(params: { statusCode: number; code: string; message: string; details?: unknown }) {
    super(params.message);
    this.name = "SdkError";
    this.statusCode = params.statusCode;
    this.code = params.code;
    this.details = params.details ?? null;
  }

  /**
   * API エラーレスポンスの body と HTTP ステータスコードから SdkError を生成する。
   * body が期待する形式でない場合はフォールバックメッセージを使用する。
   */
  static fromResponse(statusCode: number, body: unknown): SdkError {
    if (
      body !== null &&
      typeof body === "object" &&
      "error" in body &&
      body.error !== null &&
      typeof body.error === "object"
    ) {
      const err = body.error as Record<string, unknown>;
      return new SdkError({
        statusCode,
        code: typeof err.code === "string" ? err.code : "UNKNOWN_ERROR",
        message: typeof err.message === "string" ? err.message : `HTTP ${statusCode}`,
        details: err.details ?? null,
      });
    }

    return new SdkError({
      statusCode,
      code: "UNKNOWN_ERROR",
      message: `HTTP ${statusCode}`,
      details: body,
    });
  }
}
