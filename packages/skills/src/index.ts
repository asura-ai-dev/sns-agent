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

// Manifest parser & version compat (Task 5003)
export {
  parseManifest,
  validateManifest,
  checkVersionCompatibility,
  SKILL_MANIFEST_RUNTIME_VERSION,
} from "./manifest/parser.js";
export type { VersionCompatibilityResult } from "./manifest/parser.js";

// Builder (Task 5003)
export {
  generateSkillPackage,
  buildSkillPackageName,
  SKILL_PACKAGE_DEFAULT_VERSION,
  BUILTIN_ACTION_TEMPLATES,
} from "./builder/index.js";
export type {
  GenerateSkillPackageInput,
  SkillPackageBuilderDeps,
  SkillActionTemplate,
} from "./builder/index.js";

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
