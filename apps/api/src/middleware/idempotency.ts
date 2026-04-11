/**
 * Idempotency ミドルウェア
 *
 * Task 2004: X-Idempotency-Key ヘッダを検出し、POST/PATCH で
 * 同一キーが既に DB に存在する場合は前回の投稿を返す。
 *
 * v1 の実装方針:
 * - 投稿エンドポイント（/api/posts）専用の最小実装
 * - DB の posts.idempotency_key ユニーク制約を利用して重複検出
 * - key が既存なら 200 OK で前回の Post を返す（後段のハンドラは実行しない）
 * - key が無ければ c.set("idempotencyKey", key) でハンドラへ伝搬
 *
 * 将来的には汎用 idempotency レコード（リクエストハッシュ + レスポンスキャッシュ）への
 * 置き換えを想定するが、v1 では posts.idempotency_key を最低限のキーストアとして使う。
 *
 * design.md セクション 4.2 / 4.4、評価観点「idempotency key による重複実行防止」に準拠。
 */
import type { MiddlewareHandler } from "hono";
import { DrizzlePostRepository } from "@sns-agent/db";
import type { DbClient } from "@sns-agent/db";

const HEADER_NAME = "x-idempotency-key";

/**
 * Idempotency ミドルウェアを生成する。
 *
 * 対象: POST / PATCH リクエストで X-Idempotency-Key ヘッダがあるもの。
 * - ヘッダが無ければ何もせず next()
 * - GET / DELETE / その他は何もせず next()
 *
 * ヒット時の挙動:
 * - /api/posts 系: DB の posts.idempotency_key で lookup し、
 *   既存レコードがあれば 200 OK で { data: Post } を返してハンドラをスキップ
 *
 * ヒットしない場合:
 * - c.set("idempotencyKey", key) でハンドラに伝搬し、ハンドラ側で create 時に保存する
 */
export const idempotencyMiddleware: MiddlewareHandler = async (c, next) => {
  const method = c.req.method.toUpperCase();
  if (method !== "POST" && method !== "PATCH") {
    await next();
    return;
  }

  const headerKey = c.req.header(HEADER_NAME) ?? c.req.header("X-Idempotency-Key");
  if (!headerKey) {
    await next();
    return;
  }

  // ハンドラに伝搬
  c.set("idempotencyKey", headerKey);

  // 投稿エンドポイントでのみ DB lookup を行う
  const path = c.req.path;
  if (path.startsWith("/api/posts")) {
    const db = c.get("db") as DbClient | undefined;
    if (db) {
      const repo = new DrizzlePostRepository(db);
      const existing = await repo.findByIdempotencyKey(headerKey);
      if (existing) {
        // ワークスペース一致チェック（認証後の actor から判定）
        const actor = c.get("actor") as { workspaceId: string } | undefined;
        if (actor && existing.workspaceId === actor.workspaceId) {
          return c.json({ data: existing }, 200);
        }
      }
    }
  }

  await next();
};
