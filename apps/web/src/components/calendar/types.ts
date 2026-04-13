/**
 * カレンダー画面で扱う型
 *
 * Task 3007: 予約カレンダー画面
 *
 * API レスポンスの `GET /api/schedules` は `ScheduledJob` を返し、
 * `GET /api/posts/:id` は `Post` を返す。カレンダーでは両方を結合した
 * `CalendarEntry` を使って描画する。
 */
import type { Platform } from "@/components/settings/PlatformIcon";

export type JobStatus = "pending" | "locked" | "running" | "succeeded" | "failed" | "retrying";

export interface ScheduledJobDto {
  id: string;
  workspaceId: string;
  postId: string;
  scheduledAt: string; // ISO
  status: JobStatus;
  lockedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  attemptCount: number;
  maxAttempts: number;
  lastError: string | null;
  nextRetryAt: string | null;
  createdAt: string;
}

export interface PostDto {
  id: string;
  workspaceId: string;
  socialAccountId: string;
  platform: Platform;
  status: string;
  contentText: string | null;
  contentMedia: unknown;
  platformPostId: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

export interface ScheduleNotificationTargetDto {
  type: "post_creator" | "workspace_admin";
  actorId: string | null;
  label: string;
  reason: string;
}

export interface ScheduleExecutionLogDto {
  id: string;
  action: string;
  status: "succeeded" | "retrying" | "failed";
  createdAt: string;
  actorId: string;
  actorType: "user" | "agent" | "system";
  message: string;
  error: string | null;
  willRetry: boolean;
  retryable: boolean | null;
  retryRule: "retryable" | "non_retryable" | "exhausted" | "not_applicable";
  classificationReason: string | null;
  attemptCount: number | null;
  maxAttempts: number | null;
  nextRetryAt: string | null;
  notificationTarget: ScheduleNotificationTargetDto | null;
}

export interface ScheduleOperationalDetailDto {
  post: {
    id: string;
    status: string;
    platform: Platform;
    socialAccountId: string;
    contentText: string | null;
    createdBy: string | null;
  } | null;
  retryPolicy: {
    maxAttempts: number;
    backoffSeconds: number[];
    retryableRule: string;
    nonRetryableRule: string;
  };
  notificationTarget: ScheduleNotificationTargetDto;
  latestExecution: ScheduleExecutionLogDto | null;
  executionLogs: ScheduleExecutionLogDto[];
  recommendedAction: string;
}

/**
 * 月/週グリッドの 1 セルに表示する結合エントリ。
 * `post` は最初は null でも描画可能（fallback 時や取得失敗時）。
 */
export interface CalendarEntry {
  job: ScheduledJobDto;
  post: PostDto | null;
}

export type CalendarView = "month" | "week";
