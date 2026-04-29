import type { Platform } from "@sns-agent/config";
import type {
  EngagementGateStealthConfig,
  SocialAccount,
  StepEnrollment,
  StepEnrollmentStatus,
  StepMessage,
  StepMessageActionType,
  StepSequence,
} from "../domain/entities.js";
import { decrypt } from "../domain/crypto.js";
import { NotFoundError, ProviderError, ValidationError } from "../errors/domain-error.js";
import type {
  AccountRepository,
  StepEnrollmentRepository,
  StepMessageRepository,
  StepSequenceRepository,
} from "../interfaces/repositories.js";
import type { SendReplyInput, SocialProvider } from "../interfaces/social-provider.js";
import {
  isRateLimited,
  jitterReadyAt,
  nextBackoffUntil,
  normalizeStealthConfig,
  renderTemplateVariation,
  serializeStealthConfig,
  type DeliveryCounts,
} from "./stealth.js";

export interface StepSequenceUsecaseDeps {
  accountRepo: AccountRepository;
  sequenceRepo: StepSequenceRepository;
  messageRepo: StepMessageRepository;
  enrollmentRepo: StepEnrollmentRepository;
  providers: Map<Platform, SocialProvider>;
  encryptionKey: string;
}

export interface StepMessageInput {
  delaySeconds: number;
  actionType: StepMessageActionType;
  contentText: string;
}

export interface CreateStepSequenceInput {
  workspaceId: string;
  socialAccountId: string;
  name: string;
  status?: StepSequence["status"];
  stealthConfig?: EngagementGateStealthConfig | null;
  messages: StepMessageInput[];
  createdBy?: string | null;
}

export interface UpdateStepSequenceInput {
  workspaceId: string;
  sequenceId: string;
  name?: string;
  status?: StepSequence["status"];
  stealthConfig?: EngagementGateStealthConfig | null;
  messages?: StepMessageInput[];
}

export interface StepSequenceRecord {
  sequence: StepSequence;
  messages: StepMessage[];
  enrollments: StepEnrollment[];
}

export interface EnrollStepSequenceUserInput {
  workspaceId: string;
  sequenceId: string;
  externalUserId: string;
  username?: string | null;
  externalThreadId?: string | null;
  replyToMessageId?: string | null;
  metadata?: Record<string, unknown> | null;
  now?: Date;
}

export interface UpdateStepEnrollmentInput {
  workspaceId: string;
  sequenceId: string;
  enrollmentId: string;
  status: Exclude<StepEnrollmentStatus, "active">;
  now?: Date;
}

export interface ProcessDueStepSequenceEnrollmentsInput {
  workspaceId?: string;
  now?: Date;
  limit?: number;
  templateSeed?: string;
}

export interface ProcessDueStepSequenceEnrollmentsResult {
  enrollmentsScanned: number;
  stepsDelivered: number;
  enrollmentsCompleted: number;
  skippedInactiveSequence: number;
  skippedCancelledOrCompleted: number;
  skippedRateLimited: number;
  skippedJitter: number;
  skippedBackoff: number;
  actionsBackedOff: number;
}

async function loadXAccount(
  deps: StepSequenceUsecaseDeps,
  workspaceId: string,
  socialAccountId: string,
): Promise<SocialAccount> {
  const account = await deps.accountRepo.findById(socialAccountId);
  if (!account || account.workspaceId !== workspaceId) {
    throw new NotFoundError("SocialAccount", socialAccountId);
  }
  if (account.platform !== "x") {
    throw new ValidationError("Step sequences are only supported for X accounts");
  }
  return account;
}

async function loadSequence(
  deps: StepSequenceUsecaseDeps,
  workspaceId: string,
  sequenceId: string,
): Promise<StepSequence> {
  const sequence = await deps.sequenceRepo.findById(sequenceId);
  if (!sequence || sequence.workspaceId !== workspaceId) {
    throw new NotFoundError("StepSequence", sequenceId);
  }
  return sequence;
}

function normalizeName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new ValidationError("name is required");
  return trimmed;
}

function normalizeStatus(status: StepSequence["status"] | undefined): StepSequence["status"] {
  if (status === undefined) return "active";
  if (status === "active" || status === "paused") return status;
  throw new ValidationError("status must be active or paused");
}

