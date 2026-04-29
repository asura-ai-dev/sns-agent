import { Hono } from "hono";
import {
  createStepSequence,
  deleteStepSequence,
  enrollStepSequenceUser,
  getStepSequence,
  listStepSequences,
  processDueStepSequenceEnrollments,
  updateStepEnrollment,
  updateStepSequence,
  ValidationError,
  type EngagementGateStealthConfig,
  type StepEnrollment,
  type StepMessage,
  type StepMessageActionType,
  type StepSequence,
  type StepSequenceRecord,
  type StepSequenceUsecaseDeps,
} from "@sns-agent/core";
import {
  DrizzleAccountRepository,
  DrizzleStepEnrollmentRepository,
  DrizzleStepMessageRepository,
  DrizzleStepSequenceRepository,
} from "@sns-agent/db";
import { requirePermission } from "../middleware/rbac.js";
import { getProviderRegistry } from "../providers.js";
import type { AppVariables } from "../types.js";

const stepSequences = new Hono<{ Variables: AppVariables }>();

function buildDeps(db: AppVariables["db"]): StepSequenceUsecaseDeps {
  const encryptionKey =
    process.env.ENCRYPTION_KEY ||
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  return {
    accountRepo: new DrizzleAccountRepository(db),
    sequenceRepo: new DrizzleStepSequenceRepository(db),
    messageRepo: new DrizzleStepMessageRepository(db),
    enrollmentRepo: new DrizzleStepEnrollmentRepository(db),
    providers: getProviderRegistry().getAll(),
    encryptionKey,
  };
}

function parseActionType(value: unknown): StepMessageActionType {
  if (value === "dm" || value === "mention_post") return value;
  throw new ValidationError("actionType must be dm or mention_post");
}

function parseDate(value: unknown, field: string): Date | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new ValidationError(`${field} must be an ISO string`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new ValidationError(`${field} must be valid`);
  return parsed;
}

function parseMessages(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ValidationError("messages are required");
  }
  return value.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new ValidationError("messages must contain objects");
    }
    const item = raw as Record<string, unknown>;
    if (typeof item.contentText !== "string") {
      throw new ValidationError("contentText is required");
    }
    return {
      delaySeconds: Number(item.delaySeconds),
      actionType: parseActionType(item.actionType),
      contentText: item.contentText,
    };
  });
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

function serializeSequence(sequence: StepSequence): Record<string, unknown> {
  return {
    id: sequence.id,
    workspaceId: sequence.workspaceId,
    socialAccountId: sequence.socialAccountId,
    platform: sequence.platform,
    name: sequence.name,
    status: sequence.status,
    stealthConfig: sequence.stealthConfig,
    deliveryBackoffUntil: sequence.deliveryBackoffUntil,
    createdBy: sequence.createdBy,
    createdAt: sequence.createdAt,
    updatedAt: sequence.updatedAt,
  };
}

function serializeMessage(message: StepMessage): Record<string, unknown> {
  return {
    id: message.id,
    workspaceId: message.workspaceId,
    sequenceId: message.sequenceId,
    stepIndex: message.stepIndex,
    delaySeconds: message.delaySeconds,
    actionType: message.actionType,
    contentText: message.contentText,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
  };
}

function serializeEnrollment(enrollment: StepEnrollment): Record<string, unknown> {
  return {
    id: enrollment.id,
    workspaceId: enrollment.workspaceId,
    sequenceId: enrollment.sequenceId,
    socialAccountId: enrollment.socialAccountId,
    externalUserId: enrollment.externalUserId,
    username: enrollment.username,
    externalThreadId: enrollment.externalThreadId,
    replyToMessageId: enrollment.replyToMessageId,
    status: enrollment.status,
    currentStepIndex: enrollment.currentStepIndex,
    nextStepAt: enrollment.nextStepAt,
    lastDeliveredAt: enrollment.lastDeliveredAt,
    completedAt: enrollment.completedAt,
    cancelledAt: enrollment.cancelledAt,
    metadata: enrollment.metadata,
    createdAt: enrollment.createdAt,
    updatedAt: enrollment.updatedAt,
  };
}

function serializeRecord(record: StepSequenceRecord): Record<string, unknown> {
  return {
    ...serializeSequence(record.sequence),
    messages: record.messages.map(serializeMessage),
    enrollments: record.enrollments.map(serializeEnrollment),
  };
}

stepSequences.get("/", requirePermission("inbox:read"), async (c) => {
  const actor = c.get("actor");
  const rows = await listStepSequences(buildDeps(c.get("db")), actor.workspaceId, {
    socialAccountId: c.req.query("socialAccountId"),
    status: c.req.query("status") as StepSequence["status"] | undefined,
  });
  return c.json({ data: rows.map(serializeRecord) });
});

