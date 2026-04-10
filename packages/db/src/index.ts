/**
 * @sns-agent/db - DB スキーマ + リポジトリ実装パッケージ
 *
 * Drizzle ORM ベースの永続化レイヤ。
 * core/interfaces の Repository を具象実装する。
 */

// DB client
export { getDb, resetDb } from "./client.js";
export type { DbClient } from "./client.js";

// Schema (テーブル定義)
export * from "./schema/index.js";

// Repository 実装
export {
  DrizzleAccountRepository,
  DrizzlePostRepository,
  DrizzleScheduledJobRepository,
  DrizzleUsageRepository,
  DrizzleBudgetPolicyRepository,
  DrizzleLlmRouteRepository,
  DrizzleSkillPackageRepository,
  DrizzleAuditLogRepository,
  DrizzleUserRepository,
  DrizzleAgentIdentityRepository,
  DrizzleApprovalRepository,
  DrizzleConversationRepository,
  DrizzleMessageRepository,
} from "./repositories/index.js";
export type { UserRepository, AgentIdentityRepository } from "./repositories/index.js";
