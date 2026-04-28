import { Hono } from "hono";
import {
  consumeEngagementGateDeliveryToken,
  createEngagementGate,
  deleteEngagementGate,
  getEngagementGate,
  listEngagementGates,
  processEngagementGateReplies,
  updateEngagementGate,
  verifyEngagementGate,
  type EngagementGate,
  type EngagementGateActionType,
  type EngagementGateConditions,
  type EngagementGateStealthConfig,
  type EngagementGateUsecaseDeps,
  type EngagementGateStatus,
} from "@sns-agent/core";
import {
  DrizzleAccountRepository,
  DrizzleEngagementGateDeliveryRepository,
  DrizzleEngagementGateRepository,
} from "@sns-agent/db";
import { requirePermission } from "../middleware/rbac.js";
import { getProviderRegistry } from "../providers.js";
import type { AppVariables } from "../types.js";

const engagementGates = new Hono<{ Variables: AppVariables }>();

function buildDeps(db: AppVariables["db"]): EngagementGateUsecaseDeps {
  const encryptionKey =
    process.env.ENCRYPTION_KEY ||
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  return {
    accountRepo: new DrizzleAccountRepository(db),
    gateRepo: new DrizzleEngagementGateRepository(db),
    deliveryRepo: new DrizzleEngagementGateDeliveryRepository(db),
    providers: getProviderRegistry().getAll(),
    encryptionKey,
  };
}

function parseIntOrUndefined(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isNaN(n) ? undefined : n;
}

function parseStatus(value: unknown): EngagementGateStatus | undefined {
  if (value === "active" || value === "paused") return value;
  return undefined;
}

function parseActionType(value: unknown): EngagementGateActionType | null {
  if (value === "mention_post" || value === "dm" || value === "verify_only") return value;
  return null;
}

function parseConditions(value: unknown): EngagementGateConditions | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  return {
    requireLike: raw.requireLike === true,
    requireRepost: raw.requireRepost === true,
    requireFollow: raw.requireFollow === true,
  };
}

function parseNullableString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return typeof value === "string" ? value : undefined;
}

function parseNullablePositiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function parseNullableNonNegativeInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function parseTemplateVariants(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const variants = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  return variants.length ? variants : null;
}

function parseStealthConfig(value: unknown): EngagementGateStealthConfig | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const jitterMinSeconds = parseNullableNonNegativeInt(raw.jitterMinSeconds) ?? 0;
  const jitterMaxSeconds = Math.max(
    jitterMinSeconds,
    parseNullableNonNegativeInt(raw.jitterMaxSeconds) ?? jitterMinSeconds,
  );

  return {
    gateHourlyLimit: parseNullablePositiveInt(raw.gateHourlyLimit),
    gateDailyLimit: parseNullablePositiveInt(raw.gateDailyLimit),
    accountHourlyLimit: parseNullablePositiveInt(raw.accountHourlyLimit),
    accountDailyLimit: parseNullablePositiveInt(raw.accountDailyLimit),
    jitterMinSeconds,
    jitterMaxSeconds,
    backoffSeconds: parseNullablePositiveInt(raw.backoffSeconds),
    templateVariants: parseTemplateVariants(raw.templateVariants),
  };
}

function serializeGate(gate: EngagementGate): Record<string, unknown> {
  return {
    id: gate.id,
    workspaceId: gate.workspaceId,
    socialAccountId: gate.socialAccountId,
    platform: gate.platform,
    name: gate.name,
    status: gate.status,
    triggerType: gate.triggerType,
    triggerPostId: gate.triggerPostId,
    conditions: gate.conditions,
    actionType: gate.actionType,
    actionText: gate.actionText,
    lineHarnessUrl: gate.lineHarnessUrl,
    lineHarnessApiKeyRef: gate.lineHarnessApiKeyRef,
    lineHarnessTag: gate.lineHarnessTag,
    lineHarnessScenario: gate.lineHarnessScenario,
    stealthConfig: gate.stealthConfig,
    deliveryBackoffUntil: gate.deliveryBackoffUntil,
    lastReplySinceId: gate.lastReplySinceId,
    createdBy: gate.createdBy,
    createdAt: gate.createdAt,
    updatedAt: gate.updatedAt,
  };
}

engagementGates.get("/", requirePermission("inbox:read"), async (c) => {
  const actor = c.get("actor");
  const deps = buildDeps(c.get("db"));
  const status = parseStatus(c.req.query("status"));

  const rows = await listEngagementGates(deps, actor.workspaceId, {
    socialAccountId: c.req.query("socialAccountId"),
    status,
    limit: parseIntOrUndefined(c.req.query("limit")),
  });

  return c.json({ data: rows.map(serializeGate) });
});