function normalizeMessages(workspaceId: string, sequenceId: string, messages: StepMessageInput[]) {
  if (messages.length === 0) {
    throw new ValidationError("messages are required");
  }
  return messages.map((message, index) => {
    const delaySeconds = Number(message.delaySeconds);
    if (!Number.isInteger(delaySeconds) || delaySeconds < 0) {
      throw new ValidationError("delaySeconds must be a non-negative integer");
    }
    if (message.actionType !== "dm" && message.actionType !== "mention_post") {
      throw new ValidationError("actionType must be dm or mention_post");
    }
    const contentText = message.contentText.trim();
    if (!contentText) throw new ValidationError("contentText is required");
    return {
      workspaceId,
      sequenceId,
      stepIndex: index,
      delaySeconds,
      actionType: message.actionType,
      contentText,
    };
  });
}

function decryptCredentials(credentialsEncrypted: string, encryptionKey: string): string {
  try {
    return decrypt(credentialsEncrypted, encryptionKey);
  } catch {
    throw new ProviderError("Failed to decrypt account credentials");
  }
}

function getProvider(deps: StepSequenceUsecaseDeps, platform: Platform): SocialProvider {
  const provider = deps.providers.get(platform);
  if (!provider) throw new ValidationError(`Unsupported platform: ${platform}`);
  if (!provider.sendReply) {
    throw new ProviderError(`Provider for platform ${platform} does not support sendReply`);
  }
  return provider;
}

async function deliveryCounts(
  deps: StepSequenceUsecaseDeps,
  sequence: StepSequence,
  now: Date,
): Promise<DeliveryCounts> {
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  return {
    gateHour: await deps.enrollmentRepo.countDeliveredBySequenceSince(sequence.id, hourAgo),
    gateDay: await deps.enrollmentRepo.countDeliveredBySequenceSince(sequence.id, dayAgo),
    accountHour: await deps.enrollmentRepo.countDeliveredByAccountSince(
      sequence.socialAccountId,
      hourAgo,
    ),
    accountDay: await deps.enrollmentRepo.countDeliveredByAccountSince(
      sequence.socialAccountId,
      dayAgo,
    ),
  };
}

function mentionText(enrollment: StepEnrollment, contentText: string): string {
  const username = enrollment.username?.trim();
  if (!username) return contentText;
  if (contentText.startsWith(`@${username}`)) return contentText;
  return `@${username} ${contentText}`;
}

function sendInputForStep(
  enrollment: StepEnrollment,
  message: StepMessage,
  accountCredentials: string,
  contentText: string,
): SendReplyInput {
  if (message.actionType === "dm") {
    return {
      accountCredentials,
      externalThreadId: enrollment.externalThreadId ?? `dm:${enrollment.externalUserId}`,
      replyToMessageId: null,
      contentText,
    };
  }
  return {
    accountCredentials,
    externalThreadId:
      enrollment.externalThreadId ?? enrollment.replyToMessageId ?? enrollment.externalUserId,
    replyToMessageId: enrollment.replyToMessageId,
    contentText: mentionText(enrollment, contentText),
  };
}

function isRateLimitError(error: string | undefined): boolean {
  return /\b429\b|rate\s*limit/i.test(error ?? "");
}

export async function createStepSequence(
  deps: StepSequenceUsecaseDeps,
  input: CreateStepSequenceInput,
): Promise<StepSequence> {
  const account = await loadXAccount(deps, input.workspaceId, input.socialAccountId);
  const sequence = await deps.sequenceRepo.create({
    workspaceId: input.workspaceId,
    socialAccountId: input.socialAccountId,
    platform: account.platform,
    name: normalizeName(input.name),
    status: normalizeStatus(input.status),
    stealthConfig: serializeStealthConfig(input.stealthConfig),
    deliveryBackoffUntil: null,
    createdBy: input.createdBy ?? null,
  });
  await deps.messageRepo.replaceForSequence(
    sequence.id,
    normalizeMessages(input.workspaceId, sequence.id, input.messages),
  );
  return sequence;
}

