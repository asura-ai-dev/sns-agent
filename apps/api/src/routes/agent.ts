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
  listAccounts,
  listPosts,
  createPost,
  schedulePost,
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
  type AccountUsecaseDeps,
  type PostUsecaseDeps,
  type ScheduleUsecaseDeps,
  type ListPostsFilters,
  type Post,
} from "@sns-agent/core";
import type { Platform, Role } from "@sns-agent/config";
import {
  DrizzleAccountRepository,
  DrizzleAuditLogRepository,
  DrizzleLlmRouteRepository,
  DrizzlePostRepository,
  DrizzleScheduledJobRepository,
  DrizzleSkillPackageRepository,
  DrizzleUsageRepository,
} from "@sns-agent/db";
import type { DbClient } from "@sns-agent/db";
import { getProviderRegistry } from "../providers.js";
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

// ───────────────────────────────────────────
// 実 invoker (Task 5006)
// ───────────────────────────────────────────

/**
 * Skill action 実行コンテキストから core use case 用の依存を組み立てる。
 *
 * - accountRepo / postRepo / scheduledJobRepo / usageRepo は Drizzle 実装を直接生成
 * - providers は ProviderRegistry から取得
 * - encryptionKey は ENCRYPTION_KEY env (開発デフォルトあり)
 *
 * skill action は "approval-required" 経路で来るため、執筆系 use case
 * (createPost / schedulePost) に必要な最低限の deps だけを提供する。
 * budgetPolicyRepo / approvalRepo は v1 では skill 経路から require-approval
 * を発火させない方針で、createPost(publishNow=true) は publishPostChecked を
 * 経由しても budgetPolicyRepo 未設定 → 予算チェックをスキップで動作する。
 */
function buildSkillUsecaseDeps(db: DbClient): {
  accountDeps: AccountUsecaseDeps;
  postDeps: PostUsecaseDeps;
  scheduleDeps: ScheduleUsecaseDeps;
} {
  const encryptionKey =
    process.env.ENCRYPTION_KEY ||
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const callbackBaseUrl = `${process.env.WEB_URL || "http://localhost:3001"}/api/accounts/callback`;

  const accountRepo = new DrizzleAccountRepository(db);
  const postRepo = new DrizzlePostRepository(db);
  const scheduledJobRepo = new DrizzleScheduledJobRepository(db);
  const usageRepo = new DrizzleUsageRepository(db);
  const providers = getProviderRegistry().getAll();

  const postDeps: PostUsecaseDeps = {
    postRepo,
    accountRepo,
    providers,
    encryptionKey,
    usageRepo,
    scheduledJobRepo,
  };

  const accountDeps: AccountUsecaseDeps = {
    accountRepo,
    providers,
    encryptionKey,
    callbackBaseUrl,
  };

  const scheduleDeps: ScheduleUsecaseDeps = {
    scheduledJobRepo,
    postRepo,
    postUsecaseDeps: postDeps,
  };

  return { accountDeps, postDeps, scheduleDeps };
}

/**
 * args に含まれる accountName を SocialAccount.id に解決する。
 *
 * - まず id 一致を試す
 * - 次に displayName 完全一致を試す
 * - それでも見つからない場合は ValidationError
 *
 * platform が args に含まれる場合はその platform に絞り込む。
 */
async function resolveSocialAccountId(
  deps: PostUsecaseDeps,
  workspaceId: string,
  args: Record<string, unknown>,
): Promise<string> {
  const accountName = typeof args.accountName === "string" ? args.accountName : null;
  const explicitId = typeof args.socialAccountId === "string" ? args.socialAccountId : null;

  if (explicitId) return explicitId;
  if (!accountName) {
    throw new ValidationError("accountName or socialAccountId is required");
  }

  const accounts = await deps.accountRepo.findByWorkspace(workspaceId);
  const platformFilter = typeof args.platform === "string" ? (args.platform as Platform) : null;
  const candidates = platformFilter
    ? accounts.filter((a) => a.platform === platformFilter)
    : accounts;

  // ID 一致
  const byId = candidates.find((a) => a.id === accountName);
  if (byId) return byId.id;

  // displayName 完全一致
  const byName = candidates.find((a) => a.displayName === accountName);
  if (byName) return byName.id;

  throw new ValidationError(
    `SocialAccount not found for accountName="${accountName}"${
      platformFilter ? ` (platform=${platformFilter})` : ""
    }`,
  );
}

/**
 * skill action args を ListPostsFilters にマップする。
 *
 * 受け付けるキー:
 * - status: 単一ステータス (Post["status"])
 * - limit:  最大取得件数
 * - platform: 単一プラットフォーム
 */