engagementGates.post("/", requirePermission("inbox:reply"), async (c) => {
  const actor = c.get("actor");
  const deps = buildDeps(c.get("db"));
  const body = await c.req.json<Record<string, unknown>>();
  const actionType = parseActionType(body.actionType);
  const conditions = parseConditions(body.conditions);
  const stealthConfig = parseStealthConfig(body.stealthConfig);

  if (!body.socialAccountId || typeof body.socialAccountId !== "string") {
    return c.json(
      { error: { code: "VALIDATION_ERROR", message: "socialAccountId is required" } },
      400,
    );
  }
  if (!body.name || typeof body.name !== "string") {
    return c.json({ error: { code: "VALIDATION_ERROR", message: "name is required" } }, 400);
  }
  if (!actionType) {
    return c.json({ error: { code: "VALIDATION_ERROR", message: "actionType is invalid" } }, 400);
  }
  if (conditions === null && body.conditions !== null && body.conditions !== undefined) {
    return c.json(
      { error: { code: "VALIDATION_ERROR", message: "conditions must be an object" } },
      400,
    );
  }
  if (stealthConfig === null && body.stealthConfig !== null && body.stealthConfig !== undefined) {
    return c.json(
      { error: { code: "VALIDATION_ERROR", message: "stealthConfig must be an object" } },
      400,
    );
  }

  const created = await createEngagementGate(deps, {
    workspaceId: actor.workspaceId,
    socialAccountId: body.socialAccountId,
    name: body.name,
    triggerPostId: typeof body.triggerPostId === "string" ? body.triggerPostId : null,
    conditions: conditions ?? null,
    actionType,
    actionText: typeof body.actionText === "string" ? body.actionText : null,
    lineHarnessUrl: parseNullableString(body.lineHarnessUrl) ?? null,
    lineHarnessApiKeyRef: parseNullableString(body.lineHarnessApiKeyRef) ?? null,
    lineHarnessTag: parseNullableString(body.lineHarnessTag) ?? null,
    lineHarnessScenario: parseNullableString(body.lineHarnessScenario) ?? null,
    stealthConfig: stealthConfig ?? null,
    createdBy: actor.id,
  });

  return c.json({ data: serializeGate(created) }, 201);
});

engagementGates.post("/process", requirePermission("inbox:reply"), async (c) => {
  const deps = buildDeps(c.get("db"));
  const body = await c.req.json<{ limit?: number }>().catch((): { limit?: number } => ({}));
  const result = await processEngagementGateReplies(deps, { limit: body.limit });
  return c.json({ data: result });
});

engagementGates.get("/:id/verify", requirePermission("inbox:read"), async (c) => {
  const actor = c.get("actor");
  const deps = buildDeps(c.get("db"));
  const username = c.req.query("username");
  if (!username) {
    return c.json({ error: { code: "VALIDATION_ERROR", message: "username is required" } }, 400);
  }

  const result = await verifyEngagementGate(deps, {
    workspaceId: actor.workspaceId,
    gateId: c.req.param("id"),
    username,
  });
  return c.json({ data: result });
});

engagementGates.post("/:id/deliveries/consume", requirePermission("inbox:reply"), async (c) => {
  const actor = c.get("actor");
  const deps = buildDeps(c.get("db"));
  const body = await c.req.json<Record<string, unknown>>();
  if (typeof body.deliveryToken !== "string" || !body.deliveryToken.trim()) {
    return c.json(
      { error: { code: "VALIDATION_ERROR", message: "deliveryToken is required" } },
      400,
    );
  }

  const result = await consumeEngagementGateDeliveryToken(deps, {
    workspaceId: actor.workspaceId,
    gateId: c.req.param("id"),
    deliveryToken: body.deliveryToken,
  });
  return c.json({ data: result });
});

engagementGates.get("/:id", requirePermission("inbox:read"), async (c) => {
  const actor = c.get("actor");
  const deps = buildDeps(c.get("db"));
  const gate = await getEngagementGate(deps, actor.workspaceId, c.req.param("id"));
  return c.json({ data: serializeGate(gate) });
});

engagementGates.patch("/:id", requirePermission("inbox:reply"), async (c) => {
  const actor = c.get("actor");
  const deps = buildDeps(c.get("db"));
  const body = await c.req.json<Record<string, unknown>>();
  const conditions = parseConditions(body.conditions);
  const actionType = body.actionType === undefined ? undefined : parseActionType(body.actionType);
  const status = body.status === undefined ? undefined : parseStatus(body.status);
  const stealthConfig = parseStealthConfig(body.stealthConfig);

  if (body.actionType !== undefined && !actionType) {
    return c.json({ error: { code: "VALIDATION_ERROR", message: "actionType is invalid" } }, 400);
  }
  if (body.status !== undefined && !status) {
    return c.json({ error: { code: "VALIDATION_ERROR", message: "status is invalid" } }, 400);
  }
  if (conditions === null && body.conditions !== null && body.conditions !== undefined) {
    return c.json(
      { error: { code: "VALIDATION_ERROR", message: "conditions must be an object" } },
      400,
    );
  }
  if (stealthConfig === null && body.stealthConfig !== null && body.stealthConfig !== undefined) {
    return c.json(
      { error: { code: "VALIDATION_ERROR", message: "stealthConfig must be an object" } },
      400,
    );
  }

  const updated = await updateEngagementGate(deps, {
    workspaceId: actor.workspaceId,
    id: c.req.param("id"),
    name: typeof body.name === "string" ? body.name : undefined,
    status,
    triggerPostId: typeof body.triggerPostId === "string" ? body.triggerPostId : undefined,
    conditions,
    actionType: actionType ?? undefined,
    actionText:
      typeof body.actionText === "string"
        ? body.actionText
        : body.actionText === null
          ? null
          : undefined,
    lineHarnessUrl: parseNullableString(body.lineHarnessUrl),
    lineHarnessApiKeyRef: parseNullableString(body.lineHarnessApiKeyRef),
    lineHarnessTag: parseNullableString(body.lineHarnessTag),
    lineHarnessScenario: parseNullableString(body.lineHarnessScenario),
    stealthConfig,
  });

  return c.json({ data: serializeGate(updated) });
});

engagementGates.delete("/:id", requirePermission("inbox:reply"), async (c) => {
  const actor = c.get("actor");
  const deps = buildDeps(c.get("db"));
  await deleteEngagementGate(deps, actor.workspaceId, c.req.param("id"));
  return c.json({ data: { success: true } });
});

export { engagementGates };
