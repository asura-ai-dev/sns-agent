/**
 * 承認フローユースケース
 *
 * Task 6002: 承認リクエストの作成、承認、却下、一覧、期限切れ処理。
 * design.md セクション 3.1（approval_requests）、4.2（承認エンドポイント）に準拠。
 *
 * 承認されたリクエストは、resourceType に応じて元の操作（例: 投稿公開）を実行する。
 * 元操作の実行関数は依存注入（approvalExecutors）で受け取り、循環依存を避ける。
 */
import type { ApprovalRequest, ApprovalStatus, AuditActorType } from "../domain/entities.js";
import type {
  ApprovalFilterOptions,
  ApprovalRepository,
  AuditLogRepository,
} from "../interfaces/repositories.js";
import { NotFoundError, ValidationError, AuthorizationError } from "../errors/domain-error.js";
import { recordAudit } from "./audit.js";

// ───────────────────────────────────────────
// 依存注入コンテキスト
// ───────────────────────────────────────────

/**
 * 承認後に元操作を実行する関数のマップ。
 * キーは resourceType（例: "post"）、値は resourceId を受け取り実行する非同期関数。
 * 循環依存を避けるため、呼び出し側（apps/api 等）で構築する。
 */
export interface ApprovalExecutor {
  /**
   * 元の操作を実行する。
   * @param resourceId 対象リソース ID
   * @param context 実行コンテキスト（workspaceId, approvedBy など）
   * @returns 実行結果（任意の形）
   */
  (resourceId: string, context: { workspaceId: string; approvedBy: string }): Promise<unknown>;
}

export interface ApprovalUsecaseDeps {
  approvalRepo: ApprovalRepository;
  auditRepo: AuditLogRepository;
  /**
   * resourceType -> 実行関数。
   * 例: { post: publishPostByApproval }
   */
  executors?: Map<string, ApprovalExecutor>;
}

// ───────────────────────────────────────────
// 入出力型
// ───────────────────────────────────────────

export interface CreateApprovalRequestInput {
  workspaceId: string;
  resourceType: string;
  resourceId: string;
  requestedBy: string;
  requestedByType?: AuditActorType;
  reason?: string | null;
}

export interface ApproveRequestInput {
  requestId: string;
  reviewerId: string;
  reviewerType?: AuditActorType;
}

export interface RejectRequestInput {
  requestId: string;
  reviewerId: string;
  reviewerType?: AuditActorType;
  reason?: string | null;
}

export interface ListPendingApprovalsInput {
  workspaceId: string;
  filters?: ApprovalFilterOptions;
  page?: number;
  limit?: number;
}

export interface ListApprovalsResult {
  data: ApprovalRequest[];
  meta: {
    page: number;
    limit: number;
    total: number;
  };
}

export interface ApproveResult {
  request: ApprovalRequest;
  /** executor が返した任意の結果 */
  executionResult: unknown | null;
  /** executor が登録されていなかった場合 true */
  executorMissing: boolean;
}

// ───────────────────────────────────────────
// デフォルト設定
// ───────────────────────────────────────────

/**
 * pending が expired に遷移するまでの経過時間（ミリ秒）。
 * 仕様: 24 時間。
 */
export const APPROVAL_STALE_MS = 24 * 60 * 60 * 1000;

// ───────────────────────────────────────────
// ユースケース: createApprovalRequest
// ───────────────────────────────────────────

/**
 * 承認リクエストを作成する。status は 'pending'。
 * 監査ログに `approval.create` を記録する。
 */
export async function createApprovalRequest(
  deps: ApprovalUsecaseDeps,
  input: CreateApprovalRequestInput,
): Promise<ApprovalRequest> {
  if (!input.resourceType) {
    throw new ValidationError("resourceType is required");
  }
  if (!input.resourceId) {
    throw new ValidationError("resourceId is required");
  }
  if (!input.requestedBy) {
    throw new ValidationError("requestedBy is required");
  }

  const created = await deps.approvalRepo.create({
    workspaceId: input.workspaceId,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    requestedBy: input.requestedBy,
    requestedAt: new Date(),
    status: "pending",
    reviewedBy: null,
    reviewedAt: null,
    reason: input.reason ?? null,
  });

  await recordAudit(deps.auditRepo, {
    workspaceId: input.workspaceId,
    actorId: input.requestedBy,
    actorType: input.requestedByType ?? "user",
    action: "approval.create",
    resourceType: "approval_request",
    resourceId: created.id,
    inputSummary: {
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      reason: input.reason ?? null,
    },
    resultSummary: { status: "pending" },
  });

  return created;
}

// ───────────────────────────────────────────
// ユースケース: approveRequest
// ───────────────────────────────────────────

/**
 * 承認リクエストを承認し、登録された executor で元操作を実行する。
 *
 * フロー:
 * 1. request を取得し pending であることを確認
 * 2. status を 'approved' に更新
 * 3. executors から resourceType に対応する実行関数を取得し呼び出し
 *    - 失敗時: 監査ログに失敗を記録するが request の status は approved のまま
 *    - executor 未登録: executorMissing=true で返す（request は承認済み）
 * 4. 監査ログに approval.approve を記録
 */
