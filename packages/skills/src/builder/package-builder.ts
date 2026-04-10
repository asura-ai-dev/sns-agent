/**
 * Skill Package Builder (Task 5003)
 *
 * platform + LLM provider の組み合わせに対して manifest を生成する。
 *
 * 設計方針:
 *  - ProviderRegistry から SocialProvider を取得し、capability ベースで
 *    BUILTIN_ACTION_TEMPLATES の中から採用する action を決める
 *  - manifest 名は決定論的に "sns-agent-<platform>-<provider>" で生成する
 *  - 同一 (workspace, name) の重複は呼び出し側 (usecase) が check する
 *  - 生成された manifest は validateSkillManifest を必ず通過することを保証する
 *
 * design.md セクション 1.6 (skills 配布フォーマット), architecture.md
 * セクション 8.4 (Skill Planner / Executor) に準拠。
 */
import type { Platform } from "@sns-agent/config";
import type { ProviderCapabilities, ProviderRegistry } from "@sns-agent/core";
import { ValidationError } from "@sns-agent/core";
import {
  validateSkillManifest,
  type SkillAction,
  type SkillLlmProvider,
  type SkillManifest,
  type SkillPlatform,
} from "../manifest/types.js";
import { BUILTIN_ACTION_TEMPLATES, type SkillActionTemplate } from "./templates.js";

// ───────────────────────────────────────────
// 入出力型
// ───────────────────────────────────────────

export interface GenerateSkillPackageInput {
  platform: SkillPlatform;
  llmProvider: SkillLlmProvider;
  /**
   * バージョン文字列。省略時は SKILL_PACKAGE_DEFAULT_VERSION を使う。
   * semver パターン (`major.minor.patch`) でなければ validateSkillManifest で reject される。
   */
  version?: string;
}

/** 既定の skill package バージョン */
export const SKILL_PACKAGE_DEFAULT_VERSION = "0.1.0";

/**
 * generateSkillPackage の依存。
 *  - providerRegistry: capability 取得元
 *  - templates: 採用候補テンプレート (テスト差し替え用、既定は BUILTIN_ACTION_TEMPLATES)
 */
export interface SkillPackageBuilderDeps {
  providerRegistry: ProviderRegistry;
  templates?: SkillActionTemplate[];
}

// ───────────────────────────────────────────
// ヘルパー
// ───────────────────────────────────────────

/**
 * skill package 名を決定論的に生成する。
 * 例: ("x", "openai") -> "sns-agent-x-openai"
 *
 * provider 文字列にハイフン以外の特殊文字が含まれていた場合は安全な文字列に
 * 落とす（manifest name pattern に違反しないため）。
 */
export function buildSkillPackageName(
  platform: SkillPlatform,
  llmProvider: SkillLlmProvider,
): string {
  const safeProvider = String(llmProvider)
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-");
  return `sns-agent-${platform}-${safeProvider}`;
}

/**
 * テンプレートが採用条件を満たすか判定する。
 *  - platform 一致
 *  - capabilityKeys に列挙された全ての capability が true
 *
 * capabilities が null の場合は capability ベースの判定をスキップする
 * （getCapabilities() を実装していない provider 互換）。
 */
function isTemplateApplicable(
  template: SkillActionTemplate,
  platform: SkillPlatform,
  capabilities: ProviderCapabilities | null,
): boolean {
  if (!template.platforms.includes(platform)) return false;
  if (template.capabilityKeys.length === 0) return true;
  if (capabilities === null) return true;
  for (const key of template.capabilityKeys) {
    if (capabilities[key] !== true) return false;
  }
  return true;
}

// ───────────────────────────────────────────
// generateSkillPackage
// ───────────────────────────────────────────

/**
 * platform + LLM provider に対して SkillManifest を生成する。
 *
 * フロー:
 *  1. platform 値を検証 ("common" は generate 対象外)
 *  2. ProviderRegistry から provider を取得し getCapabilities() を呼ぶ
 *     - "common" 以外で provider 未登録なら ValidationError
 *  3. テンプレートを capability で絞り込み、SkillAction[] を組み立て
 *  4. SkillManifest を作って validateSkillManifest で最終チェック
 */
export function generateSkillPackage(
  deps: SkillPackageBuilderDeps,
  input: GenerateSkillPackageInput,
): SkillManifest {
  const { platform, llmProvider } = input;
  const version = input.version ?? SKILL_PACKAGE_DEFAULT_VERSION;
  const templates = deps.templates ?? BUILTIN_ACTION_TEMPLATES;

  if (typeof platform !== "string") {
    throw new ValidationError("platform is required");
  }
  if (typeof llmProvider !== "string" || llmProvider.trim() === "") {
    throw new ValidationError("llmProvider is required");
  }

  const allowedPlatforms: SkillPlatform[] = ["x", "line", "instagram", "common"];
  if (!allowedPlatforms.includes(platform)) {
    throw new ValidationError(
      `platform must be one of ${allowedPlatforms.join(", ")}, got "${platform}"`,
    );
  }

  // capability 取得 (common 以外)
  let capabilities: ProviderCapabilities | null = null;
  if (platform !== "common") {
    const provider = deps.providerRegistry.get(platform as Platform);
    if (!provider) {
      throw new ValidationError(
        `Provider for platform "${platform}" is not registered. ` +
          `Register it via ProviderRegistry before generating a skill package.`,
      );
    }
    try {
      capabilities = provider.getCapabilities();
    } catch (err) {
      // capability 取得に失敗した場合は capability チェックなしで進める
      // (provider 実装が getCapabilities を未実装にしているケースの後方互換)
      capabilities = null;
    }
  }

  // テンプレートから採用するアクションを抽出
  const actions: SkillAction[] = [];
  const seenNames = new Set<string>();
  for (const tpl of templates) {
    if (!isTemplateApplicable(tpl, platform, capabilities)) continue;
    if (seenNames.has(tpl.action.name)) continue;
    seenNames.add(tpl.action.name);
    // 浅いコピーで返す（呼び出し側の意図しない変更を防ぐ）
    actions.push({
      ...tpl.action,
      permissions: [...tpl.action.permissions],
      requiredCapabilities: [...tpl.action.requiredCapabilities],
    });
  }

  if (actions.length === 0) {
    throw new ValidationError(
      `No applicable skill actions found for platform="${platform}" with current capabilities`,
    );
  }

  const manifest: SkillManifest = {
    name: buildSkillPackageName(platform, llmProvider),
    version,
    platform,
    provider: llmProvider,
    description: buildDescription(platform, llmProvider, actions.length),
    actions,
  };

  // 最終チェック (構造的に壊れていないか)
  const result = validateSkillManifest(manifest);
  if (!result.valid) {
    throw new ValidationError(`Generated skill manifest is invalid: ${result.errors.join("; ")}`, {
      errors: result.errors,
    });
  }

  return manifest;
}

function buildDescription(
  platform: SkillPlatform,
  llmProvider: SkillLlmProvider,
  actionCount: number,
): string {
  const platformLabel =
    platform === "x"
      ? "X (Twitter)"
      : platform === "line"
        ? "LINE"
        : platform === "instagram"
          ? "Instagram"
          : "Common";
  return `${platformLabel} skill package (${actionCount} actions) targeted for LLM provider "${llmProvider}".`;
}
