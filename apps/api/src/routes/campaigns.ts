import { Hono } from "hono";
import {
  checkPermission,
  createCampaign,
  listCampaigns,
  ValidationError,
  type CampaignMode,
  type CampaignRecord,
  type CampaignUsecaseDeps,
  type EngagementGateActionType,
  type EngagementGateConditions,
  type EngagementGateStealthConfig,
  type MediaAttachment,
  type PostProviderMetadata,
} from "@sns-agent/core";
import {
  DrizzleAccountRepository,
  DrizzleAuditLogRepository,
  DrizzleEngagementGateDeliveryRepository,
  DrizzleEngagementGateRepository,
  DrizzlePostRepository,
  DrizzleScheduledJobRepository,
  DrizzleUsageRepository,
} from "@sns-agent/db";
import { requirePermission } from "../middleware/rbac.js";
import { getProviderRegistry } from "../providers.js";
import type { AppVariables } from "../types.js";

const campaigns = new Hono<{ Variables: AppVariables }>();

function buildDeps(db: AppVariables["db"]): CampaignUsecaseDeps {
  const encryptionKey =
    process.env.ENCRYPTION_KEY ||
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const postRepo = new DrizzlePostRepository(db);
  const accountRepo = new DrizzleAccountRepository(db);
  const scheduledJobRepo = new DrizzleScheduledJobRepository(db);
  const providers = getProviderRegistry().getAll();

  return {
    postDeps: {
      postRepo,
      accountRepo,
      providers,
      encryptionKey,
      usageRepo: new DrizzleUsageRepository(db),
      scheduledJobRepo,
    },
    gateDeps: {
      accountRepo,
      gateRepo: new DrizzleEngagementGateRepository(db),
      deliveryRepo: new DrizzleEngagementGateDeliveryRepository(db),
      providers,
      encryptionKey,
    },
    scheduleDeps: {
      scheduledJobRepo,
      postRepo,
      auditRepo: new DrizzleAuditLogRepository(db),
      postUsecaseDeps: {
        postRepo,
        accountRepo,
        providers,
        encryptionKey,
        usageRepo: new DrizzleUsageRepository(db),
      },
    },
  };
}

function parseMode(value: unknown): CampaignMode {
  if (value === "draft" || value === "publish" || value === "schedule") return value;
  throw new ValidationError("mode must be draft, publish, or schedule");
}

function parseActionType(value: unknown): EngagementGateActionType {
  if (value === "mention_post" || value === "dm" || value === "verify_only") return value;
  throw new ValidationError("actionType is invalid");
}

function parseConditions(value: unknown): EngagementGateConditions | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError("conditions must be an object");
  }
  const raw = value as Record<string, unknown>;
  return {
    requireLike: raw.requireLike === true,
    requireRepost: raw.requireRepost === true,
    requireFollow: raw.requireFollow === true,
  };
}

function parseStealthConfig(value: unknown): EngagementGateStealthConfig | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError("stealthConfig must be an object");
  }
  return value as EngagementGateStealthConfig;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parseScheduledAt(value: unknown): Date | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new ValidationError("scheduledAt must be an ISO string");
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationError("scheduledAt must be a valid ISO string");
  }
  return parsed;
}

function modePermissionError(
  mode: CampaignMode,
  role: AppVariables["actor"]["role"],
): string | null {
  if (mode === "publish" && !checkPermission(role, "post:publish")) {
    return "post:publish permission is required for campaign publish";
  }
  if (mode === "schedule" && !checkPermission(role, "schedule:create")) {
    return "schedule:create permission is required for scheduled campaigns";
  }
  return null;
}

function serializeCampaign(record: CampaignRecord): Record<string, unknown> {
  return {
    id: record.id,
    mode: record.mode,
    post: record.post,
    gate: record.gate,
    schedule: record.schedule,
    verifyUrl: record.verifyUrl,
  };
}

campaigns.get("/", requirePermission("inbox:read"), async (c) => {
  const actor = c.get("actor");
  const deps = buildDeps(c.get("db"));
  const rows = await listCampaigns(deps, actor.workspaceId);
  return c.json({ data: rows });
});

campaigns.post("/", requirePermission("post:create"), async (c) => {
  const actor = c.get("actor");
  if (!checkPermission(actor.role, "inbox:reply")) {
    return c.json(
      { error: { code: "FORBIDDEN", message: "inbox:reply permission is required" } },
      403,
    );
  }

  const body = await c.req.json<Record<string, unknown>>();
  const mode = parseMode(body.mode ?? "draft");
  const permissionError = modePermissionError(mode, actor.role);
  if (permissionError) {
    return c.json({ error: { code: "FORBIDDEN", message: permissionError } }, 403);
  }

  const post = body.post;
  if (!post || typeof post !== "object" || Array.isArray(post)) {
    throw new ValidationError("post is required");
  }
  const postBody = post as Record<string, unknown>;
  const socialAccountId = optionalString(body.socialAccountId);
  const name = optionalString(body.name);
  if (!socialAccountId) throw new ValidationError("socialAccountId is required");
  if (!name) throw new ValidationError("name is required");

  const created = await createCampaign(buildDeps(c.get("db")), {
    workspaceId: actor.workspaceId,
    socialAccountId,
    name,
    mode,
    post: {
      contentText: optionalString(postBody.contentText),
      contentMedia: (postBody.contentMedia ?? null) as MediaAttachment[] | null,
      providerMetadata: (postBody.providerMetadata ?? null) as PostProviderMetadata | null,
    },
    scheduledAt: parseScheduledAt(body.scheduledAt),
    conditions: parseConditions(body.conditions),
    actionType: parseActionType(body.actionType ?? "verify_only"),
    actionText: optionalString(body.actionText),
    lineHarnessUrl: optionalString(body.lineHarnessUrl),
    lineHarnessApiKeyRef: optionalString(body.lineHarnessApiKeyRef),
    lineHarnessTag: optionalString(body.lineHarnessTag),
    lineHarnessScenario: optionalString(body.lineHarnessScenario),
    stealthConfig: parseStealthConfig(body.stealthConfig),
    createdBy: actor.id,
  });

  return c.json({ data: serializeCampaign(created) }, 201);
});

export { campaigns };
