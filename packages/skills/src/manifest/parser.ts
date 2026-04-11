/**
 * Manifest Parser & Compatibility Checker (Task 5003)
 *
 * - parseManifest: 任意の JSON 文字列 / オブジェクトを SkillManifest に解析する。
 *                  validateSkillManifest をそのまま通し、失敗時は ValidationError。
 * - checkVersionCompatibility: ローダー側 (Skill Executor) のサポートする仕様
 *                              バージョン範囲と manifest.version を突き合わせる。
 *
 * v1 では「メジャーバージョン互換」のみをサポートする:
 *   - 同じ major  → 互換 (ok)
 *   - major が 0  → minor が一致するときのみ互換 (semver の慣例)
 *   - それ以外     → incompatible
 *
 * 将来 OpenAI function calling / Anthropic tool use 形式へのエクスポートを
 * 追加する場合も、parseManifest の入力レイヤで内部表現に正規化する想定。
 */
import { ValidationError } from "@sns-agent/core";
import { validateSkillManifest, type SkillManifest } from "./types.js";

// ───────────────────────────────────────────
// 仕様バージョン
// ───────────────────────────────────────────

/**
 * このランタイムが解釈できる skill manifest 仕様のバージョン。
 * v1 では `0.1.x` を想定する。
 */
export const SKILL_MANIFEST_RUNTIME_VERSION = "0.1.0";

// ───────────────────────────────────────────
// parseManifest
// ───────────────────────────────────────────

/**
 * 入力 (string | object) を SkillManifest に解析する。
 * 失敗時は ValidationError を投げる。
 *
 * - string の場合は JSON.parse する
 * - 解析後は validateSkillManifest を通す
 *
 * 戻り値の SkillManifest は validateManifest 通過後の確定値で、
 * 安全に core / runtime に渡せる。
 */
export function parseManifest(input: unknown): SkillManifest {
  let raw: unknown = input;

  if (typeof input === "string") {
    try {
      raw = JSON.parse(input);
    } catch (err) {
      throw new ValidationError(
        `Failed to parse manifest JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const result = validateSkillManifest(raw);
  if (!result.valid) {
    throw new ValidationError(`Invalid skill manifest: ${result.errors.join("; ")}`, {
      errors: result.errors,
    });
  }
  return raw as SkillManifest;
}

/**
 * validateManifest: 既に object として手元にある manifest を検証する。
 * 失敗時は ValidationError を投げる (errors を details に含める)。
 *
 * validateSkillManifest との違いは「失敗時に例外を投げる」点だけ。
 * 呼び出し側 (usecase / route) で例外ハンドラに乗せたい場合に便利。
 */
export function validateManifest(input: unknown): SkillManifest {
  const result = validateSkillManifest(input);
  if (!result.valid) {
    throw new ValidationError(`Invalid skill manifest: ${result.errors.join("; ")}`, {
      errors: result.errors,
    });
  }
  return input as SkillManifest;
}

// ───────────────────────────────────────────
// バージョン互換性
// ───────────────────────────────────────────

export interface VersionCompatibilityResult {
  compatible: boolean;
  manifestVersion: string;
  runtimeVersion: string;
  reason?: string;
}

const SEMVER_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/;

function parseSemver(v: string): { major: number; minor: number; patch: number } | null {
  const m = SEMVER_PATTERN.exec(v);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
  };
}

/**
 * manifest.version とランタイム仕様バージョンの互換性を判定する。
 *
 * ルール:
 *  - どちらかが semver でない -> incompatible
 *  - major が異なる            -> incompatible
 *  - major === 0 で minor が異なる -> incompatible (0.x は破壊的変更を minor で許す)
 *  - 上記以外                  -> compatible
 */
export function checkVersionCompatibility(
  manifestVersion: string,
  runtimeVersion: string = SKILL_MANIFEST_RUNTIME_VERSION,
): VersionCompatibilityResult {
  const m = parseSemver(manifestVersion);
  const r = parseSemver(runtimeVersion);
  if (!m || !r) {
    return {
      compatible: false,
      manifestVersion,
      runtimeVersion,
      reason: "version is not a valid semver string",
    };
  }
  if (m.major !== r.major) {
    return {
      compatible: false,
      manifestVersion,
      runtimeVersion,
      reason: `major version mismatch (manifest=${m.major}, runtime=${r.major})`,
    };
  }
  if (m.major === 0 && m.minor !== r.minor) {
    return {
      compatible: false,
      manifestVersion,
      runtimeVersion,
      reason: `0.x minor version mismatch (manifest=0.${m.minor}, runtime=0.${r.minor})`,
    };
  }
  return {
    compatible: true,
    manifestVersion,
    runtimeVersion,
  };
}
