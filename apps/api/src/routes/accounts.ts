/**
 * アカウント管理ルート
 *
 * Task 2002: SocialAccount の CRUD と OAuth 接続フロー。
 * design.md セクション 4.2: /api/accounts
 */
import { Hono } from "hono";
import type { Platform } from "@sns-agent/config";
import { PLATFORMS } from "@sns-agent/config";
import {
  listAccounts,
  getAccount,
  initiateConnection,
  handleOAuthCallback,
  disconnectAccount,
  refreshAccountToken,
  checkTokenExpiry,
  ValidationError,
} from "@sns-agent/core";
import type { AccountUsecaseDeps } from "@sns-agent/core";
import { DrizzleAccountRepository } from "@sns-agent/db";
import { requirePermission } from "../middleware/rbac.js";
import type { AppVariables } from "../types.js";

const accounts = new Hono<{ Variables: AppVariables }>();

// ───────────────────────────────────────────
// ヘルパー: 依存注入コンテキストの生成
// ───────────────────────────────────────────

/**
 * リクエストコンテキストから AccountUsecaseDeps を組み立てる。
 *
 * providers は現時点では空の Map を渡す（provider-x 等の実装後に注入する）。
 * encryptionKey は環境変数 ENCRYPTION_KEY から取得。開発時はデフォルト値を使用。
 */
function buildDeps(db: AppVariables["db"]): AccountUsecaseDeps {
  const encryptionKey =
    process.env.ENCRYPTION_KEY ||
    // 開発用デフォルトキー（32 bytes = 64 hex chars）
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  const callbackBaseUrl = `${process.env.WEB_URL || "http://localhost:3001"}/api/accounts/callback`;

  return {
    accountRepo: new DrizzleAccountRepository(db),
    providers: new Map(),
    encryptionKey,
    callbackBaseUrl,
  };
}

// ───────────────────────────────────────────
// GET /api/accounts - アカウント一覧
// ───────────────────────────────────────────
accounts.get("/", requirePermission("account:read"), async (c) => {
  const actor = c.get("actor");
  const db = c.get("db");
  const deps = buildDeps(db);

  const data = await listAccounts(deps, actor.workspaceId);
  return c.json({ data });
});

// ───────────────────────────────────────────
// POST /api/accounts - 接続開始（OAuth URL 返却）
// ───────────────────────────────────────────
accounts.post("/", requirePermission("account:connect"), async (c) => {
  const actor = c.get("actor");
  const db = c.get("db");
  const deps = buildDeps(db);

  const body = await c.req.json<{ platform?: string }>();
  if (!body.platform) {
    throw new ValidationError("platform is required");
  }

  if (!PLATFORMS.includes(body.platform as Platform)) {
    throw new ValidationError(
      `Invalid platform: ${body.platform}. Must be one of: ${PLATFORMS.join(", ")}`,
    );
  }

  const result = await initiateConnection(deps, actor.workspaceId, body.platform as Platform);
  return c.json({ data: result });
});

// ───────────────────────────────────────────
// GET /api/accounts/callback - OAuth コールバック（認証不要）
// ※ このルートは app.ts で認証ミドルウェアをバイパスする設定が必要
// ───────────────────────────────────────────
accounts.get("/callback", async (c) => {
  const db = c.get("db");
  const deps = buildDeps(db);

  const code = c.req.query("code");
  const state = c.req.query("state");
  const error = c.req.query("error");

  // OAuth プロバイダがエラーを返した場合
  if (error) {
    return c.json(
      {
        error: {
          code: "PROVIDER_OAUTH_ERROR",
          message: `OAuth authorization failed: ${error}`,
          details: {
            error,
            errorDescription: c.req.query("error_description"),
          },
        },
      },
      400,
    );
  }

  if (!code || !state) {
    throw new ValidationError("code and state query parameters are required");
  }

  const account = await handleOAuthCallback(deps, code, state);
  return c.json({ data: account });
});

// ───────────────────────────────────────────
// GET /api/accounts/expiring - 期限切れ間近のアカウント
// ───────────────────────────────────────────
accounts.get("/expiring", requirePermission("account:read"), async (c) => {
  const actor = c.get("actor");
  const db = c.get("db");
  const deps = buildDeps(db);

  const data = await checkTokenExpiry(deps, actor.workspaceId);
  return c.json({ data });
});

// ───────────────────────────────────────────
// GET /api/accounts/:id - アカウント詳細
// ───────────────────────────────────────────
accounts.get("/:id", requirePermission("account:read"), async (c) => {
  const db = c.get("db");
  const deps = buildDeps(db);
  const id = c.req.param("id");

  const data = await getAccount(deps, id);
  return c.json({ data });
});

// ───────────────────────────────────────────
// DELETE /api/accounts/:id - アカウント切断（論理削除）
// ───────────────────────────────────────────
accounts.delete("/:id", requirePermission("account:connect"), async (c) => {
  const db = c.get("db");
  const deps = buildDeps(db);
  const id = c.req.param("id");

  await disconnectAccount(deps, id);
  return c.json({ data: { success: true } });
});

// ───────────────────────────────────────────
// POST /api/accounts/:id/refresh - トークン更新
// ───────────────────────────────────────────
accounts.post("/:id/refresh", requirePermission("account:connect"), async (c) => {
  const db = c.get("db");
  const deps = buildDeps(db);
  const id = c.req.param("id");

  const data = await refreshAccountToken(deps, id);
  return c.json({ data });
});

export { accounts };
