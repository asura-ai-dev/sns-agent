/**
 * 承認フローの DTO 型定義
 * GET /api/approvals のレスポンス形状に対応
 */

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";

export interface ApprovalRequestDto {
  id: string;
  workspaceId: string;
  resourceType: string;
  resourceId: string;
  requestedBy: string;
  requestedAt: string; // ISO
  status: ApprovalStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reason: string | null;
}

export interface ListApprovalsResponse {
  data: ApprovalRequestDto[];
  meta: {
    page: number;
    limit: number;
    total: number;
    pendingCount: number;
    status: ApprovalStatus;
  };
}
