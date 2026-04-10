/**
 * @sns-agent/config - 共通設定パッケージ
 *
 * 全パッケージが参照する環境変数バリデーション・定数定義・型安全な設定アクセスを提供する。
 */

// 環境変数
export { envSchema, getConfig, resetConfigCache } from "./env.js";
export type { EnvConfig } from "./env.js";

// 定数
export {
  PLATFORMS,
  ROLES,
  POST_STATUSES,
  JOB_STATUSES,
  ACCOUNT_STATUSES,
  BUDGET_ACTIONS,
} from "./constants.js";
export type {
  Platform,
  Role,
  PostStatus,
  JobStatus,
  AccountStatus,
  BudgetAction,
} from "./constants.js";
