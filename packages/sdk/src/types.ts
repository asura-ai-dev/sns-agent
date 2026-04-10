/**
 * API リクエスト/レスポンス型定義
 *
 * design.md セクション 4.3 の共通レスポンス形式 { data, meta } / { error } に準拠。
 * core のドメインエンティティ型を再利用可能な箇所は re-export する。
 */

import type { Platform } from "@sns-agent/config";

// ───────────────────────────────────────────
// core エンティティの re-export
// ───────────────────────────────────────────
export type {
  SocialAccount,
  Post,
  ScheduledJob,
  UsageRecord,
  MediaAttachment,
} from "@sns-agent/core";

export type { Platform } from "@sns-agent/config";

// ───────────────────────────────────────────
// 共通レスポンス形式
// ───────────────────────────────────────────

/** ページネーションメタ情報 */
export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
}

/** 成功レスポンス */
export interface ApiResponse<T> {
  data: T;
  meta?: PaginationMeta;
}

/** エラーレスポンス */
export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

// ───────────────────────────────────────────
// Accounts
// ───────────────────────────────────────────

export interface ConnectAccountInput {
  platform: Platform;
  redirectUrl: string;
  authorizationCode?: string;
  state?: string;
}

// ───────────────────────────────────────────
// Posts
// ───────────────────────────────────────────

export interface ListPostsParams {
  platform?: Platform;
  status?: string;
  page?: number;
  limit?: number;
}

export interface CreatePostInput {
  socialAccountId: string;
  platform: Platform;
  contentText?: string;
  contentMedia?: { type: "image" | "video"; url: string; mimeType: string }[];
  /** true で即時投稿、false/省略で下書き */
  publish?: boolean;
}

export interface UpdatePostInput {
  contentText?: string;
  contentMedia?: { type: "image" | "video"; url: string; mimeType: string }[];
}

// ───────────────────────────────────────────
// Schedules
// ───────────────────────────────────────────

export interface ListSchedulesParams {
  page?: number;
  limit?: number;
  status?: string;
}

export interface CreateScheduleInput {
  postId: string;
  scheduledAt: string; // ISO 8601
}

export interface UpdateScheduleInput {
  scheduledAt?: string; // ISO 8601
}

// ───────────────────────────────────────────
// Usage
// ───────────────────────────────────────────

export interface UsageReportParams {
  platform?: string;
  period?: "daily" | "weekly" | "monthly";
  from?: string; // ISO 8601 date
  to?: string; // ISO 8601 date
}

export interface UsageSummary {
  totalRequests: number;
  totalSuccesses: number;
  totalFailures: number;
  estimatedCostUsd: number;
}
