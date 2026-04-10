/**
 * Agent Gateway ルート
 *
 * Task 5002: design.md セクション 4.2 / architecture.md セクション 8.2-8.5 に準拠。
 *
 * エンドポイント:
 *  - POST /api/agent/chat    : チャット送信 (chat:use)
 *  - POST /api/agent/execute : 承認済み skill action 実行 (chat:use + action 権限)
 *  - GET  /api/agent/history : チャット履歴 (chat:use)
 *
 * 実装方針:
 *  - LLM 呼び出しは @sns-agent/llm の executeLlmCall + resolveLlmRoute を使う。
 *  - skill 実行は @sns-agent/skills の executeSkillAction / dryRunSkillAction を使う。
 *  - core の handleChatMessage / executeAgentAction はこの 2 つの DI ポイントを抽象化する。
 *  - 有効化済み skill package は skill_packages テーブルから直接読み取る
 *    (Task 5002 時点では DrizzleSkillPackageRepository が存在しないため)。
 *  - チャット履歴は audit_logs の action="agent.chat" / "agent.execute" を利用する。
 *  - LLM 応答の skill intent 解析は JSON パース (v1 方針)。
 *  - ストリーミングは v1.5 以降で追加予定 (現在は非ストリーミング JSON 応答)。
 */
import { Hono } from "hono";
import {
  ValidationError,
  checkPermission,
  handleChatMessage,
  executeAgentAction,
  listAuditLogs,
  type AgentActor,
  type AgentDryRunPreview,
  type AgentExecutionMode,
  type AgentExecutionOutcome,
  type AgentGatewayDeps,
  type AgentLlmDecision,
  type AgentSkillIntent,
  type Actor,
  type SkillPackage,
  type Permission,
} from "@sns-agent/core";
import type { Role } from "@sns-agent/config";
import {
  DrizzleAuditLogRepository,
  DrizzleLlmRouteRepository,
  DrizzleSkillPackageRepository,
  DrizzleUsageRepository,
} from "@sns-agent/db";
import type { DbClient } from "@sns-agent/db";
import {
  buildDefaultAdapters,
  executeLlmCall,
  resolveLlmRoute,
  type ChatMessage,
} from "@sns-agent/llm";
import {
  dryRunSkillAction,
  executeSkillAction,
  type SkillActionInvoker,
  type SkillExecutionContext,
  type SkillExecutionMode,
  type SkillManifest,
} from "@sns-agent/skills";
import { requirePermission } from "../middleware/rbac.js";
import type { AppVariables } from "../types.js";

const agent = new Hono<{ Variables: AppVariables }>();

// ───────────────────────────────────────────
// skill package 読み込み
// ───────────────────────────────────────────

/**
 * ワークスペースの有効化済み skill package 一覧を取得する。
 * DrizzleSkillPackageRepository (onlyEnabled=true) を通じて読む。
 */
async function loadEnabledSkillPackages(
  db: DbClient,
  workspaceId: string,
): Promise<SkillPackage[]> {
  const repo = new DrizzleSkillPackageRepository(db);
  return repo.findByWorkspace(workspaceId, true);
}

/**
 * package name から manifest を取り出し、SkillManifest として返す。
 * 見つからない or shape が不正な場合は null。
 */
function pickManifest(pkgs: SkillPackage[], name: string): SkillManifest | null {
  const pkg = pkgs.find((p) => p.name === name);
  if (!pkg) return null;
  const m = pkg.manifest as unknown;
  if (m === null || typeof m !== "object") return null;
  return m as SkillManifest;
}

// ───────────────────────────────────────────
// LLM 応答の decision 解析
// ───────────────────────────────────────────

/**
 * LLM の応答から skill intent を抽出する。
 *
 * v1 ルール:
 *  - 応答全体が JSON object で action / args / package を含むなら skill intent
 *  - 応答中に \`\`\`json ... \`\`\` ブロックがあり、その中身が同じ形なら skill intent
 *  - それ以外は text 応答として扱う
 */
