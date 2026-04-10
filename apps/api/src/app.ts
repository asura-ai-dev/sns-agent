/**
 * Hono アプリケーション初期化
 *
 * ミドルウェア、DB context 注入、ルーティングを組み立てる。
 * design.md セクション 1.2（REST 中心）、セクション 4.4（ミドルウェアチェーン）に準拠。
 */
import { Hono } from "hono";
import { getDb } from "@sns-agent/db";
import type { DbClient } from "@sns-agent/db";
import { requestId, errorHandler, createCorsMiddleware } from "./middleware/index.js";
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

export { app };
export type { AppVariables };