export async function updateStepSequence(
  deps: StepSequenceUsecaseDeps,
  input: UpdateStepSequenceInput,
): Promise<StepSequence> {
  const existing = await loadSequence(deps, input.workspaceId, input.sequenceId);
  const patch: Parameters<StepSequenceRepository["update"]>[1] = {};
  if (input.name !== undefined) patch.name = normalizeName(input.name);
  if (input.status !== undefined) patch.status = normalizeStatus(input.status);
  if (input.stealthConfig !== undefined) {
    patch.stealthConfig = serializeStealthConfig(input.stealthConfig);
  }
  const updated = await deps.sequenceRepo.update(existing.id, patch);
  if (input.messages) {
    await deps.messageRepo.replaceForSequence(
      existing.id,
      normalizeMessages(input.workspaceId, existing.id, input.messages),
    );
  }
  return updated;
}

export async function deleteStepSequence(
  deps: StepSequenceUsecaseDeps,
  workspaceId: string,
  sequenceId: string,
): Promise<void> {
  const sequence = await loadSequence(deps, workspaceId, sequenceId);
  await deps.sequenceRepo.delete(sequence.id);
}

export async function listStepSequences(
  deps: StepSequenceUsecaseDeps,
  workspaceId: string,
  filters: { socialAccountId?: string; status?: StepSequence["status"] } = {},
): Promise<StepSequenceRecord[]> {
  if (filters.socialAccountId) {
    await loadXAccount(deps, workspaceId, filters.socialAccountId);
  }
  const sequences = await deps.sequenceRepo.findByWorkspace(workspaceId, filters);
  return Promise.all(
    sequences.map(async (sequence) => ({
      sequence,
      messages: await deps.messageRepo.findBySequence(sequence.id),
      enrollments: await deps.enrollmentRepo.findBySequence(sequence.id),
    })),
  );
}

export async function getStepSequence(
  deps: StepSequenceUsecaseDeps,
  workspaceId: string,
  sequenceId: string,
): Promise<StepSequenceRecord> {
  const sequence = await loadSequence(deps, workspaceId, sequenceId);
  return {
    sequence,
    messages: await deps.messageRepo.findBySequence(sequence.id),
    enrollments: await deps.enrollmentRepo.findBySequence(sequence.id),
  };
}

export async function enrollStepSequenceUser(
  deps: StepSequenceUsecaseDeps,
  input: EnrollStepSequenceUserInput,
): Promise<StepEnrollment> {
  const sequence = await loadSequence(deps, input.workspaceId, input.sequenceId);
  if (sequence.status !== "active") {
    throw new ValidationError("Cannot enroll users into a paused sequence");
  }
  const messages = await deps.messageRepo.findBySequence(sequence.id);
  if (messages.length === 0) {
    throw new ValidationError("sequence has no messages");
  }
  const externalUserId = input.externalUserId.trim();
  if (!externalUserId) throw new ValidationError("externalUserId is required");
  const now = input.now ?? new Date();
  return deps.enrollmentRepo.create({
    workspaceId: sequence.workspaceId,
    sequenceId: sequence.id,
    socialAccountId: sequence.socialAccountId,
    externalUserId,
    username: input.username?.trim() || null,
    externalThreadId: input.externalThreadId?.trim() || null,
    replyToMessageId: input.replyToMessageId?.trim() || null,
    status: "active",
    currentStepIndex: 0,
    nextStepAt: new Date(now.getTime() + messages[0].delaySeconds * 1000),
    lastDeliveredAt: null,
    completedAt: null,
    cancelledAt: null,
    metadata: input.metadata ?? null,
  });
}

export async function updateStepEnrollment(
  deps: StepSequenceUsecaseDeps,
  input: UpdateStepEnrollmentInput,
): Promise<StepEnrollment> {
  await loadSequence(deps, input.workspaceId, input.sequenceId);
  const enrollment = await deps.enrollmentRepo.findById(input.enrollmentId);
  if (
    !enrollment ||
    enrollment.workspaceId !== input.workspaceId ||
    enrollment.sequenceId !== input.sequenceId
  ) {
    throw new NotFoundError("StepEnrollment", input.enrollmentId);
  }
  const now = input.now ?? new Date();
  return deps.enrollmentRepo.update(enrollment.id, {
    status: input.status,
    nextStepAt: null,
    ...(input.status === "cancelled" ? { cancelledAt: now } : { completedAt: now }),
  });
}

