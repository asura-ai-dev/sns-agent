/**
 * 監査ログユースケース
 *
 * Task 6001: 監査ログの記録・一覧取得・エクスポート。
 * design.md セクション 3.1 (audit_logs)、セクション 4.2 (監査エンドポイント) に準拠。
 */
import type { AuditLog, AuditActorType } from "../domain/entities.js";
import type { AuditLogRepository, AuditLogFilterOptions } from "../interfaces/repositories.js";

// ───────────────────────────────────────────
// Input 型
// ───────────────────────────────────────────

export interface RecordAuditInput {
  workspaceId: string;
  actorId: string;
  actorType: AuditActorType;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  platform?: string | null;
  socialAccountId?: string | null;
  inputSummary?: unknown | null;
  resultSummary?: unknown | null;
  estimatedCostUsd?: number | null;
  requestId?: string | null;
}

export interface ListAuditLogsInput {
  workspaceId: string;
  filters?: Omit<AuditLogFilterOptions, "limit" | "offset">;
  page?: number;
  limit?: number;
}

export interface ListAuditLogsResult {
  data: AuditLog[];
  meta: {
    page: number;
    limit: number;
    total: number;
  };
}

export interface ExportAuditLogsInput {
  workspaceId: string;
  filters?: Omit<AuditLogFilterOptions, "limit" | "offset">;
  format?: "json";
}

// ───────────────────────────────────────────
// ユースケース関数
// ───────────────────────────────────────────

/**
 * 監査ログを記録する。追記のみ。
 */
export async function recordAudit(
  repo: AuditLogRepository,
  input: RecordAuditInput,
): Promise<AuditLog> {
  return repo.create({
    workspaceId: input.workspaceId,
    actorId: input.actorId,
    actorType: input.actorType,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId ?? null,
    platform: input.platform ?? null,
    socialAccountId: input.socialAccountId ?? null,
    inputSummary: input.inputSummary ?? null,
    resultSummary: input.resultSummary ?? null,
    estimatedCostUsd: input.estimatedCostUsd ?? null,
    requestId: input.requestId ?? null,
    createdAt: new Date(),
  });
}

/**
 * 監査ログ一覧を取得する（フィルタ + ページネーション）。
 */
export async function listAuditLogs(
  repo: AuditLogRepository,
  input: ListAuditLogsInput,
): Promise<ListAuditLogsResult> {
  const page = input.page ?? 1;
  const limit = input.limit ?? 50;
  const offset = (page - 1) * limit;

  const filterOptions: AuditLogFilterOptions = {
    ...input.filters,
    limit,
    offset,
  };

  const [data, total] = await Promise.all([
    repo.findByWorkspace(input.workspaceId, filterOptions),
    repo.countByWorkspace(input.workspaceId, input.filters),
  ]);

  return {
    data,
    meta: { page, limit, total },
  };
}

/**
 * 監査ログをエクスポートする（v1 では JSON のみ）。
 */
export async function exportAuditLogs(
  repo: AuditLogRepository,
  input: ExportAuditLogsInput,
): Promise<{ format: "json"; data: AuditLog[] }> {
  // v1 では全件取得（制限: 10000件）
  const data = await repo.findByWorkspace(input.workspaceId, {
    ...input.filters,
    limit: 10000,
    offset: 0,
  });

  return { format: "json", data };
}
