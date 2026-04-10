/**
 * Task 3006: 投稿一覧・作成の API クライアント。
 *
 * - 既存の `/api/...` 相対パターンに従う（ApprovalDialog, settings/accounts 等と整合）
 * - API 未起動時は { ok: false, error } を返して UI 側で fallback 表示できるようにする
 */

import type {
  MediaAttachment,
  Platform,
  Post,
  PostListFilters,
  PostListResponse,
  PostSocialAccount,
} from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

// ───────────────────────────────────────────
// 共通
// ───────────────────────────────────────────

export interface ApiFailure {
  ok: false;
  error: {
    code?: string;
    message: string;
    status?: number;
  };
}

export interface ApiSuccess<T> {
  ok: true;
  value: T;
}

export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

async function parseError(res: Response): Promise<ApiFailure> {
  let code: string | undefined;
  let message = `Request failed (${res.status})`;
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    if (body?.error?.message) message = body.error.message;
    if (body?.error?.code) code = body.error.code;
  } catch {
    // ignore parse error
  }
  return { ok: false, error: { code, message, status: res.status } };
}

function networkFailure(err: unknown): ApiFailure {
  const message = err instanceof Error ? err.message : "ネットワークに接続できませんでした";
  return { ok: false, error: { message, code: "NETWORK_ERROR" } };
}

// ───────────────────────────────────────────
// 投稿一覧
// ───────────────────────────────────────────

export async function fetchPosts(
  filters: PostListFilters,
  signal?: AbortSignal,
): Promise<ApiResult<PostListResponse>> {
  const qs = new URLSearchParams();
  for (const p of filters.platforms) qs.append("platform", p);
  for (const s of filters.statuses) qs.append("status", s);
  if (filters.from) qs.set("from", filters.from);
  if (filters.to) qs.set("to", filters.to);
  if (filters.search.trim()) qs.set("search", filters.search.trim());
  qs.set("page", String(filters.page));
  qs.set("limit", String(filters.limit));
  qs.set("orderBy", "createdAt");

  try {
    const res = await fetch(`${API_BASE}/api/posts?${qs.toString()}`, {
      credentials: "include",
      signal,
    });
    if (!res.ok) return await parseError(res);
    const body = (await res.json()) as PostListResponse;
    return { ok: true, value: body };
  } catch (err) {
    if ((err as { name?: string })?.name === "AbortError") {
      return { ok: false, error: { message: "aborted", code: "ABORTED" } };
    }
    return networkFailure(err);
  }
}

export async function deletePostApi(id: string): Promise<ApiResult<Post>> {
  try {
    const res = await fetch(`${API_BASE}/api/posts/${encodeURIComponent(id)}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (!res.ok) return await parseError(res);
    const body = (await res.json()) as { data: Post };
    return { ok: true, value: body.data };
  } catch (err) {
    return networkFailure(err);
  }
}

export async function publishPostApi(id: string): Promise<ApiResult<Post>> {
  try {
    const res = await fetch(`${API_BASE}/api/posts/${encodeURIComponent(id)}/publish`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (!res.ok && res.status !== 202) return await parseError(res);
    const body = (await res.json()) as { data: Post };
    return { ok: true, value: body.data };
  } catch (err) {
    return networkFailure(err);
  }
}

// ───────────────────────────────────────────
// 接続済みアカウント取得（投稿作成の SNS 選択用）
// ───────────────────────────────────────────

export async function fetchConnectedAccounts(
  signal?: AbortSignal,
): Promise<ApiResult<PostSocialAccount[]>> {
  try {
    const res = await fetch(`${API_BASE}/api/accounts`, {
      credentials: "include",
      signal,
    });
    if (!res.ok) return await parseError(res);
    const body = (await res.json()) as { data: PostSocialAccount[] };
    // active のみ露出
    const accounts = (body.data ?? []).filter((a) => !a.status || a.status === "active");
    return { ok: true, value: accounts };
  } catch (err) {
    if ((err as { name?: string })?.name === "AbortError") {
      return { ok: false, error: { message: "aborted", code: "ABORTED" } };
    }
    return networkFailure(err);
  }
}

// ───────────────────────────────────────────
// 投稿作成
// ───────────────────────────────────────────

export interface CreatePostInput {
  socialAccountId: string;
  contentText: string;
  contentMedia: MediaAttachment[];
  publishNow: boolean;
  idempotencyKey?: string | null;
}

export async function createPostApi(input: CreatePostInput): Promise<ApiResult<Post>> {
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (input.idempotencyKey) headers["X-Idempotency-Key"] = input.idempotencyKey;
    const res = await fetch(`${API_BASE}/api/posts`, {
      method: "POST",
      credentials: "include",
      headers,
      body: JSON.stringify({
        socialAccountId: input.socialAccountId,
        contentText: input.contentText,
        contentMedia: input.contentMedia.length > 0 ? input.contentMedia : null,
        publishNow: input.publishNow,
      }),
    });
    if (!res.ok && res.status !== 201 && res.status !== 202) {
      return await parseError(res);
    }
    const body = (await res.json()) as { data: Post };
    return { ok: true, value: body.data };
  } catch (err) {
    return networkFailure(err);
  }
}

// Re-export helper used by tests / stories
export type { Platform };
