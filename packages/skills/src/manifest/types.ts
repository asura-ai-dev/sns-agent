/**
 * Skill Manifest 型定義
 *
 * Task 5002: skill manifest は LLM 経由で実行可能な操作を宣言するメタデータ。
 * design.md セクション 1.6 (skills 配布フォーマット), architecture.md セクション 8.4
 * (Skill Planner / Executor) に準拠。
 *
 * 方針:
 *  - 任意コード実行ではない。manifest に宣言された action 名だけが実行可能。
 *  - 各 action は JSON Schema で引数仕様を持ち、実行前に validateSkillAction で検証される。
 *  - permissions[] は @sns-agent/core の Permission 文字列と整合し、RBAC と突き合わせる。
 *  - requiredCapabilities[] は SocialProvider.getCapabilities() のキーと突き合わせる。
 */

import type { Permission } from "@sns-agent/core";

// ───────────────────────────────────────────
// 基本型
// ───────────────────────────────────────────

/**
 * LLM プロバイダ識別子。
 * llm_routes.provider と同じ値を想定する。
 */
export type SkillLlmProvider = "openai" | "anthropic" | string;

/**
 * manifest が対象とする SNS プラットフォーム。
 * "common" は SNS 非依存の共通 skill を表す。
 */
export type SkillPlatform = "x" | "line" | "instagram" | "common";

/**
 * 引数 JSON Schema の最小サブセット。
 * v1 では type / properties / required / items / enum / description だけをサポートする。
 * 将来的に ajv 等の本格的な validator に差し替え可能な形で型だけを定義している。
 */
export interface SkillJsonSchema {
  type?: "object" | "string" | "number" | "integer" | "boolean" | "array" | "null";
  description?: string;
  properties?: Record<string, SkillJsonSchema>;
  required?: string[];
  items?: SkillJsonSchema;
  enum?: Array<string | number | boolean | null>;
  /** number / integer の下限 */
  minimum?: number;
  /** number / integer の上限 */
  maximum?: number;
  /** string の最小長 */
  minLength?: number;
  /** string の最大長 */
  maxLength?: number;
  /** string の pattern (RegExp source) */
  pattern?: string;
  /** object の追加プロパティ許可（既定 true） */
  additionalProperties?: boolean;
}

// ───────────────────────────────────────────
// SkillAction
// ───────────────────────────────────────────

/**
 * 1 つの skill action 定義。
 *
 * 例:
 *   { name: "post.create", description: "新規投稿を作成する",
 *     parameters: { type: "object", properties: {...}, required: [...] },
 *     permissions: ["post:create"], requiredCapabilities: ["textPost"] }
 */
export interface SkillAction {
  /** action 名。`<namespace>.<verb>` 形式を推奨 (例: post.create) */
  name: string;
  /** LLM に提示する説明文 */
  description: string;
  /** 引数仕様 (JSON Schema) */
  parameters: SkillJsonSchema;
  /** 実行に必要な RBAC 権限。actor のロールと checkPermission で突き合わせる */
  permissions: Permission[];
  /** 実行に必要な provider capability キー (例: "textPost", "videoPost") */
  requiredCapabilities: string[];
  /**
   * read-only モードで許可されるアクションかどうか。
   * true の場合のみ read-only モードで実行可能。
   */
  readOnly?: boolean;
}

// ───────────────────────────────────────────
// SkillManifest
// ───────────────────────────────────────────

/**
 * skill パッケージの manifest 本体。
 * skill_packages.manifest カラムの JSON 表現と 1:1 対応する。
 */
export interface SkillManifest {
  /** パッケージ名 (例: "sns-agent-x-openai") */
  name: string;
  /** セマンティックバージョン (例: "0.1.0") */
  version: string;
  /** 対象プラットフォーム */
  platform: SkillPlatform;
  /** 対象 LLM プロバイダ */
  provider: SkillLlmProvider;
  /** パッケージの説明 */
  description: string;
  /** 宣言されたアクション一覧 */
  actions: SkillAction[];
}

// ───────────────────────────────────────────
// バリデーション
// ───────────────────────────────────────────

/**
 * manifest バリデーション結果。
 * valid=true の場合 errors は空配列。
 */
export interface ManifestValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * name の規約: 小文字英数字と `-` / `_` のみ、2〜64 文字。
 */
const NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{1,63}$/;

/**
 * semver 簡易パターン: major.minor.patch (pre-release 等は許容)。
 */
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

/**
 * action 名の規約: 英数字と `.` / `_` / `-`、最大 96 文字。
 * namespace.verb 形式を推奨するが単一トークンも許容する。
 */
const ACTION_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,95}$/;

/**
 * JSON Schema の内部整合性を素朴にチェックする。
 * v1 では深い検証はしない（ajv を使わない）。
 */
