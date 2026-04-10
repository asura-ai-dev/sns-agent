/**
 * JSON フォーマッター
 *
 * --json 指定時に使われる。成功・エラー・情報メッセージの全てを
 * stdout に JSON として書き出し、機械パース可能な出力を保証する。
 */

import type { OutputFormatter } from "./types.js";

export class JsonFormatter implements OutputFormatter {
  data(data: unknown): void {
    process.stdout.write(`${JSON.stringify({ data }, null, 2)}\n`);
  }

  error(err: { code: string; message: string; details?: unknown }): void {
    const payload = {
      error: {
        code: err.code,
        message: err.message,
        details: err.details ?? null,
      },
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  }

  info(message: string): void {
    process.stdout.write(`${JSON.stringify({ info: message })}\n`);
  }
}
