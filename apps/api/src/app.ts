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
  auditMiddleware,
  usageRecorderMiddleware,
} from "./middleware/index.js";
import type { AppVariables } from "./types.js";
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
  inbox,
  followers,
  tags,
  engagementGates,
  quoteTweets,
} from "./routes/index.js";

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

// 認証ミドルウェア（/api/health, /api/webhooks, /api/accounts/callback を除く全ルートに適用）
// OAuth コールバックは認証不要（state パラメータで検証する）
app.use("/api/accounts/*", async (c, next) => {
  // callback エンドポイントは認証をスキップ
  if (c.req.path === "/api/accounts/callback") {
    await next();
    return;
  }
  return authMiddleware(c, next);
});
app.use("/api/posts/*", authMiddleware);
app.use("/api/schedules/*", authMiddleware);
app.use("/api/usage/*", authMiddleware);
app.use("/api/budget/*", authMiddleware);
app.use("/api/llm/*", authMiddleware);
app.use("/api/skills/*", authMiddleware);
app.use("/api/agent/*", authMiddleware);
app.use("/api/audit/*", authMiddleware);
app.use("/api/approvals/*", authMiddleware);
app.use("/api/inbox/*", authMiddleware);
app.use("/api/followers/*", authMiddleware);
app.use("/api/tags/*", authMiddleware);
app.use("/api/engagement-gates/*", authMiddleware);
app.use("/api/quote-tweets/*", authMiddleware);

// 自動使用量記録ミドルウェア（認証後に適用。usageRepo を context に注入する）
app.use("/api/posts/*", usageRecorderMiddleware);
app.use("/api/schedules/*", usageRecorderMiddleware);
app.use("/api/usage/*", usageRecorderMiddleware);
app.use("/api/inbox/*", usageRecorderMiddleware);
app.use("/api/followers/*", usageRecorderMiddleware);
app.use("/api/tags/*", usageRecorderMiddleware);
app.use("/api/engagement-gates/*", usageRecorderMiddleware);
app.use("/api/quote-tweets/*", usageRecorderMiddleware);

// 自動監査記録ミドルウェア（認証後・書き込み系エンドポイントで適用）
// POST / PATCH / PUT / DELETE の完了後に audit_logs テーブルへ追記する
app.use("/api/accounts/*", auditMiddleware);
app.use("/api/posts/*", auditMiddleware);
app.use("/api/schedules/*", auditMiddleware);
app.use("/api/budget/*", auditMiddleware);
app.use("/api/llm/*", auditMiddleware);
app.use("/api/skills/*", auditMiddleware);
app.use("/api/agent/*", auditMiddleware);
app.use("/api/approvals/*", auditMiddleware);
app.use("/api/inbox/*", auditMiddleware);
app.use("/api/followers/*", auditMiddleware);
app.use("/api/tags/*", auditMiddleware);
app.use("/api/engagement-gates/*", auditMiddleware);
app.use("/api/quote-tweets/*", auditMiddleware);

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
app.route("/api/inbox", inbox);
app.route("/api/followers", followers);
app.route("/api/tags", tags);
app.route("/api/engagement-gates", engagementGates);
app.route("/api/quote-tweets", quoteTweets);

// --- 404 ハンドラ ---
app.notFound((c) => {
  return c.json(
    { error: { code: "NOT_FOUND", message: `Route not found: ${c.req.method} ${c.req.path}` } },
    404,
  );
});

export { app };
export type { AppVariables };
