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
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import {
  ValidationError,
  checkPermission,
  handleChatMessage,
  executeAgentAction,
  listAuditLogs,
  listPosts,
  createPost,
  schedulePost,
  listSchedules,
  listThreads,
  type AgentActor,
  type AgentDryRunPreview,
  type AgentExecutionMode,
  type AgentExecutionOutcome,
  type AgentGatewayDeps,
  type AgentLlmDecision,
  type AgentSkillIntent,
  type Actor,
  type AuditLog,
  type SkillPackage,
  type Permission,
  type PostUsecaseDeps,
  type ScheduleUsecaseDeps,
  type InboxUsecaseDeps,
  type ListPostsFilters,
  type Post,
  type ScheduledJob,
  type ConversationThread,
  type ThreadStatus,
} from "@sns-agent/core";
import type { Platform, Role } from "@sns-agent/config";
import {
  DrizzleAccountRepository,
  DrizzleAuditLogRepository,
  DrizzleConversationRepository,
  DrizzleLlmRouteRepository,
  DrizzleMessageRepository,
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
const TIMEZONE_AWARE_ISO_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

type AgentAccountResolutionStatus = "resolved" | "missing" | "not-found" | "ambiguous";

interface AgentAccountCandidateSummary {
  id: string;
  displayName: string;
  platform: Platform;
}

interface AgentAccountResolutionResult {
  status: AgentAccountResolutionStatus;
  input: string | null;
  resolved: AgentAccountCandidateSummary | null;
  candidates: AgentAccountCandidateSummary[];
}

interface AgentAccountLookup {
  findByWorkspace(
    workspaceId: string,
  ): Promise<Array<{ id: string; displayName: string; platform: Platform }>>;
}

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

export function ensureConversationId(raw: unknown): string {
  return typeof raw === "string" && raw.trim().length > 0 ? raw : `agent-${randomUUID()}`;
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
  postDeps: PostUsecaseDeps;
  scheduleDeps: ScheduleUsecaseDeps;
  inboxDeps: InboxUsecaseDeps;
} {
  const encryptionKey =
    process.env.ENCRYPTION_KEY ||
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

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

  const scheduleDeps: ScheduleUsecaseDeps = {
    scheduledJobRepo,
    postRepo,
    postUsecaseDeps: postDeps,
  };

  const inboxDeps: InboxUsecaseDeps = {
    conversationRepo: new DrizzleConversationRepository(db),
    messageRepo: new DrizzleMessageRepository(db),
    accountRepo,
    usageRepo,
    providers,
    encryptionKey,
  };

  return { postDeps, scheduleDeps, inboxDeps };
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
function summarizeAccountCandidate(account: {
  id: string;
  displayName: string;
  platform: Platform;
}): AgentAccountCandidateSummary {
  return {
    id: account.id,
    displayName: account.displayName,
    platform: account.platform,
  };
}

function buildAccountResolutionError(
  resolution: AgentAccountResolutionResult,
  platformFilter: Platform | null,
): ValidationError {
  if (resolution.status === "missing") {
    return new ValidationError("accountName or socialAccountId is required");
  }

  if (resolution.status === "ambiguous") {
    const candidateSummary = resolution.candidates
      .map((candidate) => `${candidate.displayName} [${candidate.id}]`)
      .join(", ");
    return new ValidationError(
      `SocialAccount is ambiguous for accountName="${resolution.input ?? ""}"${
        platformFilter ? ` (platform=${platformFilter})` : ""
      }`,
      {
        accountName: resolution.input,
        platform: platformFilter,
        candidates: resolution.candidates,
        candidateSummary,
      },
    );
  }

  return new ValidationError(
    `SocialAccount not found for accountName="${resolution.input ?? ""}"${
      platformFilter ? ` (platform=${platformFilter})` : ""
    }`,
    {
      accountName: resolution.input,
      platform: platformFilter,
    },
  );
}

async function resolveAgentAccountReference(
  accountRepo: AgentAccountLookup,
  workspaceId: string,
  args: Record<string, unknown>,
  options: { defaultPlatform?: Platform } = {},
): Promise<AgentAccountResolutionResult> {
  const accountName = typeof args.accountName === "string" ? args.accountName.trim() : "";
  const explicitId = typeof args.socialAccountId === "string" ? args.socialAccountId.trim() : "";
  const input = explicitId || accountName || null;

  if (!input) {
    return {
      status: "missing",
      input: null,
      resolved: null,
      candidates: [],
    };
  }

  const accounts = await accountRepo.findByWorkspace(workspaceId);
  const platformFilter =
    typeof args.platform === "string"
      ? (args.platform as Platform)
      : (options.defaultPlatform ?? null);
  const candidates = platformFilter
    ? accounts.filter((account) => account.platform === platformFilter)
    : accounts;

  if (explicitId) {
    const matches = candidates.filter((account) => account.id === explicitId);
    if (matches.length === 1) {
      return {
        status: "resolved",
        input: explicitId,
        resolved: summarizeAccountCandidate(matches[0]),
        candidates: [summarizeAccountCandidate(matches[0])],
      };
    }

    return {
      status: "not-found",
      input: explicitId,
      resolved: null,
      candidates: [],
    };
  }

  const idMatches = candidates.filter((account) => account.id === accountName);
  if (idMatches.length === 1) {
    return {
      status: "resolved",
      input: accountName,
      resolved: summarizeAccountCandidate(idMatches[0]),
      candidates: [summarizeAccountCandidate(idMatches[0])],
    };
  }

  if (idMatches.length > 1) {
    return {
      status: "ambiguous",
      input: accountName,
      resolved: null,
      candidates: idMatches.map(summarizeAccountCandidate),
    };
  }

  const nameMatches = candidates.filter((account) => account.displayName === accountName);
  if (nameMatches.length === 1) {
    return {
      status: "resolved",
      input: accountName,
      resolved: summarizeAccountCandidate(nameMatches[0]),
      candidates: [summarizeAccountCandidate(nameMatches[0])],
    };
  }

  if (nameMatches.length > 1) {
    return {
      status: "ambiguous",
      input: accountName,
      resolved: null,
      candidates: nameMatches.map(summarizeAccountCandidate),
    };
  }

  return {
    status: "not-found",
    input: accountName,
    resolved: null,
    candidates: [],
  };
}

export function normalizeAgentScheduledAt(raw: string): {
  ok: boolean;
  normalized: string | null;
  reason: string | null;
} {
  const value = raw.trim();
  if (value === "") {
    return {
      ok: false,
      normalized: null,
      reason: "scheduledAt is required (timezone-aware ISO 8601 string)",
    };
  }

  if (!TIMEZONE_AWARE_ISO_PATTERN.test(value)) {
    return {
      ok: false,
      normalized: null,
      reason: "scheduledAt must be a timezone-aware ISO 8601 string like 2026-04-15T09:00:00+09:00",
    };
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return {
      ok: false,
      normalized: null,
      reason: `Invalid scheduledAt: ${raw}`,
    };
  }

  return {
    ok: true,
    normalized: parsed.toISOString(),
    reason: null,
  };
}

async function resolveSocialAccountId(
  deps: PostUsecaseDeps,
  workspaceId: string,
  args: Record<string, unknown>,
  options: { defaultPlatform?: Platform } = {},
): Promise<string> {
  const platformFilter =
    typeof args.platform === "string"
      ? (args.platform as Platform)
      : (options.defaultPlatform ?? null);
  const resolution = await resolveAgentAccountReference(
    deps.accountRepo,
    workspaceId,
    args,
    options,
  );
  if (resolution.status !== "resolved" || !resolution.resolved) {
    throw buildAccountResolutionError(resolution, platformFilter);
  }
  return resolution.resolved.id;
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

function summarizeScheduledJob(job: ScheduledJob): Record<string, unknown> {
  return {
    id: job.id,
    postId: job.postId,
    scheduledAt: job.scheduledAt.toISOString(),
    status: job.status,
    attemptCount: job.attemptCount,
    maxAttempts: job.maxAttempts,
    lastError: job.lastError,
    nextRetryAt: job.nextRetryAt ? job.nextRetryAt.toISOString() : null,
    completedAt: job.completedAt ? job.completedAt.toISOString() : null,
  };
}

function summarizeThread(thread: ConversationThread): Record<string, unknown> {
  return {
    id: thread.id,
    socialAccountId: thread.socialAccountId,
    platform: thread.platform,
    participantName: thread.participantName,
    channel: thread.channel,
    status: thread.status,
    lastMessageAt: thread.lastMessageAt ? thread.lastMessageAt.toISOString() : null,
    createdAt: thread.createdAt.toISOString(),
  };
}

function mapScheduleListFilters(
  args: Record<string, unknown>,
): Parameters<typeof listSchedules>[2] {
  const filters: Parameters<typeof listSchedules>[2] = {};
  if (typeof args.status === "string") {
    filters.status = args.status as ScheduledJob["status"];
  }
  if (typeof args.limit === "number" && Number.isFinite(args.limit) && args.limit > 0) {
    filters.limit = args.limit;
  }
  if (typeof args.from === "string") {
    const from = new Date(args.from);
    if (!Number.isNaN(from.getTime())) filters.from = from;
  }
  if (typeof args.to === "string") {
    const to = new Date(args.to);
    if (!Number.isNaN(to.getTime())) filters.to = to;
  }
  return filters;
}

function mapInboxListFilters(args: Record<string, unknown>): Parameters<typeof listThreads>[2] {
  const filters: Parameters<typeof listThreads>[2] = { platform: "x" };
  if (typeof args.status === "string") {
    filters.status = args.status as ThreadStatus;
  }
  if (typeof args.limit === "number" && Number.isFinite(args.limit) && args.limit > 0) {
    filters.limit = args.limit;
  }
  if (typeof args.offset === "number" && Number.isFinite(args.offset) && args.offset >= 0) {
    filters.offset = args.offset;
  }
  return filters;
}

export async function enrichPreviewForChat(params: {
  db: DbClient;
  workspaceId: string;
  intent: AgentSkillIntent;
  preview: AgentDryRunPreview;
}): Promise<AgentDryRunPreview> {
  const { db, workspaceId, intent, preview } = params;
  if (
    preview.preview === null ||
    typeof preview.preview !== "object" ||
    Array.isArray(preview.preview)
  ) {
    return preview;
  }

  if (intent.actionName !== "post.create" && intent.actionName !== "post.schedule") {
    return preview;
  }

  const payload = { ...(preview.preview as Record<string, unknown>) };
  const accountInput =
    typeof intent.args.accountName === "string"
      ? intent.args.accountName
      : typeof intent.args.socialAccountId === "string"
        ? intent.args.socialAccountId
        : null;
  const accountResolution = await resolveAgentAccountReference(
    new DrizzleAccountRepository(db),
    workspaceId,
    intent.args,
    {
      defaultPlatform: "x",
    },
  );
  const nextArgumentErrors = [...preview.argumentErrors];
  let blockedReason = preview.blockedReason;
  let allowed = preview.allowed;

  payload.platform = "x";
  payload.accountInput = accountInput ?? "(required)";
  payload.accountResolutionStatus = accountResolution.status;
  payload.targetAccountName =
    accountResolution.resolved?.displayName ?? accountInput ?? "(required)";
  payload.targetAccountId = accountResolution.resolved?.id ?? null;

  if (accountResolution.status === "ambiguous") {
    const candidates = accountResolution.candidates.map((candidate) => ({
      id: candidate.id,
      displayName: candidate.displayName,
      platform: candidate.platform,
    }));
    payload.accountCandidates = candidates;
    const error = `accountName matched multiple X accounts: ${candidates
      .map((candidate) => `${candidate.displayName} [${candidate.id}]`)
      .join(", ")}`;
    if (!nextArgumentErrors.includes(error)) {
      nextArgumentErrors.push(error);
    }
    blockedReason ??= "Target account is ambiguous. Clarify which X account to use.";
    allowed = false;
  } else if (accountResolution.status === "not-found" && accountInput) {
    const error = `No X account matched "${accountInput}"`;
    if (!nextArgumentErrors.includes(error)) {
      nextArgumentErrors.push(error);
    }
    blockedReason ??= "Target account could not be resolved. Check the account name or ID.";
    allowed = false;
  }

  if (intent.actionName === "post.schedule") {
    const scheduledAtRaw =
      typeof intent.args.scheduledAt === "string" ? intent.args.scheduledAt : null;
    payload.scheduledAtInput = scheduledAtRaw ?? "(required)";
    if (scheduledAtRaw) {
      const normalized = normalizeAgentScheduledAt(scheduledAtRaw);
      if (normalized.ok) {
        payload.scheduledAt = scheduledAtRaw;
        payload.scheduledAtIso = normalized.normalized;
      } else if (normalized.reason) {
        if (!nextArgumentErrors.includes(normalized.reason)) {
          nextArgumentErrors.push(normalized.reason);
        }
        blockedReason ??= "Scheduled time is ambiguous. Use a timezone-aware ISO 8601 datetime.";
        allowed = false;
      }
    }
  }

  return {
    actionName: preview.actionName,
    packageName: preview.packageName,
    description: preview.description,
    preview: payload,
    requiredPermissions: preview.requiredPermissions,
    missingPermissions: preview.missingPermissions,
    argumentErrors: nextArgumentErrors,
    mode: preview.mode,
    blockedReason,
    allowed: blockedReason === null && allowed,
  };
}

/**
 * action 名から core use case を呼び出す invoker を生成する。
 *
 * 対応 action:
 *  - post.list      → listPosts(postDeps, workspaceId, { platform: "x", ... })
 *  - post.create    → createPost(postDeps, { ... })
 *  - post.schedule  → createPost(draft) → schedulePost(scheduleDeps, ...)
 *  - schedule.list  → listSchedules(scheduleDeps, workspaceId, ...)
 *  - inbox.list     → listThreads(inboxDeps, workspaceId, { platform: "x", ... })
 *  - 未知の action  → { status: "unsupported_action", actionName }
 *
 * 戻り値は監査ログ / API レスポンスに載る Record<string, unknown>。
 */
function buildSkillActionInvoker(db: DbClient): SkillActionInvoker {
  const { postDeps, scheduleDeps, inboxDeps } = buildSkillUsecaseDeps(db);

  return async ({ workspaceId, actor, actionName, args }) => {
    switch (actionName) {
      case "post.list": {
        const filters = { ...mapListPostsFilters(args), platform: "x" as Platform };
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

      case "post.create": {
        const text = typeof args.text === "string" ? args.text : null;
        if (!text) {
          throw new ValidationError("text is required for post.create");
        }
        const publishNow = args.publishNow === true;
        const socialAccountId = await resolveSocialAccountId(postDeps, workspaceId, args, {
          defaultPlatform: "x",
        });

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

      case "post.schedule": {
        const text = typeof args.text === "string" ? args.text : null;
        if (!text) {
          throw new ValidationError("text is required for post.schedule");
        }
        const scheduledAtRaw = typeof args.scheduledAt === "string" ? args.scheduledAt : null;
        if (!scheduledAtRaw) {
          throw new ValidationError("scheduledAt is required (ISO 8601 string)");
        }
        const normalized = normalizeAgentScheduledAt(scheduledAtRaw);
        if (!normalized.ok || !normalized.normalized) {
          throw new ValidationError(normalized.reason ?? `Invalid scheduledAt: ${scheduledAtRaw}`);
        }
        const scheduledAt = new Date(normalized.normalized);

        const socialAccountId = await resolveSocialAccountId(postDeps, workspaceId, args, {
          defaultPlatform: "x",
        });

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

      case "schedule.list": {
        const jobs = await listSchedules(scheduleDeps, workspaceId, mapScheduleListFilters(args));
        const withPosts = await Promise.all(
          jobs.map(async (job) => ({
            job,
            post: await postDeps.postRepo.findById(job.postId),
          })),
        );
        const schedules = withPosts
          .filter((item) => item.post?.workspaceId === workspaceId && item.post.platform === "x")
          .map((item) => ({
            ...summarizeScheduledJob(item.job),
            post: item.post ? summarizePost(item.post) : null,
          }));

        return {
          status: "ok",
          actionName,
          total: schedules.length,
          schedules,
        };
      }

      case "inbox.list": {
        const result = await listThreads(inboxDeps, workspaceId, mapInboxListFilters(args));
        return {
          status: "ok",
          actionName,
          total: result.meta.total,
          limit: result.meta.limit,
          offset: result.meta.offset,
          threads: result.data.map(summarizeThread),
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

export function summarizeHistoryField(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    const serialized = value
      .map((item) => summarizeHistoryField(item))
      .filter((item): item is string => Boolean(item))
      .join(", ");
    return serialized.length > 0 ? serialized : null;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.message === "string" && record.message.trim().length > 0) {
      return record.message;
    }
    if (
      typeof record.actionName === "string" &&
      typeof record.packageName === "string" &&
      typeof record.mode === "string"
    ) {
      return `${record.actionName} (${record.packageName}, ${record.mode})`;
    }
    if (typeof record.decisionType === "string") {
      return `decision=${record.decisionType}`;
    }
    try {
      const serialized = JSON.stringify(record);
      return serialized.length > 180 ? `${serialized.slice(0, 177)}...` : serialized;
    } catch {
      return "[unserializable]";
    }
  }
  return String(value);
}

export interface AgentHistoryTranscript {
  userMessage: string | null;
  assistantMessage: string | null;
  executionNote: string | null;
  intent: AgentSkillIntent | null;
}

export interface AgentHistoryEntry {
  id: string;
  action: string;
  conversationId: string | null;
  inputSummary: string | null;
  resultSummary: string | null;
  createdAt: string;
  transcript: AgentHistoryTranscript;
}

function asHistoryRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function parseHistoryIntent(value: unknown): AgentSkillIntent | null {
  const record = asHistoryRecord(value);
  if (!record) return null;

  const actionName = typeof record.actionName === "string" ? record.actionName : null;
  const packageName = typeof record.packageName === "string" ? record.packageName : null;
  const args =
    record.args !== null && typeof record.args === "object" && !Array.isArray(record.args)
      ? (record.args as Record<string, unknown>)
      : {};

  if (!actionName || !packageName) {
    return null;
  }

  return {
    actionName,
    packageName,
    args,
  };
}

function buildExecutionHistoryNote(
  action: string,
  inputSummary: Record<string, unknown> | null,
  resultSummary: Record<string, unknown> | null,
): string | null {
  const actionName =
    typeof inputSummary?.actionName === "string" ? inputSummary.actionName : "skill action";

  if (action === "agent.execute.failed") {
    const error =
      typeof resultSummary?.error === "string"
        ? resultSummary.error
        : typeof resultSummary?.message === "string"
          ? resultSummary.message
          : null;
    return error
      ? `${actionName} の実行に失敗しました: ${error}`
      : `${actionName} の実行に失敗しました`;
  }

  const resultPayload = asHistoryRecord(resultSummary?.result);
  if (typeof resultPayload?.message === "string" && resultPayload.message.trim().length > 0) {
    return resultPayload.message;
  }

  return `${actionName} を実行しました`;
}

export function buildAgentHistoryEntry(log: AuditLog): AgentHistoryEntry {
  const inputRecord = asHistoryRecord(log.inputSummary);
  const resultRecord = asHistoryRecord(log.resultSummary);

  let userMessage: string | null = null;
  let assistantMessage: string | null = null;
  let executionNote: string | null = null;
  let intent: AgentSkillIntent | null = null;

  if (log.action === "agent.chat") {
    userMessage = typeof inputRecord?.message === "string" ? inputRecord.message : null;
    assistantMessage = typeof resultRecord?.content === "string" ? resultRecord.content : null;
    intent = parseHistoryIntent(resultRecord?.intent);
  }

  if (log.action === "agent.execute" || log.action === "agent.execute.failed") {
    executionNote = buildExecutionHistoryNote(log.action, inputRecord, resultRecord);
  }

  return {
    id: log.id,
    action: log.action,
    conversationId: log.resourceId,
    inputSummary: summarizeHistoryField(log.inputSummary),
    resultSummary: summarizeHistoryField(log.resultSummary),
    createdAt: log.createdAt.toISOString(),
    transcript: {
      userMessage,
      assistantMessage,
      executionNote,
      intent,
    },
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
  const conversationId = ensureConversationId(body.conversationId);
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

  const preview = await enrichPreviewForChat({
    db,
    workspaceId: actor.workspaceId,
    intent: result.intent,
    preview: result.preview,
  });

  return c.json({
    data: {
      kind: "preview",
      conversationId: result.conversationId,
      content: result.content,
      intent: result.intent,
      preview,
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
  const conversationId = ensureConversationId(body.conversationId);
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
      conversationId,
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
    data: entries.map(buildAgentHistoryEntry),
    meta: {
      page,
      limit,
      total: entries.length,
    },
  });
});

export { agent };
