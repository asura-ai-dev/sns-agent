/**
 * Skill Executor
 *
 * Task 5002: manifest 駆動の skill action 実行ランタイム。
 * architecture.md セクション 8.4 (Skill Planner / Executor) / 8.5 (実行モード) に準拠。
 *
 * 責務:
 *  - 引数を JSON Schema で検証する (validateSkillAction)
 *  - actor の role と action.permissions を突き合わせる (checkSkillPermissions)
 *  - 実行前に 権限 → モード → 予算 を順に通し、core use case に委譲する (executeSkillAction)
 *  - 実行せずにプレビュー文字列を返す (dryRunSkillAction)
 *
 * 実際のドメイン操作は @sns-agent/core の use case に委譲する。このファイル内では
 * provider や DB へ直接触らず、DI された invoker 関数経由で呼ぶ (テスト容易性 + 結合強度低)。
 */
import type { Role } from "@sns-agent/config";
import {
  AuthorizationError,
  ValidationError,
  checkPermission,
  type Permission,
} from "@sns-agent/core";
import type { SkillAction, SkillJsonSchema, SkillManifest } from "../manifest/types.js";
import { findSkillAction } from "../manifest/types.js";

// ───────────────────────────────────────────
// 実行モード
// ───────────────────────────────────────────

/**
 * skill 実行モード (architecture.md セクション 8.5)。
 * - read-only:         読み取り系 (action.readOnly=true) のみ許可
 * - draft:             書き込みは下書き (createPost など publishNow=false) に限定
 * - approval-required: 実行前に承認必須 (v1 デフォルト)
 * - direct-execute:    承認不要で即時実行 (admin/owner 向け)
 */
export type SkillExecutionMode = "read-only" | "draft" | "approval-required" | "direct-execute";

// ───────────────────────────────────────────
// 実行コンテキスト
// ───────────────────────────────────────────

/**
 * skill action 実行に必要な actor 情報。
 */
export interface SkillActor {
  /** user_id or agent_identity_id */
  id: string;
  role: Role;
  type: "user" | "agent";
}

/**
 * executeSkillAction / dryRunSkillAction に渡すコンテキスト。
 */
export interface SkillExecutionContext {
  workspaceId: string;
  manifest: SkillManifest;
  actionName: string;
  args: Record<string, unknown>;
  actor: SkillActor;
  /**
   * 実行モード。省略時は approval-required。
   */
  mode?: SkillExecutionMode;
}

// ───────────────────────────────────────────
// Invoker 型 (core use case への委譲ポイント)
// ───────────────────────────────────────────

/**
 * executeSkillAction が実際の副作用を起こすために呼ぶ関数。
 * DI により apps/api 側で core use case (createPost, schedulePost など) にマッピングする。
 *
 * 戻り値は実行結果 (caller が監査ログ / レスポンスに載せるための JSON)。
 * 失敗時は throw。
 */
export type SkillActionInvoker = (params: {
  workspaceId: string;
  actor: SkillActor;
  actionName: string;
  args: Record<string, unknown>;
}) => Promise<Record<string, unknown>>;

/**
 * 予算チェック関数。事前に budget policy を評価してブロックの場合は例外を投げる。
 * 省略時は予算チェックをスキップする (v1 後方互換)。
 */
export type SkillBudgetGuard = (params: {
  workspaceId: string;
  manifest: SkillManifest;
  action: SkillAction;
  args: Record<string, unknown>;
}) => Promise<void>;

export interface SkillExecutorDeps {
  /** 実際の action 実行委譲先 */
  invoker: SkillActionInvoker;
  /** 予算チェック (任意) */
  budgetGuard?: SkillBudgetGuard;
}

// ───────────────────────────────────────────
// JSON Schema バリデーション (最小実装)
// ───────────────────────────────────────────

/**
 * SkillJsonSchema に対する値の検証。v1 では ajv 等を使わず最小限の実装。
 * サポート: type, properties, required, items, enum, minimum, maximum,
 *           minLength, maxLength, pattern, additionalProperties。
 */
