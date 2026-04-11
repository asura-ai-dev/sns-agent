/**
 * Agent Gateway ユースケース
 *
 * Task 5002: Web UI / CLI からのチャットメッセージを受け、LLM を介して skill action に
 * 橋渡しする。architecture.md セクション 8.2 (Agent Gateway) / 8.4 (Skill Planner /
 * Executor) / 8.5 (実行モード) に準拠。
 *
 * このファイルは以下の責務のみを持つ:
 *  1. LLM Route Resolver で使用モデルを決定する (resolver 関数は DI)
 *  2. 有効な skill 一覧から system prompt を組み立てる
 *  3. LLM の応答を解析し、skill action 呼び出し要求なら dry-run preview を作る
 *  4. 承認済み action 要求を受け取り、invoker 経由で実行 + 監査ログを残す
 *
 * 実際の LLM 呼び出しや skill 実行処理は @sns-agent/llm / @sns-agent/skills 側で
 * 行う。core は両者に依存せず、関数シグネチャだけを抽象化して受け取る。
 * （packages/core は llm / skills を import しない = 循環依存を避ける）
 */

import type { Role } from "@sns-agent/config";
import type { ActorType, AuditLog, SkillPackage } from "../domain/entities.js";
import type { AuditLogRepository } from "../interfaces/repositories.js";
import { recordAudit } from "./audit.js";
import { ValidationError } from "../errors/domain-error.js";

// ───────────────────────────────────────────
// 型
// ───────────────────────────────────────────

/**
 * 実行モード (architecture.md セクション 8.5)。
 * v1 デフォルトは approval-required。
 */
export type AgentExecutionMode = "read-only" | "draft" | "approval-required" | "direct-execute";

/**
 * Agent Gateway 利用者。User or AgentIdentity。
 */
export interface AgentActor {
  id: string;
  role: Role;
  type: ActorType; // "user" | "agent"
}

/**
 * LLM が返す skill action 呼び出し要求。
 *
 * v1 では JSON パース可能なテキスト応答を前提とする。
 * 例:
 *   {"action":"post.create","args":{"platform":"x","text":"..."}}
 */
export interface AgentSkillIntent {
  /** action 名 (manifest で宣言されたもの) */
  actionName: string;
  /** 引数 */
  args: Record<string, unknown>;
  /** どの skill package に属するか (名前で特定) */
  packageName: string;
}

/**
 * LLM 応答の解析結果。
 *  - type="text": テキストのみ (skill 呼び出しなし)
 *  - type="skill": skill 呼び出し要求
 */
export type AgentLlmDecision =
  | { type: "text"; content: string }
  | { type: "skill"; content: string; intent: AgentSkillIntent };

/**
 * LLM を呼んで decision を返す関数。
 * 実装は packages/llm 側で行い、apps/api が DI する。
 */
export type AgentLlmInvoker = (params: {
  workspaceId: string;
  actor: AgentActor;
  systemPrompt: string;
  userMessage: string;
  conversationId?: string | null;
}) => Promise<AgentLlmDecision>;

/**
 * skill action の dry-run 実行関数 (packages/skills 側で提供)。
 */
export type AgentDryRunInvoker = (params: {
  workspaceId: string;
  actor: AgentActor;
  mode: AgentExecutionMode;
  intent: AgentSkillIntent;
}) => Promise<AgentDryRunPreview>;

/**
 * skill action の実行関数 (承認済みリクエスト用)。
 */
export type AgentExecuteInvoker = (params: {
  workspaceId: string;
  actor: AgentActor;
  mode: AgentExecutionMode;
  intent: AgentSkillIntent;
}) => Promise<AgentExecutionOutcome>;

/**
 * dry-run の結果。UI / CLI に返される。
 */
export interface AgentDryRunPreview {
  actionName: string;
  packageName: string;
  description: string;
  /** 人間向けプレビュー文字列 */
  preview: string;
  requiredPermissions: string[];
  missingPermissions: string[];
  argumentErrors: string[];
  mode: AgentExecutionMode;
  /** 実行できる状態か */
  allowed: boolean;
  blockedReason: string | null;
}

/**
 * executeSkillAction 相当の結果。
 */
export interface AgentExecutionOutcome {
  actionName: string;
  packageName: string;
  result: Record<string, unknown>;
  mode: AgentExecutionMode;
}

// ───────────────────────────────────────────
// handleChatMessage
// ───────────────────────────────────────────

export interface AgentGatewayDeps {
  /** LLM 呼び出し (packages/llm から DI) */
  llmInvoker: AgentLlmInvoker;
  /** skill dry-run 呼び出し (packages/skills から DI) */
  dryRunInvoker: AgentDryRunInvoker;
  /** skill 実行呼び出し (packages/skills から DI) */
  executeInvoker: AgentExecuteInvoker;
  /** 監査ログ */
  auditRepo: AuditLogRepository;
}