function parseLlmDecision(content: string): AgentLlmDecision {
  const trimmed = content.trim();
  // ケース 1: 生の JSON オブジェクト
  const direct = tryParseIntent(trimmed);
  if (direct) return { type: "skill", content, intent: direct };

  // ケース 2: ```json ... ``` フェンスブロック
  const fenceMatch = trimmed.match(/```json\s*([\s\S]*?)\s*```/);
  if (fenceMatch) {
    const inner = tryParseIntent(fenceMatch[1]);
    if (inner) return { type: "skill", content, intent: inner };
  }

  return { type: "text", content };
}

function tryParseIntent(raw: string): AgentSkillIntent | null {
  if (!raw || !raw.startsWith("{")) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;
  const obj = parsed as {
    action?: unknown;
    args?: unknown;
    package?: unknown;
    packageName?: unknown;
  };
  const actionName = typeof obj.action === "string" ? obj.action : null;
  const packageName =
    typeof obj.package === "string"
      ? obj.package
      : typeof obj.packageName === "string"
        ? obj.packageName
        : null;
  if (!actionName || !packageName) return null;
  const args =
    obj.args !== null && typeof obj.args === "object" && !Array.isArray(obj.args)
      ? (obj.args as Record<string, unknown>)
      : {};
  return { actionName, args, packageName };
}

// ───────────────────────────────────────────
// 実行モード
// ───────────────────────────────────────────

function parseExecutionMode(raw: unknown): AgentExecutionMode {
  if (
    raw === "read-only" ||
    raw === "draft" ||
    raw === "approval-required" ||
    raw === "direct-execute"
  ) {
    return raw;
  }
  return "approval-required";
}

function toSkillMode(mode: AgentExecutionMode): SkillExecutionMode {
  return mode;
}

// ───────────────────────────────────────────
// skill invoker (dry-run / execute)
// ───────────────────────────────────────────

/**
 * v1 時点では skill action 実行の具体的なマッピングはこのルート内で行う。
 * 実装済みの core use case (post 系) にマップしたいが、結合強度を下げるため、
 * invoker は action 名 → 「この時点ではエコーバック」の最小実装とし、
 * 実装の拡張ポイントとして残す。
 *
 * Task 5003+ で actual invoker (createPost / publishPost 等へのルーティング) を実装する。
 */
const placeholderInvoker: SkillActionInvoker = async (params) => {
  return {
    status: "deferred",
    message:
      "Skill action mapping is not yet implemented in v1 runtime. The action was validated and authorized successfully.",
    actionName: params.actionName,
    args: params.args,
  };
};

function makeSkillContext(params: {
  workspaceId: string;
  manifest: SkillManifest;
  intent: AgentSkillIntent;
  actor: AgentActor;
  mode: AgentExecutionMode;
}): SkillExecutionContext {
  return {
    workspaceId: params.workspaceId,
    manifest: params.manifest,
    actionName: params.intent.actionName,
    args: params.intent.args,
    actor: {
      id: params.actor.id,
      role: params.actor.role,
      type: params.actor.type === "agent" ? "agent" : "user",
    },
    mode: toSkillMode(params.mode),
  };
}

// ───────────────────────────────────────────
// Deps 構築
// ───────────────────────────────────────────