function validateAgainstSchema(
  value: unknown,
  schema: SkillJsonSchema,
  path: string,
  errors: string[],
): void {
  if (schema.type !== undefined) {
    const ok = matchesType(value, schema.type);
    if (!ok) {
      errors.push(`${path}: expected type ${schema.type}`);
      return;
    }
  }
  if (schema.enum !== undefined) {
    const found = schema.enum.some((v) => v === value);
    if (!found) {
      errors.push(`${path}: value not in enum`);
    }
  }
  if (schema.type === "object" || schema.properties !== undefined) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      errors.push(`${path}: expected object`);
      return;
    }
    const obj = value as Record<string, unknown>;
    const props = schema.properties ?? {};
    if (schema.required) {
      for (const key of schema.required) {
        if (!(key in obj)) {
          errors.push(`${path}.${key}: required`);
        }
      }
    }
    for (const [key, sub] of Object.entries(props)) {
      if (key in obj) {
        validateAgainstSchema(obj[key], sub, `${path}.${key}`, errors);
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(obj)) {
        if (!(key in props)) {
          errors.push(`${path}.${key}: additional property not allowed`);
        }
      }
    }
  }
  if (schema.type === "array" || schema.items !== undefined) {
    if (!Array.isArray(value)) {
      errors.push(`${path}: expected array`);
      return;
    }
    if (schema.items) {
      value.forEach((item, i) => {
        validateAgainstSchema(item, schema.items as SkillJsonSchema, `${path}[${i}]`, errors);
      });
    }
  }
  if (schema.type === "string" && typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${path}: length < ${schema.minLength}`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push(`${path}: length > ${schema.maxLength}`);
    }
    if (schema.pattern !== undefined) {
      try {
        const re = new RegExp(schema.pattern);
        if (!re.test(value)) {
          errors.push(`${path}: does not match pattern`);
        }
      } catch {
        errors.push(`${path}: invalid pattern in schema`);
      }
    }
  }
  if ((schema.type === "number" || schema.type === "integer") && typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${path}: < minimum ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`${path}: > maximum ${schema.maximum}`);
    }
  }
}

function matchesType(value: unknown, type: SkillJsonSchema["type"]): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && !Number.isNaN(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    case "array":
      return Array.isArray(value);
    case "null":
      return value === null;
    default:
      return true;
  }
}

// ───────────────────────────────────────────
// validateSkillAction
// ───────────────────────────────────────────

export interface SkillArgValidationResult {
  valid: boolean;
  errors: string[];
  action: SkillAction;
}

/**
 * action の引数を manifest の parameters JSON Schema で検証する。
 * 結果オブジェクトを返し、呼び出し側が ValidationError に変換するかを選べる形にする。
 * action が manifest に存在しない場合は即 throw (構造的な誤り)。
 */
export function validateSkillAction(
  manifest: SkillManifest,
  actionName: string,
  args: Record<string, unknown>,
): SkillArgValidationResult {
  const action = findSkillAction(manifest, actionName);
  if (!action) {
    throw new ValidationError(`Skill action not found: ${actionName} (manifest=${manifest.name})`, {
      actionName,
      manifestName: manifest.name,
    });
  }
  const errors: string[] = [];
  validateAgainstSchema(args ?? {}, action.parameters, "args", errors);
  return { valid: errors.length === 0, errors, action };
}

// ───────────────────────────────────────────
// checkSkillPermissions
// ───────────────────────────────────────────

export interface SkillPermissionCheckResult {
  allowed: boolean;
  missing: Permission[];
}

/**
 * actor の role に action.permissions が全て含まれているかを確認する。
 * 欠けている permission を missing に返す。
 */
export function checkSkillPermissions(
  manifest: SkillManifest,
  actionName: string,
  actorRole: Role,
): SkillPermissionCheckResult {
  const action = findSkillAction(manifest, actionName);
  if (!action) {
    throw new ValidationError(`Skill action not found: ${actionName} (manifest=${manifest.name})`, {
      actionName,
      manifestName: manifest.name,
    });
  }
  const missing: Permission[] = [];
  for (const p of action.permissions) {
    if (!checkPermission(actorRole, p)) {
      missing.push(p);
    }
  }
  return { allowed: missing.length === 0, missing };
}

// ───────────────────────────────────────────
// モードチェック
// ───────────────────────────────────────────

/**
 * モードと action の組み合わせを検証する。
 *  - read-only: action.readOnly !== true の場合は拒否
 *  - draft:     書き込み系でも OK だが、invoker 側で publishNow=false を強制する前提
 *  - approval-required: 検証対象外（このレイヤでは許可。承認は呼び出し側が管理）
 *  - direct-execute:    常に許可
 */
function ensureModeAllowed(action: SkillAction, mode: SkillExecutionMode): void {
  if (mode === "read-only" && action.readOnly !== true) {
    throw new AuthorizationError(`Action "${action.name}" is not allowed in read-only mode`, {
      actionName: action.name,
      mode,
    });
  }
}

// ───────────────────────────────────────────
// executeSkillAction
// ───────────────────────────────────────────

export interface SkillExecutionResult {
  /** 実行した action 名 */
  actionName: string;
  /** invoker が返した任意の結果 JSON */
  result: Record<string, unknown>;
  /** 実行時のモード (省略時 approval-required) */
  mode: SkillExecutionMode;
}

/**
 * skill action を実行する。
 *
 * フロー:
 * 1. action を manifest から解決
 * 2. 引数を JSON Schema で検証
 * 3. actor role と action.permissions を突き合わせ
 * 4. 実行モードチェック (read-only 等)
 * 5. 予算ガードを呼ぶ (任意)
 * 6. invoker に委譲して実行
 */
export async function executeSkillAction(
  deps: SkillExecutorDeps,
  context: SkillExecutionContext,
): Promise<SkillExecutionResult> {
  const { manifest, actionName, args, actor } = context;
  const mode: SkillExecutionMode = context.mode ?? "approval-required";

  // 1 + 2. 引数検証
  const validation = validateSkillAction(manifest, actionName, args);
  if (!validation.valid) {
    throw new ValidationError(`Skill argument validation failed: ${validation.errors.join("; ")}`, {
      actionName,
      errors: validation.errors,
    });
  }
  const action = validation.action;

  // 3. 権限チェック
  const perm = checkSkillPermissions(manifest, actionName, actor.role);
  if (!perm.allowed) {
    throw new AuthorizationError(
      `Skill action requires permissions not granted to role ${actor.role}: ${perm.missing.join(", ")}`,
      { actionName, missing: perm.missing, actorRole: actor.role },
    );
  }

  // 4. モードチェック
  ensureModeAllowed(action, mode);

  // 5. 予算チェック
  if (deps.budgetGuard) {
    await deps.budgetGuard({
      workspaceId: context.workspaceId,
      manifest,
      action,
      args,
    });
  }

  // 6. 実行委譲
  const result = await deps.invoker({
    workspaceId: context.workspaceId,
    actor,
    actionName,
    args,
  });

  return { actionName, result, mode };
}

// ───────────────────────────────────────────
// dryRunSkillAction
// ───────────────────────────────────────────

export interface SkillDryRunResult {
  actionName: string;
  description: string;
  /** LLM ユーザーに提示する人間向けプレビュー文字列 */
  preview: string;
  /** 必要な permissions (action.permissions) */
  requiredPermissions: Permission[];
  /** actor に欠けている permissions。空配列なら OK */
  missingPermissions: Permission[];
  /** 引数バリデーション結果 */
  argumentErrors: string[];
  /** 実行モード */
  mode: SkillExecutionMode;
  /** 実行可否 (argumentErrors / missingPermissions / モード違反が無いこと) */
  allowed: boolean;
  /** allowed=false の場合の理由 (null or string) */
  blockedReason: string | null;
}

/**
 * 実行せずに「このアクションが何をするか」を返す。
 * UI / CLI の確認ダイアログ用。
 *
 * 方針:
 *  - 例外は投げない (manifest に action が無い等の構造エラーは除く)
 *  - 検証失敗は結果オブジェクトの allowed=false + blockedReason で返す
 */
export function dryRunSkillAction(context: SkillExecutionContext): SkillDryRunResult {
  const { manifest, actionName, args, actor } = context;
  const mode: SkillExecutionMode = context.mode ?? "approval-required";

  const action = findSkillAction(manifest, actionName);
  if (!action) {
    throw new ValidationError(`Skill action not found: ${actionName} (manifest=${manifest.name})`, {
      actionName,
      manifestName: manifest.name,
    });
  }

  // 引数検証
  const argErrors: string[] = [];
  validateAgainstSchema(args ?? {}, action.parameters, "args", argErrors);

  // 権限チェック
  const missing: Permission[] = [];
  for (const p of action.permissions) {
    if (!checkPermission(actor.role, p)) missing.push(p);
  }

  // モード違反
  let modeViolation: string | null = null;
  if (mode === "read-only" && action.readOnly !== true) {
    modeViolation = `Action "${action.name}" is not allowed in read-only mode`;
  }

  let blockedReason: string | null = null;
  if (argErrors.length > 0) {
    blockedReason = `argument validation failed: ${argErrors.join("; ")}`;
  } else if (missing.length > 0) {
    blockedReason = `missing permissions: ${missing.join(", ")}`;
  } else if (modeViolation) {
    blockedReason = modeViolation;
  }

  const preview = buildPreviewText(action, args, mode);

  return {
    actionName,
    description: action.description,
    preview,
    requiredPermissions: [...action.permissions],
    missingPermissions: missing,
    argumentErrors: argErrors,
    mode,
    allowed: blockedReason === null,
    blockedReason,
  };
}

/**
 * 人間向けプレビュー文字列を作る (v1: テンプレートは素朴)。
 * より高度な表現 (platform ごとのメッセージ) は将来 action 側に `previewTemplate` を
 * 持たせるなどで拡張する。
 */
function buildPreviewText(
  action: SkillAction,
  args: Record<string, unknown>,
  mode: SkillExecutionMode,
): string {
  const argSummary = Object.entries(args ?? {})
    .map(([k, v]) => {
      const display =
        typeof v === "string" ? (v.length > 120 ? `${v.slice(0, 117)}...` : v) : JSON.stringify(v);
      return `  - ${k}: ${display}`;
    })
    .join("\n");

  const header = `[dry-run] ${action.name} (mode=${mode})`;
  const body = action.description;
  const argBlock = argSummary.length > 0 ? `arguments:\n${argSummary}` : "arguments: (none)";
  return `${header}\n${body}\n${argBlock}`;
}