export interface HandleChatMessageInput {
  workspaceId: string;
  actor: AgentActor;
  message: string;
  conversationId?: string | null;
  /**
   * 有効化済み skill package の一覧。
   * system prompt の構築とフィルタに使う。
   */
  enabledSkills: SkillPackage[];
  /**
   * 実行モード。省略時は approval-required。
   */
  mode?: AgentExecutionMode;
}

/**
 * handleChatMessage の出力。
 *  - kind="text": LLM がテキストのみを返した
 *  - kind="preview": LLM が skill 呼び出しを要求し、dry-run preview が生成された
 */
export type HandleChatMessageResult =
  | {
      kind: "text";
      conversationId: string | null;
      content: string;
    }
  | {
      kind: "preview";
      conversationId: string | null;
      content: string;
      preview: AgentDryRunPreview;
      intent: AgentSkillIntent;
    };

/**
 * チャットメッセージを処理する。
 *
 * フロー:
 * 1. enabledSkills から system prompt を構築
 * 2. llmInvoker を呼ぶ
 * 3. decision が text なら kind="text" で返す
 * 4. decision が skill なら
 *    - intent.packageName が enabledSkills に含まれるか確認
 *    - dryRunInvoker を呼び preview を作って kind="preview" で返す
 * 5. 監査ログに chat.send を記録
 */
export async function handleChatMessage(
  deps: AgentGatewayDeps,
  input: HandleChatMessageInput,
): Promise<HandleChatMessageResult> {
  if (!input.message || input.message.trim() === "") {
    throw new ValidationError("message is required");
  }

  const mode: AgentExecutionMode = input.mode ?? "approval-required";
  const systemPrompt = buildSystemPrompt(input.enabledSkills, mode);

  const decision = await deps.llmInvoker({
    workspaceId: input.workspaceId,
    actor: input.actor,
    systemPrompt,
    userMessage: input.message,
    conversationId: input.conversationId ?? null,
  });

  // 監査: chat.send (LLM 呼び出し自体を記録)
  await safeRecordAudit(deps.auditRepo, {
    workspaceId: input.workspaceId,
    actorId: input.actor.id,
    actorType: mapAuditActorType(input.actor.type),
    action: "agent.chat",
    resourceType: "agent_conversation",
    resourceId: input.conversationId ?? null,
    inputSummary: { message: input.message, mode },
    resultSummary: { decisionType: decision.type },
  });

  if (decision.type === "text") {
    return {
      kind: "text",
      conversationId: input.conversationId ?? null,
      content: decision.content,
    };
  }

  // skill 呼び出し要求: 有効化済みパッケージに含まれるか確認
  const pkg = input.enabledSkills.find((p) => p.name === decision.intent.packageName && p.enabled);
  if (!pkg) {
    throw new ValidationError(
      `LLM requested skill package not enabled: ${decision.intent.packageName}`,
      { packageName: decision.intent.packageName },
    );
  }

  const preview = await deps.dryRunInvoker({
    workspaceId: input.workspaceId,
    actor: input.actor,
    mode,
    intent: decision.intent,
  });

  return {
    kind: "preview",
    conversationId: input.conversationId ?? null,
    content: decision.content,
    preview,
    intent: decision.intent,
  };
}

// ───────────────────────────────────────────
// executeAgentAction (承認済みアクションの実行)
// ───────────────────────────────────────────

export interface ExecuteAgentActionInput {
  workspaceId: string;
  actor: AgentActor;
  intent: AgentSkillIntent;
  conversationId?: string | null;
  /** 実行モード。省略時は approval-required */
  mode?: AgentExecutionMode;
  /** 有効化済み skill package。含まれないパッケージは実行拒否 */
  enabledSkills: SkillPackage[];
}

export interface ExecuteAgentActionResult {
  outcome: AgentExecutionOutcome;
  auditLogId: string | null;
}

/**
 * 承認済みの skill action を実行する。
 *
 * フロー:
 * 1. enabledSkills に intent.packageName が含まれるか確認
 * 2. executeInvoker に委譲
 * 3. 成功時に agent.execute の監査ログを記録
 * 4. 失敗時も agent.execute.failed として監査ログを記録し、元例外を rethrow
 */
