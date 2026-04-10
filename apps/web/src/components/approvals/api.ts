/**
 * 承認 API フェッチヘルパー。
 * Task 6002: /api/approvals を叩く。認証は browser cookie / dev 環境では失敗しても空配列を返す。
 */
import type { ApprovalRequestDto, ApprovalStatus, ListApprovalsResponse } from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

/**
 * 承認リクエスト一覧を取得する。
 * fail-open: 認証失敗・ネットワークエラー時は空配列を返す（Header を壊さない）。
 */
export async function fetchApprovals(
  status: ApprovalStatus = "pending",
  limit = 10,
): Promise<ListApprovalsResponse> {
  const empty: ListApprovalsResponse = {
    data: [],
    meta: { page: 1, limit, total: 0, pendingCount: 0, status },
  };
  try {
    const res = await fetch(`${API_BASE}/api/approvals?status=${status}&limit=${limit}&page=1`, {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return empty;
    const json = (await res.json()) as ListApprovalsResponse;
    return json;
  } catch {
    return empty;
  }
}

export async function approveApproval(id: string): Promise<ApprovalRequestDto | null> {
  try {
    const res = await fetch(`${API_BASE}/api/approvals/${id}/approve`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data: { request: ApprovalRequestDto } };
    return json.data.request;
  } catch {
    return null;
  }
}

export async function rejectApproval(
  id: string,
  reason?: string,
): Promise<ApprovalRequestDto | null> {
  try {
    const res = await fetch(`${API_BASE}/api/approvals/${id}/reject`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: reason ?? null }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data: ApprovalRequestDto };
    return json.data;
  } catch {
    return null;
  }
}
