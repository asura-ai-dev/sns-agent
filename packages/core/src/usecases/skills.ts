/**
 * Skills ユースケース (Task 5003)
 *
 * skill_packages テーブルに対する CRUD と manifest 生成委譲を担う。
 * design.md セクション 4.2 (Skills エンドポイント) に対応する API のドメイン層。
 *
 * 設計方針:
 *  - 実際の manifest 生成 (generateSkillPackage) は @sns-agent/skills に存在する。
 *    core は skills を import しない (循環依存回避) ため、manifest builder 関数を
 *    DI で受け取る (SkillsUsecaseDeps.manifestBuilder)。
 *  - これにより core は SkillManifest の構造を「単なる Record<string, unknown>」
 *    として扱い、検証は呼び出し側に任せる。型安全性は呼び出し側 (apps/api) で
 *    @sns-agent/skills の型を使えば十分担保できる。
 *  - getActiveSkills は agent-gateway が system prompt 構築時に呼ぶ想定。
 */
import type { SkillPackage } from "../domain/entities.js";
import type { SkillPackageRepository } from "../interfaces/repositories.js";
import { ValidationError, NotFoundError } from "../errors/domain-error.js";

// ───────────────────────────────────────────
// 型
// ───────────────────────────────────────────

/**
 * manifest 構造の最小契約。core は @sns-agent/skills の SkillManifest 型を import せず、
 * 必要なフィールドだけを持つサブセット型として扱う。
 *
 * 実際のフィールドは @sns-agent/skills の SkillManifest と完全一致するが、
 * 構造的型付けにより互換性を持たせている。
 */
