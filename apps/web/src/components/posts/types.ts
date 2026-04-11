/**
 * Task 3006: 投稿一覧・作成画面の共通型。
 *
 * API レスポンスに合わせて定義する。サーバー側の型をそのまま import せず、
 * Web UI から見たワイヤ形状として軽量に保つ。
 */

import type { Platform } from "@/components/settings/PlatformIcon";

export type { Platform };

export type PostStatus = "draft" | "scheduled" | "publishing" | "published" | "failed" | "deleted";

export interface MediaAttachment {
  type: "image" | "video";
  url: string;
  mimeType?: string | null;
  name?: string | null;
}

export interface PostSocialAccount {
  id: string;
  displayName: string;
  externalAccountId?: string | null;
  platform: Platform;
  status?: "active" | "expired" | "revoked" | "error";
}

export interface PostScheduleInfo {
  id: string;
  scheduledAt: string;
  status: "pending" | "locked" | "running" | "succeeded" | "failed" | "retrying";
}

export interface Post {
  id: string;
  workspaceId: string;
  socialAccountId: string;
  platform: Platform;
  status: PostStatus;
  contentText: string | null;
  contentMedia: MediaAttachment[] | null;
  platformPostId?: string | null;
  validationResult?: unknown;
  idempotencyKey?: string | null;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string | null;
  socialAccount?: PostSocialAccount | null;
  schedule?: PostScheduleInfo | null;
}

export interface PostListMeta {
  page: number;
  limit: number;
  total: number;
}

export interface PostListResponse {
  data: Post[];
  meta: PostListMeta;
}

export interface PostListFilters {
  platforms: Platform[];
  statuses: PostStatus[];
  from: string | null;
  to: string | null;
  search: string;
  page: number;
  limit: number;
}

export const POST_STATUSES: PostStatus[] = [
  "draft",
  "scheduled",
  "publishing",
  "published",
  "failed",
  "deleted",
];

export const ALL_PLATFORMS: Platform[] = ["x", "line", "instagram"];