export async function processDueStepSequenceEnrollments(
  deps: StepSequenceUsecaseDeps,
  input: ProcessDueStepSequenceEnrollmentsInput = {},
): Promise<ProcessDueStepSequenceEnrollmentsResult> {
  const now = input.now ?? new Date();
  const limit = input.limit && input.limit > 0 ? Math.min(input.limit, 100) : 50;
  const due = await deps.enrollmentRepo.findActiveDue({
    now,
    limit,
    workspaceId: input.workspaceId,
  });
  const summary: ProcessDueStepSequenceEnrollmentsResult = {
    enrollmentsScanned: due.length,
    stepsDelivered: 0,
    enrollmentsCompleted: 0,
    skippedInactiveSequence: 0,
    skippedCancelledOrCompleted: 0,
    skippedRateLimited: 0,
    skippedJitter: 0,
    skippedBackoff: 0,
    actionsBackedOff: 0,
  };

  for (const enrollment of due) {
    if (enrollment.status !== "active") {
      summary.skippedCancelledOrCompleted += 1;
      continue;
    }
    const sequence = await deps.sequenceRepo.findById(enrollment.sequenceId);
    if (!sequence || sequence.status !== "active") {
      summary.skippedInactiveSequence += 1;
      continue;
    }
    if (sequence.deliveryBackoffUntil && sequence.deliveryBackoffUntil > now) {
      summary.skippedBackoff += 1;
      continue;
    }

    const stealthConfig = normalizeStealthConfig(sequence.stealthConfig);
    const readyAt = jitterReadyAt({
      replyCreatedAt: enrollment.nextStepAt,
      config: stealthConfig,
      seed: `${sequence.id}:${input.templateSeed ?? "default"}:${enrollment.externalUserId}:${enrollment.currentStepIndex}`,
    });
    if (readyAt && readyAt > now) {
      summary.skippedJitter += 1;
      continue;
    }

    if (isRateLimited(stealthConfig, await deliveryCounts(deps, sequence, now))) {
      summary.skippedRateLimited += 1;
      continue;
    }

    const messages = await deps.messageRepo.findBySequence(sequence.id);
    const message = messages.find((row) => row.stepIndex === enrollment.currentStepIndex);
    if (!message) {
      await deps.enrollmentRepo.update(enrollment.id, {
        status: "completed",
        nextStepAt: null,
        completedAt: now,
      });
      summary.enrollmentsCompleted += 1;
      continue;
    }

    const account = await loadXAccount(deps, sequence.workspaceId, sequence.socialAccountId);
    if (account.status !== "active") {
      summary.skippedInactiveSequence += 1;
      continue;
    }
    const provider = getProvider(deps, account.platform);
    const accountCredentials = decryptCredentials(account.credentialsEncrypted, deps.encryptionKey);
    const contentText =
      renderTemplateVariation({
        fallbackText: message.contentText,
        config: stealthConfig,
        seed: `${sequence.id}:${input.templateSeed ?? "default"}:${enrollment.externalUserId}:${message.stepIndex}`,
      }) ?? message.contentText;
    const result = await provider.sendReply!(
      sendInputForStep(enrollment, message, accountCredentials, contentText),
    );
    if (!result.success) {
      if (isRateLimitError(result.error)) {
        const deliveryBackoffUntil = nextBackoffUntil(now, stealthConfig);
        await deps.sequenceRepo.update(sequence.id, { deliveryBackoffUntil });
        summary.actionsBackedOff += 1;
        continue;
      }
      throw new ProviderError(`step sequence action failed: ${result.error ?? "unknown error"}`);
    }

    const nextIndex = enrollment.currentStepIndex + 1;
    const nextMessage = messages.find((row) => row.stepIndex === nextIndex);
    await deps.enrollmentRepo.update(enrollment.id, {
      currentStepIndex: nextIndex,
      lastDeliveredAt: now,
      ...(nextMessage
        ? {
            nextStepAt: new Date(now.getTime() + nextMessage.delaySeconds * 1000),
          }
        : {
            status: "completed",
            nextStepAt: null,
            completedAt: now,
          }),
    });
    summary.stepsDelivered += 1;
    if (!nextMessage) summary.enrollmentsCompleted += 1;
  }

  return summary;
}
