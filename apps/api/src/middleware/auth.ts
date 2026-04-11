/**
 * 認証ミドルウェア
 *
 * Task 2001: Authorization ヘッダ（Bearer API キー）またはセッション Cookie から
 * actor を解決し、Hono context にセットする。
 *
 * design.md セクション 4.1（認証）、セクション 4.4（ミドルウェアチェーン）に準拠。
 */
import { createHash } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { resolveActorByApiKey, resolveActorByUserId } from "@sns-agent/core";
import type { Actor } from "@sns-agent/core";
import { DrizzleUserRepository, DrizzleAgentIdentityRepository } from "@sns-agent/db";
import type { DbClient } from "@sns-agent/db";

/**
 * API キーを SHA-256 でハッシュ化する。
 * DB には平文ではなくハッシュを保存しているため、比較時にハッシュ化が必要。
 */
function hashApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

/**
 * 認証ミドルウェア。
 *
 * 1. Authorization: Bearer <api_key> がある場合 → API キーハッシュで AgentIdentity/User を解決
 * 2. X-Session-User-Id ヘッダがある場合 → ユーザー ID で User を解決
 *    （本番ではセッション Cookie + サーバーサイドセッションで userId を取得するが、
 *     v1 では簡易的にヘッダベースのセッション表現を使用）
 * 3. いずれもない場合 → 401 UNAUTHORIZED
 */
export const authMiddleware: MiddlewareHandler = async (c, next) => {
  const db = c.get("db") as DbClient;

  // 1. Bearer token 認証
  const authHeader = c.req.header("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const apiKey = authHeader.slice(7);
    if (apiKey) {
      const apiKeyHash = hashApiKey(apiKey);
      const agentRepo = new DrizzleAgentIdentityRepository(db);
      const actor = await resolveActorByApiKey(agentRepo, apiKeyHash);
      if (actor) {
        c.set("actor", actor);
        await next();
        return;
      }
      // API キーが無効 → 401
      return c.json(
        {
          error: {
            code: "AUTH_INVALID_API_KEY",
            message: "Invalid API key",
          },
        },
        401,
      );
    }
  }

  // 2. セッションベース認証（簡易実装: X-Session-User-Id ヘッダ）
  const sessionUserId = c.req.header("X-Session-User-Id");
  if (sessionUserId) {
    const userRepo = new DrizzleUserRepository(db);
    const actor = await resolveActorByUserId(userRepo, sessionUserId);
    if (actor) {
      c.set("actor", actor);
      await next();
      return;
    }
    // ユーザーが見つからない → 401
    return c.json(
      {
        error: {
          code: "AUTH_INVALID_SESSION",
          message: "Invalid session",
        },
      },
      401,
    );
  }

  // 3. 認証情報なし → 401
  return c.json(
    {
      error: {
        code: "AUTH_UNAUTHORIZED",
        message:
          "Authentication required. Provide Authorization: Bearer <api_key> header or session.",
      },
    },
    401,
  );
};