stepSequences.post("/", requirePermission("inbox:reply"), async (c) => {
  const actor = c.get("actor");
  const body = await c.req.json<Record<string, unknown>>();
  const socialAccountId = optionalString(body.socialAccountId);
  const name = optionalString(body.name);
  if (!socialAccountId) throw new ValidationError("socialAccountId is required");
  if (!name) throw new ValidationError("name is required");
  const sequence = await createStepSequence(buildDeps(c.get("db")), {
    workspaceId: actor.workspaceId,
    socialAccountId,
    name,
    status: body.status === "paused" ? "paused" : "active",
    stealthConfig: parseStealthConfig(body.stealthConfig),
    messages: parseMessages(body.messages),
    createdBy: actor.id,
  });
  const record = await getStepSequence(buildDeps(c.get("db")), actor.workspaceId, sequence.id);
  return c.json({ data: serializeRecord(record) }, 201);
});

stepSequences.post("/process", requirePermission("inbox:reply"), async (c) => {
  const body: Record<string, unknown> = await c.req
    .json<Record<string, unknown>>()
    .catch(() => ({}));
  const result = await processDueStepSequenceEnrollments(buildDeps(c.get("db")), {
    limit: typeof body.limit === "number" ? body.limit : undefined,
    now: parseDate(body.now, "now"),
    templateSeed: typeof body.templateSeed === "string" ? body.templateSeed : undefined,
  });
  return c.json({ data: result });
});

stepSequences.get("/:id", requirePermission("inbox:read"), async (c) => {
  const actor = c.get("actor");
  const record = await getStepSequence(
    buildDeps(c.get("db")),
    actor.workspaceId,
    c.req.param("id"),
  );
  return c.json({ data: serializeRecord(record) });
});

stepSequences.patch("/:id", requirePermission("inbox:reply"), async (c) => {
  const actor = c.get("actor");
  const body = await c.req.json<Record<string, unknown>>();
  const sequence = await updateStepSequence(buildDeps(c.get("db")), {
    workspaceId: actor.workspaceId,
    sequenceId: c.req.param("id"),
    name: typeof body.name === "string" ? body.name : undefined,
    status:
      body.status === "active" || body.status === "paused"
        ? (body.status as StepSequence["status"])
        : undefined,
    stealthConfig:
      body.stealthConfig === undefined ? undefined : parseStealthConfig(body.stealthConfig),
    messages: body.messages === undefined ? undefined : parseMessages(body.messages),
  });
  const record = await getStepSequence(buildDeps(c.get("db")), actor.workspaceId, sequence.id);
  return c.json({ data: serializeRecord(record) });
});

stepSequences.delete("/:id", requirePermission("inbox:reply"), async (c) => {
  const actor = c.get("actor");
  await deleteStepSequence(buildDeps(c.get("db")), actor.workspaceId, c.req.param("id"));
  return c.json({ data: { success: true } });
});

stepSequences.get("/:id/enrollments", requirePermission("inbox:read"), async (c) => {
  const actor = c.get("actor");
  const record = await getStepSequence(
    buildDeps(c.get("db")),
    actor.workspaceId,
    c.req.param("id"),
  );
  return c.json({ data: record.enrollments.map(serializeEnrollment) });
});

stepSequences.post("/:id/enrollments", requirePermission("inbox:reply"), async (c) => {
  const actor = c.get("actor");
  const body = await c.req.json<Record<string, unknown>>();
  const externalUserId = optionalString(body.externalUserId);
  if (!externalUserId) throw new ValidationError("externalUserId is required");
  const enrollment = await enrollStepSequenceUser(buildDeps(c.get("db")), {
    workspaceId: actor.workspaceId,
    sequenceId: c.req.param("id"),
    externalUserId,
    username: optionalString(body.username),
    externalThreadId: optionalString(body.externalThreadId),
    replyToMessageId: optionalString(body.replyToMessageId),
    metadata:
      body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
        ? (body.metadata as Record<string, unknown>)
        : null,
    now: parseDate(body.now, "now"),
  });
  return c.json({ data: serializeEnrollment(enrollment) }, 201);
});

stepSequences.patch(
  "/:id/enrollments/:enrollmentId",
  requirePermission("inbox:reply"),
  async (c) => {
    const actor = c.get("actor");
    const body = await c.req.json<Record<string, unknown>>();
    if (body.status !== "cancelled" && body.status !== "completed") {
      throw new ValidationError("status must be cancelled or completed");
    }
    const enrollment = await updateStepEnrollment(buildDeps(c.get("db")), {
      workspaceId: actor.workspaceId,
      sequenceId: c.req.param("id"),
      enrollmentId: c.req.param("enrollmentId"),
      status: body.status,
      now: parseDate(body.now, "now"),
    });
    return c.json({ data: serializeEnrollment(enrollment) });
  },
);

export { stepSequences };