export interface SkillManifestLike {
  name: string;
  version: string;
  platform: string;
  provider: string;
  description: string;
  actions: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

/**
 * platform + LLM provider から manifest を生成する関数。
 * 実装は @sns-agent/skills の generateSkillPackage を thin wrap する想定。
 * 検証 (validateSkillManifest) も含めて実装側の責務とする。
 */
export type SkillManifestBuilder = (input: {
  platform: string;
  llmProvider: string;
}) => SkillManifestLike;

export interface SkillsUsecaseDeps {
  skillPackageRepo: SkillPackageRepository;
  manifestBuilder: SkillManifestBuilder;
}

// ───────────────────────────────────────────
// listSkillPackages
// ───────────────────────────────────────────

/**
 * ワークスペースの skill package 一覧を取得する。
 * onlyEnabled=true の場合 enabled=true の行だけ返す。
 */
export async function listSkillPackages(
  deps: SkillsUsecaseDeps,
  workspaceId: string,
  options: { onlyEnabled?: boolean } = {},
): Promise<SkillPackage[]> {
  if (typeof workspaceId !== "string" || workspaceId.trim() === "") {
    throw new ValidationError("workspaceId is required");
  }
  return deps.skillPackageRepo.findByWorkspace(workspaceId, options.onlyEnabled === true);
}

// ───────────────────────────────────────────
// generateSkillPackage (usecase)
// ───────────────────────────────────────────

export interface GenerateSkillPackageUsecaseInput {
  workspaceId: string;
  platform: string;
  llmProvider: string;
}

/**
 * platform + LLM provider に対して新規 skill package を生成し DB に保存する。
 *
 * 同名の package が既に存在する場合:
 *  - 既存を「不可視で上書き」せず、更新 (manifest を最新化) する。
 *    これにより `sns skills pack --platform x --provider openai` を再実行しても
 *    重複 row を作らず冪等になる。
 *  - enabled フラグは既存の値を維持する (有効化済みの package を再生成しても
 *    無効化されない)。新規作成時は enabled=false (デフォルト) で作る。
 */
export async function generateSkillPackage(
  deps: SkillsUsecaseDeps,
  input: GenerateSkillPackageUsecaseInput,
): Promise<SkillPackage> {
  const { workspaceId, platform, llmProvider } = input;
  if (typeof workspaceId !== "string" || workspaceId.trim() === "") {
    throw new ValidationError("workspaceId is required");
  }
  if (typeof platform !== "string" || platform.trim() === "") {
    throw new ValidationError("platform is required");
  }
  if (typeof llmProvider !== "string" || llmProvider.trim() === "") {
    throw new ValidationError("llmProvider is required");
  }

  // manifest 生成 (例外はそのまま伝播させる)
  const manifest = deps.manifestBuilder({ platform, llmProvider });
  if (
    !manifest ||
    typeof manifest !== "object" ||
    typeof manifest.name !== "string" ||
    typeof manifest.version !== "string"
  ) {
    throw new ValidationError("manifestBuilder returned an invalid manifest");
  }

  const existing = await deps.skillPackageRepo.findByName(workspaceId, manifest.name);
  if (existing) {
    return deps.skillPackageRepo.update(existing.id, {
      version: manifest.version,
      platform: manifest.platform,
      llmProvider: manifest.provider,
      manifest: manifest as Record<string, unknown>,
    });
  }

  return deps.skillPackageRepo.create({
    workspaceId,
    name: manifest.name,
    version: manifest.version,
    platform: manifest.platform,
    llmProvider: manifest.provider,
    manifest: manifest as Record<string, unknown>,
    enabled: false,
  });
}

// ───────────────────────────────────────────
// enableSkillPackage / disableSkillPackage
// ───────────────────────────────────────────

/**
 * package を有効化する。workspaceId を渡して所有チェックを行う。
 */
export async function enableSkillPackage(
  deps: SkillsUsecaseDeps,
  params: { packageId: string; workspaceId: string },
): Promise<SkillPackage> {
  return setEnabled(deps, params, true);
}

/**
 * package を無効化する。
 */
export async function disableSkillPackage(
  deps: SkillsUsecaseDeps,
  params: { packageId: string; workspaceId: string },
): Promise<SkillPackage> {
  return setEnabled(deps, params, false);
}

async function setEnabled(
  deps: SkillsUsecaseDeps,
  params: { packageId: string; workspaceId: string },
  enabled: boolean,
): Promise<SkillPackage> {
  const { packageId, workspaceId } = params;
  if (typeof packageId !== "string" || packageId.trim() === "") {
    throw new ValidationError("packageId is required");
  }
  if (typeof workspaceId !== "string" || workspaceId.trim() === "") {
    throw new ValidationError("workspaceId is required");
  }
  const existing = await deps.skillPackageRepo.findById(packageId);
  if (!existing || existing.workspaceId !== workspaceId) {
    throw new NotFoundError("SkillPackage", packageId);
  }
  return deps.skillPackageRepo.update(packageId, { enabled });
}

// ───────────────────────────────────────────
// getSkillManifest
// ───────────────────────────────────────────

/**
 * 指定 package の manifest を返す。
 * workspaceId スコープで所有チェックを行う。
 */
export async function getSkillManifest(
  deps: SkillsUsecaseDeps,
  params: { packageId: string; workspaceId: string },
): Promise<{ package: SkillPackage; manifest: Record<string, unknown> }> {
  const { packageId, workspaceId } = params;
  const existing = await deps.skillPackageRepo.findById(packageId);
  if (!existing || existing.workspaceId !== workspaceId) {
    throw new NotFoundError("SkillPackage", packageId);
  }
  return { package: existing, manifest: existing.manifest };
}

// ───────────────────────────────────────────
// getActiveSkills
// ───────────────────────────────────────────

/**
 * ワークスペースで有効化されている全 skill package を返す。
 * Agent Gateway が system prompt 構築時に参照する。
 */
export async function getActiveSkills(
  deps: SkillsUsecaseDeps,
  workspaceId: string,
): Promise<SkillPackage[]> {
  if (typeof workspaceId !== "string" || workspaceId.trim() === "") {
    throw new ValidationError("workspaceId is required");
  }
  return deps.skillPackageRepo.findByWorkspace(workspaceId, true);
}
