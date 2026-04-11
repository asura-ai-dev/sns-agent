/**
 * CORS ミドルウェア
 *
 * 開発環境: origin = "*"
 * 本番環境: origin = WEB_URL のみ許可
 * design.md セクション 4.4 ミドルウェアチェーンに準拠。
 */
import { cors as honoCors } from "hono/cors";
import type { MiddlewareHandler } from "hono";

export function createCorsMiddleware(): MiddlewareHandler {
  const nodeEnv = process.env.NODE_ENV || "development";
  const webUrl = process.env.WEB_URL || "http://localhost:3000";

  if (nodeEnv === "production") {
    return honoCors({
      origin: webUrl,
      allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization", "X-Request-Id", "X-Idempotency-Key"],
      exposeHeaders: ["X-Request-Id"],
      maxAge: 3600,
    });
  }

  // 開発環境・テスト環境
  return honoCors({
    origin: "*",
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-Request-Id", "X-Idempotency-Key"],
    exposeHeaders: ["X-Request-Id"],
  });
}