function validateSchemaShape(schema: unknown, path: string, errors: string[]): void {
  if (schema === null || typeof schema !== "object") {
    errors.push(`${path}: must be an object`);
    return;
  }
  const s = schema as SkillJsonSchema;
  if (s.type !== undefined) {
    const allowed: Array<SkillJsonSchema["type"]> = [
      "object",
      "string",
      "number",
      "integer",
      "boolean",
      "array",
      "null",
    ];
    if (!allowed.includes(s.type)) {
      errors.push(`${path}.type: unsupported type "${s.type}"`);
    }
  }
  if (s.properties !== undefined) {
    if (typeof s.properties !== "object" || s.properties === null) {
      errors.push(`${path}.properties: must be an object`);
    } else {
      for (const [k, v] of Object.entries(s.properties)) {
        validateSchemaShape(v, `${path}.properties.${k}`, errors);
      }
    }
  }
  if (s.required !== undefined) {
    if (!Array.isArray(s.required) || s.required.some((r) => typeof r !== "string")) {
      errors.push(`${path}.required: must be an array of strings`);
    }
  }
  if (s.items !== undefined) {
    validateSchemaShape(s.items, `${path}.items`, errors);
  }
  if (s.enum !== undefined && !Array.isArray(s.enum)) {
    errors.push(`${path}.enum: must be an array`);
  }
}

/**
 * SkillManifest を検証する。
 * 失敗しても例外は投げず、errors[] を返す。
 */
export function validateSkillManifest(input: unknown): ManifestValidationResult {
  const errors: string[] = [];

  if (input === null || typeof input !== "object") {
    return { valid: false, errors: ["manifest must be a JSON object"] };
  }
  const m = input as Partial<SkillManifest>;

  if (typeof m.name !== "string" || !NAME_PATTERN.test(m.name)) {
    errors.push("name: must match /^[a-z0-9][a-z0-9_-]{1,63}$/");
  }
  if (typeof m.version !== "string" || !VERSION_PATTERN.test(m.version)) {
    errors.push("version: must be semver-like (e.g. 1.2.3)");
  }
  const allowedPlatforms: SkillPlatform[] = ["x", "line", "instagram", "common"];
  if (typeof m.platform !== "string" || !allowedPlatforms.includes(m.platform as SkillPlatform)) {
    errors.push(`platform: must be one of ${allowedPlatforms.join(", ")}`);
  }
  if (typeof m.provider !== "string" || m.provider.trim() === "") {
    errors.push("provider: must be a non-empty string");
  }
  if (typeof m.description !== "string") {
    errors.push("description: must be a string");
  }

  if (!Array.isArray(m.actions)) {
    errors.push("actions: must be an array");
  } else {
    if (m.actions.length === 0) {
      errors.push("actions: must contain at least 1 action");
    }
    const seenNames = new Set<string>();
    m.actions.forEach((action, index) => {
      const prefix = `actions[${index}]`;
      if (action === null || typeof action !== "object") {
        errors.push(`${prefix}: must be an object`);
        return;
      }
      const a = action as Partial<SkillAction>;
      if (typeof a.name !== "string" || !ACTION_NAME_PATTERN.test(a.name)) {
        errors.push(`${prefix}.name: must match /^[a-z0-9][a-z0-9._-]{0,95}$/`);
      } else {
        if (seenNames.has(a.name)) {
          errors.push(`${prefix}.name: duplicated "${a.name}"`);
        }
        seenNames.add(a.name);
      }
      if (typeof a.description !== "string") {
        errors.push(`${prefix}.description: must be a string`);
      }
      if (a.parameters === undefined) {
        errors.push(`${prefix}.parameters: required`);
      } else {
        validateSchemaShape(a.parameters, `${prefix}.parameters`, errors);
      }
      if (!Array.isArray(a.permissions) || a.permissions.some((p) => typeof p !== "string")) {
        errors.push(`${prefix}.permissions: must be an array of strings`);
      }
      if (
        !Array.isArray(a.requiredCapabilities) ||
        a.requiredCapabilities.some((p) => typeof p !== "string")
      ) {
        errors.push(`${prefix}.requiredCapabilities: must be an array of strings`);
      }
      if (a.readOnly !== undefined && typeof a.readOnly !== "boolean") {
        errors.push(`${prefix}.readOnly: must be a boolean`);
      }
    });
  }

  return { valid: errors.length === 0, errors };
}

/**
 * manifest から action を名前引きする。
 * 見つからない場合は null。
 */
export function findSkillAction(manifest: SkillManifest, actionName: string): SkillAction | null {
  return manifest.actions.find((a) => a.name === actionName) ?? null;
}