function buildGatewayDeps(db: DbClient, actor: Actor): AgentGatewayDeps {
  const llmRouteRepo = new DrizzleLlmRouteRepository(db);
  const usageRepo = new DrizzleUsageRepository(db);
  const auditRepo = new DrizzleAuditLogRepository(db);

  const adapters = buildDefaultAdapters({
    openAiApiKey: process.env.OPENAI_API_KEY,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  });

  return {
    llmInvoker: async ({ workspaceId, systemPrompt, userMessage }) => {
      const resolved = await resolveLlmRoute(llmRouteRepo, workspaceId, {
        action: "chat",
      });
      if (!resolved) {
        throw new ValidationError(
          "No LLM route configured for this workspace. Configure /api/llm/routes first.",
        );
      }
      const messages: ChatMessage[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ];
      const response = await executeLlmCall(
        {
          usageRepo,
          adapters,
          actor: {
            workspaceId,
            actorId: actor.id,
            actorType: actor.type,
          },
        },
        resolved,
        messages,
      );
      return parseLlmDecision(response.content);
    },

    dryRunInvoker: async ({ workspaceId, actor: a, mode, intent }) => {
      const enabled = await loadEnabledSkillPackages(db, workspaceId);
      const manifest = pickManifest(enabled, intent.packageName);
      if (!manifest) {
        throw new ValidationError(
          `Skill package manifest not found or invalid: ${intent.packageName}`,
        );
      }
      const ctx = makeSkillContext({
        workspaceId,
        manifest,
        intent,
        actor: a,
        mode,
      });
      const preview = dryRunSkillAction(ctx);
      return mapDryRunPreview(preview, intent.packageName);
    },

    executeInvoker: async ({ workspaceId, actor: a, mode, intent }) => {
      const enabled = await loadEnabledSkillPackages(db, workspaceId);
      const manifest = pickManifest(enabled, intent.packageName);
      if (!manifest) {
        throw new ValidationError(
          `Skill package manifest not found or invalid: ${intent.packageName}`,
        );
      }
      const ctx = makeSkillContext({
        workspaceId,
        manifest,
        intent,
        actor: a,
        mode,
      });
      const result = await executeSkillAction({ invoker: placeholderInvoker }, ctx);
      const outcome: AgentExecutionOutcome = {
        actionName: result.actionName,
        packageName: intent.packageName,
        result: result.result,
        mode,
      };
      return outcome;
    },

    auditRepo,
  };
}

function mapDryRunPreview(
  preview: ReturnType<typeof dryRunSkillAction>,
  packageName: string,
): AgentDryRunPreview {
  return {
    actionName: preview.actionName,
    packageName,
    description: preview.description,
    preview: preview.preview,
    requiredPermissions: preview.requiredPermissions as string[],
    missingPermissions: preview.missingPermissions as string[],
    argumentErrors: preview.argumentErrors,
    mode: preview.mode as AgentExecutionMode,
    allowed: preview.allowed,
    blockedReason: preview.blockedReason,
  };
}

// ───────────────────────────────────────────
// ヘルパー: actor 型変換
// ───────────────────────────────────────────

function toAgentActor(actor: Actor): AgentActor {
  return {
    id: actor.id,
    role: actor.role as Role,
    type: actor.type,
  };
}

// ───────────────────────────────────────────
// POST /api/agent/chat
// ───────────────────────────────────────────

agent.post("/chat", requirePermission("chat:use"), async (c) => {
  const actor = c.get("actor");
  const db = c.get("db");

  const body = (await c.req.json().catch(() => {
    throw new ValidationError("Invalid JSON body");
  })) as { message?: unknown; conversationId?: unknown; mode?: unknown };

  if (typeof body.message !== "string" || body.message.trim() === "") {
    throw new ValidationError("message is required (non-empty string)");
  }
  const conversationId =
    typeof body.conversationId === "string" && body.conversationId.length > 0
      ? body.conversationId
      : null;
  const mode = parseExecutionMode(body.mode);

  const enabled = await loadEnabledSkillPackages(db, actor.workspaceId);
  const deps = buildGatewayDeps(db, actor);

  const result = await handleChatMessage(deps, {
    workspaceId: actor.workspaceId,
    actor: toAgentActor(actor),
    message: body.message,
    conversationId,
    enabledSkills: enabled,
    mode,
  });

  if (result.kind === "text") {
    return c.json({
      data: {
        kind: "text",
        conversationId: result.conversationId,
        content: result.content,
      },
    });
  }

  return c.json({
    data: {
      kind: "preview",
      conversationId: result.conversationId,
      content: result.content,
      intent: result.intent,
      preview: result.preview,
    },
  });
});

// ───────────────────────────────────────────
// POST /api/agent/execute
// ───────────────────────────────────────────

