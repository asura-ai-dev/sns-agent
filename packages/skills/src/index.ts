/**
 * @sns-agent/skills - manifest 駆動 skill 実行基盤
 *
 * Task 5002: manifest 型 + バリデーション + 実行ランタイム (Skill Executor) を提供する。
 * architecture.md セクション 8.4 (Skill Planner / Executor) / 8.5 (実行モード) に準拠。
 */

// Manifest
export { validateSkillManifest, findSkillAction } from "./manifest/types.js";
export type {
  SkillManifest,
  SkillAction,
  SkillJsonSchema,
  SkillPlatform,
  SkillLlmProvider,
  ManifestValidationResult,
} from "./manifest/types.js";

// Runtime
export {
  validateSkillAction,
  checkSkillPermissions,
  executeSkillAction,
  dryRunSkillAction,
} from "./runtime/executor.js";
export type {
  SkillExecutionMode,
  SkillActor,
  SkillExecutionContext,
  SkillExecutorDeps,
  SkillActionInvoker,
  SkillBudgetGuard,
  SkillArgValidationResult,
  SkillPermissionCheckResult,
  SkillExecutionResult,
  SkillDryRunResult,
} from "./runtime/executor.js";