export async function approveRequest(
  deps: ApprovalUsecaseDeps,
  input: ApproveRequestInput,
): Promise<ApproveResult> {
  const request = await deps.approvalRepo.findById(input.requestId);
  if (!request) {
    throw new NotFoundError("ApprovalRequest", input.requestId);
  }

  if (request.status !== "pending") {
    throw new ValidationError(
      `ApprovalRequest ${request.id} is not pending (current: ${request.status})`,
    );
  }

  // レビュアーが自分で作成したリクエストを承認するのは禁止（簡易チェック）
  if (request.requestedBy === input.reviewerId) {
    throw new AuthorizationError("Requester cannot approve their own request", {
      requestId: request.id,
      reviewerId: input.reviewerId,
    });
  }

  const updated = await deps.approvalRepo.update(request.id, {
    status: "approved",
    reviewedBy: input.reviewerId,
    reviewedAt: new Date(),
  });

  // executor で元操作を実行
  let executionResult: unknown | null = null;
  let executorMissing = false;
  let executionError: string | null = null;

  const executor = deps.executors?.get(request.resourceType);
  if (!executor) {
    executorMissing = true;
  } else {
    try {
      executionResult = await executor(request.resourceId, {
        workspaceId: request.workspaceId,
        approvedBy: input.reviewerId,
      });
    } catch (err) {
      executionError = err instanceof Error ? err.message : String(err);
    }
  }

  // 監査ログ記録
  await recordAudit(deps.auditRepo, {
    workspaceId: request.workspaceId,
    actorId: input.reviewerId,
    actorType: input.reviewerType ?? "user",
    action: "approval.approve",
    resourceType: "approval_request",
    resourceId: request.id,
    inputSummary: {
      resourceType: request.resourceType,
      resourceId: request.resourceId,
    },
    resultSummary: {
      status: "approved",
      executorMissing,
      executionError,
    },
  });

  return {
    request: updated,
    executionResult,
    executorMissing,
  };
}

// ───────────────────────────────────────────
// ユースケース: rejectRequest
// ───────────────────────────────────────────

/**
 * 承認リクエストを却下する。
 * pending 以外のリクエストを却下しようとした場合は ValidationError。
 */
export async function rejectRequest(
  deps: ApprovalUsecaseDeps,
  input: RejectRequestInput,
): Promise<ApprovalRequest> {
  const request = await deps.approvalRepo.findById(input.requestId);
  if (!request) {
    throw new NotFoundError("ApprovalRequest", input.requestId);
  }

  if (request.status !== "pending") {
    throw new ValidationError(
      `ApprovalRequest ${request.id} is not pending (current: ${request.status})`,
    );
  }

  const updated = await deps.approvalRepo.update(request.id, {
    status: "rejected",
    reviewedBy: input.reviewerId,
    reviewedAt: new Date(),
    reason: input.reason ?? request.reason,
  });

  await recordAudit(deps.auditRepo, {
    workspaceId: request.workspaceId,
    actorId: input.reviewerId,
    actorType: input.reviewerType ?? "user",
    action: "approval.reject",
    resourceType: "approval_request",
    resourceId: request.id,
    inputSummary: {
      resourceType: request.resourceType,
      resourceId: request.resourceId,
      reason: input.reason ?? null,
    },
    resultSummary: { status: "rejected" },
  });

  return updated;
}

// ───────────────────────────────────────────
// ユースケース: listPendingApprovals / listApprovals
// ───────────────────────────────────────────

/**
 * ワークスペースの承認リクエスト一覧を返す。
 * status 未指定時は 'pending' をデフォルトとする。
 */
export async function listApprovals(
  deps: ApprovalUsecaseDeps,
  input: ListPendingApprovalsInput,
): Promise<ListApprovalsResult> {
  const page = input.page && input.page > 0 ? input.page : 1;
  const limit = input.limit && input.limit > 0 ? Math.min(input.limit, 200) : 50;
  const offset = (page - 1) * limit;

  const filterBase: Omit<ApprovalFilterOptions, "limit" | "offset"> = {
    status: input.filters?.status,
    resourceType: input.filters?.resourceType,
    requestedBy: input.filters?.requestedBy,
  };

  const [data, total] = await Promise.all([
    deps.approvalRepo.findByWorkspace(input.workspaceId, {
      ...filterBase,
      limit,
      offset,
    }),
    deps.approvalRepo.countByWorkspace(input.workspaceId, filterBase),
  ]);

  return {
    data,
    meta: { page, limit, total },
  };
}

/**
 * 承認待ちの件数を取得する（Header バッジ等で使用）。
 */
export async function countPendingApprovals(
  deps: ApprovalUsecaseDeps,
  workspaceId: string,
): Promise<number> {
  return deps.approvalRepo.countByWorkspace(workspaceId, { status: "pending" });
}

/**
 * pending の承認待ちのみを返すショートカット。
 */
export async function listPendingApprovals(
  deps: ApprovalUsecaseDeps,
  workspaceId: string,
  page = 1,
  limit = 50,
): Promise<ListApprovalsResult> {
  return listApprovals(deps, {
    workspaceId,
    filters: { status: "pending" },
    page,
    limit,
  });
}

// ───────────────────────────────────────────
// ユースケース: expireStaleRequests
// ───────────────────────────────────────────

/**
 * 一定期間（デフォルト 24h）経過した pending を expired に更新する。
 * 戻り値は expired に遷移した件数。
 */
export async function expireStaleRequests(
  deps: ApprovalUsecaseDeps,
  staleMs: number = APPROVAL_STALE_MS,
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - staleMs);
  const count = await deps.approvalRepo.expirePending(cutoff);
  return count;
}

// ───────────────────────────────────────────
// ユースケース: getApprovalRequest
// ───────────────────────────────────────────

export async function getApprovalRequest(
  deps: ApprovalUsecaseDeps,
  workspaceId: string,
  requestId: string,
): Promise<ApprovalRequest> {
  const request = await deps.approvalRepo.findById(requestId);
  if (!request || request.workspaceId !== workspaceId) {
    throw new NotFoundError("ApprovalRequest", requestId);
  }
  return request;
}

// ───────────────────────────────────────────
// 型 export（resource type 別 status）
// ───────────────────────────────────────────

export type { ApprovalStatus };