agent.post("/execute", requirePermission("chat:use"), async (c) => {
  const actor = c.get("actor");
  const db = c.get("db");

  const body = (await c.req.json().catch(() => {
    throw new ValidationError("Invalid JSON body");
  })) as {
    actionName?: unknown;
    args?: unknown;
    packageName?: unknown;
    conversationId?: unknown;
    mode?: unknown;
  };

  if (typeof body.actionName !== "string" || body.actionName === "") {
    throw new ValidationError("actionName is required");
  }
  if (typeof body.packageName !== "string" || body.packageName === "") {
    throw new ValidationError("packageName is required");
  }
  const args =
    body.args !== null && typeof body.args === "object" && !Array.isArray(body.args)
      ? (body.args as Record<string, unknown>)
      : {};
  const conversationId =
    typeof body.conversationId === "string" && body.conversationId.length > 0
      ? body.conversationId
      : null;
  const mode = parseExecutionMode(body.mode);

  // 追加の権限チェック: action.permissions を actor role と突き合わせ
  const enabled = await loadEnabledSkillPackages(db, actor.workspaceId);
  const manifest = pickManifest(enabled, body.packageName);
  if (!manifest) {
    throw new ValidationError(`Skill package not enabled: ${body.packageName}`);
  }
  const action = manifest.actions?.find?.((a) => a.name === body.actionName);
  if (!action) {
    throw new ValidationError(
      `Action "${body.actionName}" not found in package "${body.packageName}"`,
    );
  }
  for (const perm of action.permissions ?? []) {
    if (!checkPermission(actor.role, perm as Permission)) {
      return c.json(
        {
          error: {
            code: "AUTH_FORBIDDEN",
            message: `Insufficient permission: ${perm} required for action ${body.actionName}`,
            details: { requiredPermission: perm, actorRole: actor.role },
          },
        },
        403,
      );
    }
  }

  const deps = buildGatewayDeps(db, actor);
  const intent: AgentSkillIntent = {
    actionName: body.actionName,
    packageName: body.packageName,
    args,
  };

  const result = await executeAgentAction(deps, {
    workspaceId: actor.workspaceId,
    actor: toAgentActor(actor),
    intent,
    conversationId,
    mode,
    enabledSkills: enabled,
  });

  return c.json({
    data: {
      outcome: result.outcome,
      auditLogId: result.auditLogId,
    },
  });
});

// ───────────────────────────────────────────
// GET /api/agent/history
// ───────────────────────────────────────────

agent.get("/history", requirePermission("chat:use"), async (c) => {
  const actor = c.get("actor");
  const db = c.get("db");

  const pageRaw = c.req.query("page");
  const limitRaw = c.req.query("limit");
  const conversationId = c.req.query("conversationId") ?? undefined;
  const page = pageRaw ? Number.parseInt(pageRaw, 10) : 1;
  const limit = limitRaw ? Math.min(Number.parseInt(limitRaw, 10) || 50, 200) : 50;

  const auditRepo = new DrizzleAuditLogRepository(db);

  // audit_logs から agent.chat / agent.execute / agent.execute.failed を抽出
  const filters = {
    actorId: actor.id,
  } as { actorId: string };

  const result = await listAuditLogs(auditRepo, {
    workspaceId: actor.workspaceId,
    filters,
    page,
    limit,
  });

  // agent 系だけに絞る
  const agentActions = new Set(["agent.chat", "agent.execute", "agent.execute.failed"]);
  let entries = result.data.filter((log) => agentActions.has(log.action));
  if (conversationId) {
    entries = entries.filter((log) => log.resourceId === conversationId);
  }

  return c.json({
    data: entries.map((log) => ({
      id: log.id,
      action: log.action,
      conversationId: log.resourceId,
      inputSummary: log.inputSummary,
      resultSummary: log.resultSummary,
      createdAt: log.createdAt.toISOString(),
    })),
    meta: {
      page,
      limit,
      total: entries.length,
    },
  });
});

export { agent };
