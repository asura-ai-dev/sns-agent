/**
 * 共通定数定義
 * design.md セクション 6 / チケット 1002 の定義に準拠
 */

// --- Platform ---
export const PLATFORMS = ["x", "line", "instagram"] as const;
export type Platform = (typeof PLATFORMS)[number];

// --- Role ---
export const ROLES = ["viewer", "operator", "editor", "admin", "owner", "agent"] as const;
export type Role = (typeof ROLES)[number];

// --- PostStatus ---
export const POST_STATUSES = [
  "draft",
  "scheduled",
  "publishing",
  "published",
  "failed",
  "deleted",
] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

// --- JobStatus ---
export const JOB_STATUSES = [
  "pending",
  "locked",
  "running",
  "succeeded",
  "failed",
  "retrying",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

// --- AccountStatus ---
export const ACCOUNT_STATUSES = ["active", "expired", "revoked", "error"] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

// --- BudgetAction ---
export const BUDGET_ACTIONS = ["warn", "require-approval", "block"] as const;
export type BudgetAction = (typeof BUDGET_ACTIONS)[number];
