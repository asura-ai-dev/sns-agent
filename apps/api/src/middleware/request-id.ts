/**
 * Request ID ミドルウェア
 *
 * リクエストに X-Request-Id ヘッダを付与する。
 * 既存ヘッダがあればそれを使い、なければ UUID v4 を生成する。
 * design.md セクション 4.4 ミドルウェアチェーンに準拠。
 */
import type { MiddlewareHandler } from "hono";
import { v4 as uuidv4 } from "uuid";

export const requestId: MiddlewareHandler = async (c, next) => {
  const existingId = c.req.header("X-Request-Id");
  const id = existingId || uuidv4();

  c.set("requestId", id);

  await next();

  c.header("X-Request-Id", id);
};