export async function executeAgentAction(
  deps: AgentGatewayDeps,
  input: ExecuteAgentActionInput,
): Promise<ExecuteAgentActionResult> {
  const mode: AgentExecutionMode = input.mode ?? "approval-required";

  const pkg = input.enabledSkills.find((p) => p.name === input.intent.packageName && p.enabled);
  if (!pkg) {
    throw new ValidationError(`Skill package not enabled: ${input.intent.packageName}`, {
      packageName: input.intent.packageName,
    });
  }

  try {
    const outcome = await deps.executeInvoker({
      workspaceId: input.workspaceId,
      actor: input.actor,
      mode,
      intent: input.intent,
    });

    const log = await safeRecordAudit(deps.auditRepo, {
      workspaceId: input.workspaceId,
      actorId: input.actor.id,
      actorType: mapAuditActorType(input.actor.type),
      action: "agent.execute",
      resourceType: "skill_action",
      resourceId: input.conversationId ?? null,
      inputSummary: {
        packageName: input.intent.packageName,
        actionName: input.intent.actionName,
        args: input.intent.args,
        mode,
      },
      resultSummary: { success: true, result: outcome.result },
    });

    return { outcome, auditLogId: log?.id ?? null };
  } catch (err) {
    await safeRecordAudit(deps.auditRepo, {
      workspaceId: input.workspaceId,
      actorId: input.actor.id,
      actorType: mapAuditActorType(input.actor.type),
      action: "agent.execute.failed",
      resourceType: "skill_action",
      resourceId: input.conversationId ?? null,
      inputSummary: {
        packageName: input.intent.packageName,
        actionName: input.intent.actionName,
        args: input.intent.args,
        mode,
      },
      resultSummary: {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      },
    });
    throw err;
  }
}

// ───────────────────────────────────────────
// system prompt 構築
// ───────────────────────────────────────────

/**
 * 有効な skill package から system prompt を構築する。
 * 各 package の manifest (JSON) に actions があればそれを enumerate して
 * LLM に「呼べる action 一覧」として提示する。
 *
 * v1 方針:
 *  - manifest は unknown な JSON として格納されているので、素朴に各フィールドを取り出す
 *  - 不正な shape は無視する (壊れた manifest が 1 件あっても他を諦めない)
 */
export function buildSystemPrompt(enabledSkills: SkillPackage[], mode: AgentExecutionMode): string {
  const header = [
    "You are the SNS Agent operator assistant.",
    "You can help the user with managing X / LINE / Instagram accounts.",
    "",
    `Current execution mode: ${mode}.`,
    mode === "read-only"
      ? "Only read-only actions are allowed in this mode."
      : mode === "draft"
        ? "Write actions are allowed only as drafts."
        : mode === "approval-required"
          ? "All write actions require explicit user approval before execution."
          : "Write actions will be executed immediately without further approval.",
    "",
    "When you want to perform an action, respond with a single JSON object of the form:",
    `  {"action":"<action name>","args":{...},"package":"<skill package name>"}`,
    "Otherwise respond with plain text only.",
    "",
    "Available skill packages and actions:",
  ];

  const lines: string[] = [];
  for (const pkg of enabledSkills) {
    if (!pkg.enabled) continue;
    const manifestActions = extractActionsForPrompt(pkg.manifest);
    if (manifestActions.length === 0) {
      lines.push(`- package ${pkg.name}@${pkg.version} (platform=${pkg.platform}): (no actions)`);
      continue;
    }
    lines.push(`- package ${pkg.name}@${pkg.version} (platform=${pkg.platform}):`);
    for (const action of manifestActions) {
      lines.push(`    - ${action.name}: ${action.description}`);
    }
  }
  if (lines.length === 0) {
    lines.push("(no skill packages enabled)");
  }

  return [...header, ...lines].join("\n");
}

interface PromptAction {
  name: string;
  description: string;
}

function extractActionsForPrompt(manifest: unknown): PromptAction[] {
  if (manifest === null || typeof manifest !== "object") return [];
  const actions = (manifest as { actions?: unknown }).actions;
  if (!Array.isArray(actions)) return [];
  const result: PromptAction[] = [];
  for (const a of actions) {
    if (a === null || typeof a !== "object") continue;
    const name = (a as { name?: unknown }).name;
    const description = (a as { description?: unknown }).description;
    if (typeof name === "string" && typeof description === "string") {
      result.push({ name, description });
    }
  }
  return result;
}

// ───────────────────────────────────────────
// ヘルパー
// ───────────────────────────────────────────

function mapAuditActorType(type: ActorType): "user" | "agent" | "system" {
  return type;
}

/**
 * 監査ログ記録は best-effort。失敗で主処理を壊さない。
 */
async function safeRecordAudit(
  repo: AuditLogRepository,
  input: {
    workspaceId: string;
    actorId: string;
    actorType: "user" | "agent" | "system";
    action: string;
    resourceType: string;
    resourceId: string | null;
    inputSummary: unknown;
    resultSummary: unknown;
  },
): Promise<AuditLog | null> {
  try {
    return await recordAudit(repo, {
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      actorType: input.actorType,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      inputSummary: input.inputSummary,
      resultSummary: input.resultSummary,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[agent-gateway] failed to write audit log", err);
    return null;
  }
}
