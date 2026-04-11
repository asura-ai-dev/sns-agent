/**
 * 自動監査記録ミドルウェア
 *
 * Task 6001: 書き込み系エンドポイント（POST / PATCH / DELETE）の完了後に
 * 自動で監査ログを記録する。
 *
 * design.md セクション 4.4 ミドルウェアチェーン、セクション 3.1 audit_logs に準拠。
 *
 * 動作:
 * 1. ハンドラ実行前にリクエストボディのサニタイズ済みサマリを作成
 * 2. next() でハンドラ実行
 * 3. ハンドラ完了後、レスポンスの status と概要を取得
 * 4. recordAudit usecase で追記（失敗してもハンドラの応答には影響させない）
 */
import type { MiddlewareHandler } from "hono";
import { recordAudit } from "@sns-agent/core";
import type { Actor, AuditActorType } from "@sns-agent/core";
import { DrizzleAuditLogRepository } from "@sns-agent/db";
import type { DbClient } from "@sns-agent/db";

/**
 * 監査対象から除外するパス（ヘルスチェック、Webhook、監査ログ参照自身）
 */
const EXCLUDED_PATHS = ["/api/health", "/api/webhooks", "/api/audit"];

/**
 * 機密情報を含むキー名（input_summary から削除）
 */
const SENSITIVE_KEYS = new Set([
  "password",
  "token",
  "api_key",
  "apiKey",
  "access_token",
  "accessToken",
  "refresh_token",
  "refreshToken",
  "secret",
  "authorization",
  "credentials",
  "credentials_encrypted",
  "credentialsEncrypted",
  "api_key_hash",
  "apiKeyHash",
]);

/**
 * オブジェクトから機密情報を再帰的に削除する。
 * 最大深度 5、最大要素数 50 でクリップ。
 */
function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[truncated: max depth]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    return value.length > 500 ? value.slice(0, 500) + "…" : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    const limited = value.slice(0, 50);
    return limited.map((item) => sanitize(item, depth + 1));
  }
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 50);
    for (const [key, val] of entries) {
      if (SENSITIVE_KEYS.has(key) || SENSITIVE_KEYS.has(key.toLowerCase())) {
        result[key] = "[REDACTED]";
        continue;
      }
      result[key] = sanitize(val, depth + 1);
    }
    return result;
  }
  return String(value);
}

/**
 * パスから resource_type を推定する。
 * 例: /api/posts -> "post", /api/accounts/:id -> "account"
 */
function extractResourceType(path: string): string {
  const parts = path.split("/").filter(Boolean);
  // /api/<resource>/... -> resource (単数化: posts -> post)
  const resource = parts[1] ?? "unknown";
  // 簡易単数化
  if (resource.endsWith("s") && !resource.endsWith("ss")) {
    return resource.slice(0, -1);
  }
  return resource;
}

/**
 * パスから resource_id を抽出する（UUID 形式の path segment があれば採用）。
 */
function extractResourceId(path: string): string | null {
  const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const match = path.match(uuidPattern);
  return match ? match[0] : null;
}

/**
 * クエリパラメータから platform を抽出する（あれば）。
 */
function extractPlatform(query: Record<string, string | undefined>): string | null {
  const platform = query.platform;
  if (platform && ["x", "line", "instagram"].includes(platform)) {
    return platform;
  }
  return null;
}

/**
 * リクエストボディを安全に読み取る（JSON のみ）。
 * ハンドラが既に body を読んでいる可能性があるため try/catch で握る。
 */
async function readBodySafely(c: {
  req: { header: (name: string) => string | undefined; raw: Request };
}): Promise<unknown | null> {
  const contentType = c.req.header("content-type") ?? "";
  if (!contentType.includes("application/json")) return null;
  try {
    const cloned = c.req.raw.clone();
    const text = await cloned.text();
    if (!text) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * 自動監査記録ミドルウェア。
 * 書き込み系メソッド（POST / PATCH / PUT / DELETE）の完了後に監査ログを記録する。
 */
export const auditMiddleware: MiddlewareHandler = async (c, next) => {
  const method = c.req.method.toUpperCase();
  const path = c.req.path;

  // 書き込み系以外はスキップ
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    await next();
    return;
  }

  // 除外パスはスキップ
  if (EXCLUDED_PATHS.some((excluded) => path.startsWith(excluded))) {
    await next();
    return;
  }

  // リクエストボディのサニタイズ済みサマリを事前取得
  const rawBody = await readBodySafely(c);
  const inputSummary = {
    method,
    path,
    query: c.req.query(),
    body: rawBody !== null ? sanitize(rawBody) : null,
  };

  // ハンドラ実行
  await next();

  // actor は認証ミドルウェアがセット済みのはず。未認証なら記録しない
  const actor = c.get("actor") as Actor | undefined;
  if (!actor) return;

  // レスポンス情報を取得
  const status = c.res.status;
  const success = status >= 200 && status < 400;
  const resultSummary: Record<string, unknown> = {
    status,
    success,
  };

  // エラー時はエラーコードを含める
  if (!success) {
    try {
      const cloned = c.res.clone();
      const text = await cloned.text();
      if (text) {
        try {
          const parsed = JSON.parse(text);
          resultSummary.error = sanitize(parsed);
        } catch {
          resultSummary.error = text.slice(0, 200);
        }
      }
    } catch {
      // レスポンス読み取り失敗は無視
    }
  }

  // 監査ログ記録
  const db = c.get("db") as DbClient | undefined;
  if (!db) return;

  const requestId = (c.get("requestId") as string | undefined) ?? null;
  const resourceType = extractResourceType(path);
  const resourceId = extractResourceId(path);
  const query = c.req.query();
  const platform = extractPlatform(query);
  const actorType: AuditActorType = actor.type === "user" ? "user" : "agent";

  try {
    const repo = new DrizzleAuditLogRepository(db);
    await recordAudit(repo, {
      workspaceId: actor.workspaceId,
      actorId: actor.id,
      actorType,
      action: `${method} ${path}`,
      resourceType,
      resourceId,
      platform,
      socialAccountId: null,
      inputSummary,
      resultSummary,
      estimatedCostUsd: null,
      requestId,
    });
  } catch (err) {
    // 監査ログ記録の失敗はハンドラの応答に影響させない
    // ただしコンソールに警告を出す
    console.warn("[audit] Failed to record audit log:", err);
  }
};