function mapListPostsFilters(args: Record<string, unknown>): ListPostsFilters {
  const filters: ListPostsFilters = {};
  if (typeof args.status === "string") {
    filters.status = args.status as Post["status"];
  }
  if (typeof args.limit === "number" && Number.isFinite(args.limit) && args.limit > 0) {
    filters.limit = args.limit;
  }
  if (typeof args.platform === "string") {
    filters.platform = args.platform as Platform;
  }
  return filters;
}

/**
 * Post を invoker レスポンスに整形する。
 */
function summarizePost(post: Post): Record<string, unknown> {
  return {
    id: post.id,
    status: post.status,
    platform: post.platform,
    socialAccountId: post.socialAccountId,
    contentText: post.contentText,
    publishedAt: post.publishedAt ? post.publishedAt.toISOString() : null,
    createdAt: post.createdAt.toISOString(),
  };
}

/**
 * action 名から core use case を呼び出す invoker を生成する。
 *
 * 対応 action:
 *  - list_accounts  → listAccounts(accountDeps, workspaceId)
 *  - list_posts     → listPosts(postDeps, workspaceId, filters)
 *  - create_post    → createPost(postDeps, { ... })
 *  - schedule_post  → createPost(draft) → schedulePost(scheduleDeps, ...)
 *  - 未知の action  → { status: "unsupported_action", actionName }
 *
 * 戻り値は監査ログ / API レスポンスに載る Record<string, unknown>。
 */
function buildSkillActionInvoker(db: DbClient): SkillActionInvoker {
  const { accountDeps, postDeps, scheduleDeps } = buildSkillUsecaseDeps(db);

  return async ({ workspaceId, actor, actionName, args }) => {
    switch (actionName) {
      case "list_accounts": {
        const data = await listAccounts(accountDeps, workspaceId);
        return {
          status: "ok",
          actionName,
          count: data.length,
          accounts: data.map((a) => ({
            id: a.id,
            platform: a.platform,
            displayName: a.displayName,
            status: a.status,
            tokenExpiryWarning: a.tokenExpiryWarning,
          })),
        };
      }

      case "list_posts": {
        const filters = mapListPostsFilters(args);
        const result = await listPosts(postDeps, workspaceId, filters);
        return {
          status: "ok",
          actionName,
          total: result.meta.total,
          page: result.meta.page,
          limit: result.meta.limit,
          posts: result.data.map(summarizePost),
        };
      }

      case "create_post": {
        const text = typeof args.text === "string" ? args.text : null;
        if (!text) {
          throw new ValidationError("text is required for create_post");
        }
        const publishNow = args.publishNow === true;
        const socialAccountId = await resolveSocialAccountId(postDeps, workspaceId, args);

        const created = await createPost(postDeps, {
          workspaceId,
          socialAccountId,
          contentText: text,
          publishNow,
          createdBy: actor.id,
        });

        return {
          status: publishNow ? created.status : "draft_created",
          actionName,
          id: created.id,
          post: summarizePost(created),
        };
      }

      case "schedule_post": {
        const text = typeof args.text === "string" ? args.text : null;
        if (!text) {
          throw new ValidationError("text is required for schedule_post");
        }
        const scheduledAtRaw = typeof args.scheduledAt === "string" ? args.scheduledAt : null;
        if (!scheduledAtRaw) {
          throw new ValidationError("scheduledAt is required (ISO 8601 string)");
        }
        const scheduledAt = new Date(scheduledAtRaw);
        if (Number.isNaN(scheduledAt.getTime())) {
          throw new ValidationError(`Invalid scheduledAt: ${scheduledAtRaw}`);
        }

        const socialAccountId = await resolveSocialAccountId(postDeps, workspaceId, args);

        // 1. draft を作成
        const draft = await createPost(postDeps, {
          workspaceId,
          socialAccountId,
          contentText: text,
          publishNow: false,
          createdBy: actor.id,
        });

        // 2. schedulePost で予約ジョブを生成
        const job = await schedulePost(scheduleDeps, {
          workspaceId,
          postId: draft.id,
          scheduledAt,
        });

        return {
          status: "scheduled",
          actionName,
          id: job.id,
          postId: draft.id,
          scheduledAt: job.scheduledAt.toISOString(),
          jobStatus: job.status,
        };
      }

      default:
        return {
          status: "unsupported_action",
          actionName,
        };
    }
  };
}

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
  const skillInvoker = buildSkillActionInvoker(db);

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
      const result = await executeSkillAction({ invoker: skillInvoker }, ctx);
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
