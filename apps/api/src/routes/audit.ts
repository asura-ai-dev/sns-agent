/**
 * 監査ログルート
 *
 * Task 6001: 監査ログの検索・参照 API。
 * design.md セクション 4.2: GET /api/audit
 *
 * RBAC: audit:read 権限（admin 以上）を要求する。
 * 追記のみのテーブルであり、このエンドポイントは読み取り専用。
 */
import { Hono } from "hono";
import { listAuditLogs, exportAuditLogs } from "@sns-agent/core";
import { DrizzleAuditLogRepository } from "@sns-agent/db";
import { requirePermission } from "../middleware/rbac.js";
import type { AppVariables } from "../types.js";

const audit = new Hono<{ Variables: AppVariables }>();

/**
 * クエリパラメータをパースして filters オブジェクトに変換する。
 */
function parseFilters(query: Record<string, string | undefined>) {
  const filters: {
    actorId?: string;
    actorType?: string;
    action?: string;
    resourceType?: string;
    platform?: string;
    startDate?: Date;
    endDate?: Date;
  } = {};

  if (query.actorId) filters.actorId = query.actorId;
  if (query.actorType && ["user", "agent", "system"].includes(query.actorType)) {
    filters.actorType = query.actorType;
  }
  if (query.action) filters.action = query.action;
  if (query.resourceType) filters.resourceType = query.resourceType;
  if (query.platform && ["x", "line", "instagram"].includes(query.platform)) {
    filters.platform = query.platform;
  }
  if (query.from) {
    const d = new Date(query.from);
    if (!isNaN(d.getTime())) filters.startDate = d;
  }
  if (query.to) {
    const d = new Date(query.to);
    if (!isNaN(d.getTime())) filters.endDate = d;
  }

  return filters;
}

function parsePagination(query: Record<string, string | undefined>) {
  const page = Math.max(1, parseInt(query.page ?? "1", 10) || 1);
  const rawLimit = parseInt(query.limit ?? "50", 10) || 50;
  const limit = Math.max(1, Math.min(200, rawLimit));
  return { page, limit };
}

// ───────────────────────────────────────────
// GET /api/audit - 監査ログ一覧
// ───────────────────────────────────────────
audit.get("/", requirePermission("audit:read"), async (c) => {
  const actor = c.get("actor");
  const db = c.get("db");
  const query = c.req.query();

  // export モード（format=json & export=true で全件 JSON 出力）
  if (query.format === "json" && query.export === "true") {
    const filters = parseFilters(query);
    const repo = new DrizzleAuditLogRepository(db);
    const result = await exportAuditLogs(repo, {
      workspaceId: actor.workspaceId,
      filters,
      format: "json",
    });
    const data = result.data.map((log) => ({
      ...log,
      createdAt: log.createdAt instanceof Date ? log.createdAt.toISOString() : log.createdAt,
    }));
    return c.json({ data, meta: { format: "json", total: data.length } });
  }

  const filters = parseFilters(query);
  const { page, limit } = parsePagination(query);

  const repo = new DrizzleAuditLogRepository(db);
  const result = await listAuditLogs(repo, {
    workspaceId: actor.workspaceId,
    filters,
    page,
    limit,
  });

  // createdAt を ISO 文字列で返す（JSON シリアライズの一貫性のため）
  const data = result.data.map((log) => ({
    ...log,
    createdAt: log.createdAt instanceof Date ? log.createdAt.toISOString() : log.createdAt,
  }));

  return c.json({ data, meta: result.meta });
});

export { audit };
