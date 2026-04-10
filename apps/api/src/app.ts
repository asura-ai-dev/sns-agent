/**
 * Hono アプリケーション初期化
 *
 * ミドルウェア、DB context 注入、ルーティングを組み立てる。
 * design.md セクション 1.2（REST 中心）、セクション 4.4（ミドルウェアチェーン）に準拠。
 */
import { Hono } from "hono";
import { getDb } from "@sns-agent/db";
import type { DbClient } from "@sns-agent/db";
import {
  requestId,
  errorHandler,
  createCorsMiddleware,
  authMiddleware,
} from "./middleware/index.js";
import type { Actor } from "@sns-agent/core";
import {
  accounts,
  posts,
  schedules,
  usage,
  budget,
  llm,
  skills,
  agent,
  audit,
  approvals,
  webhooks,
} from "./routes/index.js";

/**
 * Hono の Variables 型定義。
 * c.set / c.get で型安全にアクセスする。
 */
type AppVariables = {
  requestId: string;
  db: DbClient;
  actor: Actor;
};

const app = new Hono<{ Variables: AppVariables }>();

// --- ミドルウェア ---

// CORS
app.use("*", createCorsMiddleware());

// リクエストID付与
app.use("*", requestId);

// DB context 注入
app.use("*", async (c, next) => {
  const db = getDb();
  c.set("db", db);
  await next();
});

// 認証ミドルウェア（/api/health と /api/webhooks を除く全ルートに適用）
app.use("/api/accounts/*", authMiddleware);
app.use("/api/posts/*", authMiddleware);
app.use("/api/schedules/*", authMiddleware);
app.use("/api/usage/*", authMiddleware);
app.use("/api/budget/*", authMiddleware);
app.use("/api/llm/*", authMiddleware);
app.use("/api/skills/*", authMiddleware);
app.use("/api/agent/*", authMiddleware);
app.use("/api/audit/*", authMiddleware);
app.use("/api/approvals/*", authMiddleware);

// エラーハンドラ
app.onError(errorHandler);

// --- ヘルスチェック ---

app.get("/api/health", (c) => {
  return c.json({ status: "ok" });
});

// --- ルーティング ---

app.route("/api/accounts", accounts);
app.route("/api/posts", posts);
app.route("/api/schedules", schedules);
app.route("/api/usage", usage);
app.route("/api/budget", budget);
app.route("/api/llm", llm);
app.route("/api/skills", skills);
app.route("/api/agent", agent);
app.route("/api/audit", audit);
app.route("/api/approvals", approvals);
app.route("/api/webhooks", webhooks);

// --- 404 ハンドラ ---
app.notFound((c) => {
  return c.json(
    { error: { code: "NOT_FOUND", message: `Route not found: ${c.req.method} ${c.req.path}` } },
    404,
  );
});

export { app };
export type { AppVariables };
