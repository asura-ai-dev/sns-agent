import type { Platform } from "@sns-agent/config";
import { randomUUID } from "node:crypto";
import type {
  EngagementGate,
  EngagementGateActionType,
  EngagementGateConditions,
  SocialAccount,
} from "../domain/entities.js";
import { decrypt } from "../domain/crypto.js";
import type {
  AccountRepository,
  EngagementGateDeliveryRepository,
  EngagementGateRepository,
} from "../interfaces/repositories.js";
import type {
  EngagementConditionResult,
  EngagementReply,
  SendReplyInput,
  SocialProvider,
} from "../interfaces/social-provider.js";
import { NotFoundError, ProviderError, ValidationError } from "../errors/domain-error.js";

export interface EngagementGateUsecaseDeps {
  accountRepo: AccountRepository;
  gateRepo: EngagementGateRepository;
  deliveryRepo: EngagementGateDeliveryRepository;
  providers: Map<Platform, SocialProvider>;
  encryptionKey: string;
}

export interface CreateEngagementGateInput {
  workspaceId: string;
  socialAccountId: string;
  name: string;
  triggerPostId?: string | null;
  conditions?: EngagementGateConditions | null;
  actionType: EngagementGateActionType;
  actionText?: string | null;
  lineHarnessUrl?: string | null;
  lineHarnessApiKeyRef?: string | null;
  lineHarnessTag?: string | null;
  lineHarnessScenario?: string | null;
  createdBy?: string | null;
}

export interface UpdateEngagementGateInput {
  workspaceId: string;
  id: string;
  name?: string;
  status?: EngagementGate["status"];
  triggerPostId?: string | null;
  conditions?: EngagementGateConditions | null;
  actionType?: EngagementGateActionType;
  actionText?: string | null;
  lineHarnessUrl?: string | null;
  lineHarnessApiKeyRef?: string | null;
  lineHarnessTag?: string | null;
  lineHarnessScenario?: string | null;
}

export interface ProcessEngagementGateRepliesInput {
  limit?: number;
}

export interface ProcessEngagementGateRepliesResult {
  gatesScanned: number;
  repliesScanned: number;
  deliveriesCreated: number;
  skippedDuplicate: number;
  skippedIneligible: number;
  actionsSent: number;
  lastReplySinceIdsUpdated: number;
}

export interface VerifyEngagementGateInput {
  workspaceId: string;
  gateId: string;
  username: string;
}

export interface VerifyEngagementGateResult {
  gateId: string;
  username: string;
  eligible: boolean;
  conditions: EngagementConditionResult;
  delivery: {
    id: string;
    token: string;
    consumedAt: Date | null;
  } | null;
  lineHarness: {
    url: string | null;
    apiKeyRef: string | null;
    tag: string | null;
    scenario: string | null;
  };
}

export interface ConsumeEngagementGateDeliveryTokenInput {
  workspaceId: string;
  gateId: string;
  deliveryToken: string;
}

export interface ConsumeEngagementGateDeliveryTokenResult {
  consumed: boolean;
  delivery: {
    id: string;
    deliveryToken: string;
    consumedAt: Date | null;
  };
}

async function loadAccount(
  deps: EngagementGateUsecaseDeps,
  workspaceId: string,
  socialAccountId: string,
): Promise<SocialAccount> {
  const account = await deps.accountRepo.findById(socialAccountId);
  if (!account || account.workspaceId !== workspaceId) {
    throw new NotFoundError("SocialAccount", socialAccountId);
  }
  return account;
}

function decryptCredentials(credentialsEncrypted: string, encryptionKey: string): string {
  try {
    return decrypt(credentialsEncrypted, encryptionKey);
  } catch {
    throw new ProviderError("Failed to decrypt account credentials");
  }
}

function getProvider(deps: EngagementGateUsecaseDeps, platform: Platform): SocialProvider {
  const provider = deps.providers.get(platform);
  if (!provider) {
    throw new ValidationError(`Unsupported platform: ${platform}`);
  }
  return provider;
}

function normalizeConditions(
  conditions: EngagementGateConditions | null | undefined,
): EngagementGateConditions | null {
  if (!conditions) return null;
  return {
    requireLike: conditions.requireLike === true,
    requireRepost: conditions.requireRepost === true,
    requireFollow: conditions.requireFollow === true,
  };
}

function requiresConditionCheck(conditions: EngagementGateConditions | null): boolean {
  return (
    conditions?.requireLike === true ||
    conditions?.requireRepost === true ||
    conditions?.requireFollow === true
  );
}

function conditionsPass(
  conditions: EngagementGateConditions | null,
  result: EngagementConditionResult,
): boolean {
  return (
    (conditions?.requireLike !== true || result.liked) &&
    (conditions?.requireRepost !== true || result.reposted) &&
    (conditions?.requireFollow !== true || result.followed)
  );
}

function withoutRequirements(): EngagementConditionResult {
  return { liked: true, reposted: true, followed: true };
}

function normalizeUsername(username: string): string {
  return username.trim().replace(/^@+/, "").toLowerCase();
}

function optionalTrim(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

function createDeliveryToken(): string {
  return `egt_${randomUUID()}`;
}

function conditionsFromMetadata(
  metadata: Record<string, unknown> | null,
): EngagementConditionResult {
  const raw = metadata?.conditions;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return withoutRequirements();
  const conditions = raw as Record<string, unknown>;
  return {
    liked: conditions.liked === true,
    reposted: conditions.reposted === true,
    followed: conditions.followed === true,
  };
}

function lineHarnessForGate(gate: EngagementGate): VerifyEngagementGateResult["lineHarness"] {
  return {
    url: gate.lineHarnessUrl,
    apiKeyRef: gate.lineHarnessApiKeyRef,
    tag: gate.lineHarnessTag,
    scenario: gate.lineHarnessScenario,
  };
}

function renderMentionText(reply: EngagementReply, actionText: string | null): string {
  const text = actionText?.trim() ?? "";
  const username = reply.username?.trim();
  if (!username) return text;
  if (text.startsWith(`@${username}`)) return text;
  return `@${username}${text ? ` ${text}` : ""}`;
}

async function deliverAction(
  provider: SocialProvider,
  gate: EngagementGate,
  reply: EngagementReply,
  accountCredentials: string,
): Promise<{ status: "delivered" | "verified"; responseExternalId: string | null; sent: boolean }> {
  if (gate.actionType === "verify_only") {
    return { status: "verified", responseExternalId: null, sent: false };
  }
  if (!provider.sendReply) {
    throw new ProviderError(`Provider for platform ${gate.platform} does not support sendReply`);
  }

  const input: SendReplyInput =
    gate.actionType === "dm"
      ? {
          accountCredentials,
          externalThreadId: `dm:${reply.externalUserId}`,
          replyToMessageId: null,
          contentText: gate.actionText?.trim() ?? "",
        }
      : {
          accountCredentials,
          externalThreadId: reply.conversationId ?? reply.externalReplyId,
          replyToMessageId: reply.externalReplyId,
          contentText: renderMentionText(reply, gate.actionText),
        };

  const result = await provider.sendReply(input);
  if (!result.success) {
    throw new ProviderError(`engagement gate action failed: ${result.error ?? "unknown error"}`);
  }
  return {
    status: "delivered",
    responseExternalId: result.externalMessageId,
    sent: true,
  };
}

export async function createEngagementGate(
  deps: EngagementGateUsecaseDeps,
  input: CreateEngagementGateInput,
): Promise<EngagementGate> {
  const account = await loadAccount(deps, input.workspaceId, input.socialAccountId);
  const name = input.name.trim();
  if (!name) throw new ValidationError("name is required");

  return deps.gateRepo.create({
    workspaceId: input.workspaceId,
    socialAccountId: input.socialAccountId,
    platform: account.platform,
    name,
    status: "active",
    triggerType: "reply",
    triggerPostId: input.triggerPostId?.trim() || null,
    conditions: normalizeConditions(input.conditions),
    actionType: input.actionType,
    actionText: input.actionText?.trim() || null,
    lineHarnessUrl: optionalTrim(input.lineHarnessUrl),
    lineHarnessApiKeyRef: optionalTrim(input.lineHarnessApiKeyRef),
    lineHarnessTag: optionalTrim(input.lineHarnessTag),
    lineHarnessScenario: optionalTrim(input.lineHarnessScenario),
    lastReplySinceId: null,
    createdBy: input.createdBy ?? null,
  });
}

export async function listEngagementGates(
  deps: EngagementGateUsecaseDeps,
  workspaceId: string,
  filters: { socialAccountId?: string; status?: EngagementGate["status"]; limit?: number } = {},
): Promise<EngagementGate[]> {
  return deps.gateRepo.findByWorkspace(workspaceId, filters);
}

export async function getEngagementGate(
  deps: EngagementGateUsecaseDeps,
  workspaceId: string,
  id: string,
): Promise<EngagementGate> {
  const gate = await deps.gateRepo.findById(id);
  if (!gate || gate.workspaceId !== workspaceId) {
    throw new NotFoundError("EngagementGate", id);
  }
  return gate;
}

export async function updateEngagementGate(
  deps: EngagementGateUsecaseDeps,
  input: UpdateEngagementGateInput,
): Promise<EngagementGate> {
  await getEngagementGate(deps, input.workspaceId, input.id);
  const patch: Parameters<EngagementGateRepository["update"]>[1] = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new ValidationError("name is required");
    patch.name = name;
  }
  if (input.status !== undefined) patch.status = input.status;
  if (input.triggerPostId !== undefined) patch.triggerPostId = input.triggerPostId?.trim() || null;
  if (input.conditions !== undefined) patch.conditions = normalizeConditions(input.conditions);
  if (input.actionType !== undefined) patch.actionType = input.actionType;
  if (input.actionText !== undefined) patch.actionText = input.actionText?.trim() || null;
  if (input.lineHarnessUrl !== undefined) patch.lineHarnessUrl = optionalTrim(input.lineHarnessUrl);
  if (input.lineHarnessApiKeyRef !== undefined) {
    patch.lineHarnessApiKeyRef = optionalTrim(input.lineHarnessApiKeyRef);
  }
  if (input.lineHarnessTag !== undefined) patch.lineHarnessTag = optionalTrim(input.lineHarnessTag);
  if (input.lineHarnessScenario !== undefined) {
    patch.lineHarnessScenario = optionalTrim(input.lineHarnessScenario);
  }
  return deps.gateRepo.update(input.id, patch);
}

export async function deleteEngagementGate(
  deps: EngagementGateUsecaseDeps,
  workspaceId: string,
  id: string,
): Promise<void> {
  await getEngagementGate(deps, workspaceId, id);
  await deps.gateRepo.delete(id);
}

export async function processEngagementGateReplies(
  deps: EngagementGateUsecaseDeps,
  input: ProcessEngagementGateRepliesInput = {},
): Promise<ProcessEngagementGateRepliesResult> {
  const limit = input.limit && input.limit > 0 ? Math.min(input.limit, 100) : 50;
  const gates = await deps.gateRepo.findActiveReplyTriggers(limit);
  const summary: ProcessEngagementGateRepliesResult = {
    gatesScanned: gates.length,
    repliesScanned: 0,
    deliveriesCreated: 0,
    skippedDuplicate: 0,
    skippedIneligible: 0,
    actionsSent: 0,
    lastReplySinceIdsUpdated: 0,
  };

  for (const gate of gates) {
    const account = await loadAccount(deps, gate.workspaceId, gate.socialAccountId);
    if (account.status !== "active") continue;

    const provider = getProvider(deps, account.platform);
    if (!provider.listEngagementReplies) {
      throw new ProviderError(
        `Provider for platform ${account.platform} does not support engagement replies`,
      );
    }

    const accountCredentials = decryptCredentials(account.credentialsEncrypted, deps.encryptionKey);
    const listed = await provider.listEngagementReplies({
      accountCredentials,
      accountExternalId: account.externalAccountId,
      triggerPostId: gate.triggerPostId,
      sinceId: gate.lastReplySinceId,
      limit: 100,
    });

    summary.repliesScanned += listed.replies.length;
    for (const reply of listed.replies) {
      const existing = await deps.deliveryRepo.findByGateAndUser(gate.id, reply.externalUserId);
      if (existing) {
        summary.skippedDuplicate += 1;
        continue;
      }

      const conditions = gate.conditions ?? null;
      let check = withoutRequirements();
      if (requiresConditionCheck(conditions)) {
        if (!provider.checkEngagementConditions) {
          summary.skippedIneligible += 1;
          continue;
        }
        check = await provider.checkEngagementConditions({
          accountCredentials,
          triggerPostId: gate.triggerPostId,
          externalUserId: reply.externalUserId,
          conditions: conditions ?? {},
        });
      }
      if (!conditionsPass(conditions, check)) {
        summary.skippedIneligible += 1;
        continue;
      }

      const action = await deliverAction(provider, gate, reply, accountCredentials);
      const delivery = await deps.deliveryRepo.createOnce({
        workspaceId: gate.workspaceId,
        engagementGateId: gate.id,
        socialAccountId: gate.socialAccountId,
        externalUserId: reply.externalUserId,
        externalReplyId: reply.externalReplyId,
        actionType: gate.actionType,
        status: action.status,
        responseExternalId: action.responseExternalId,
        deliveryToken: createDeliveryToken(),
        consumedAt: null,
        metadata: {
          username: normalizeUsername(reply.username ?? reply.externalUserId),
          conditions: check,
        },
        deliveredAt: new Date(),
      });
      if (delivery.created) {
        summary.deliveriesCreated += 1;
        if (action.sent) summary.actionsSent += 1;
      } else {
        summary.skippedDuplicate += 1;
      }
    }

    if (listed.nextSinceId && listed.nextSinceId !== gate.lastReplySinceId) {
      await deps.gateRepo.update(gate.id, { lastReplySinceId: listed.nextSinceId });
      summary.lastReplySinceIdsUpdated += 1;
    }
  }

  return summary;
}

export async function verifyEngagementGate(
  deps: EngagementGateUsecaseDeps,
  input: VerifyEngagementGateInput,
): Promise<VerifyEngagementGateResult> {
  const gate = await getEngagementGate(deps, input.workspaceId, input.gateId);
  const username = normalizeUsername(input.username);
  if (!username) throw new ValidationError("username is required");

  const existing = await deps.deliveryRepo.findByGateAndUsername(gate.id, username);
  if (existing) {
    const check = conditionsFromMetadata(existing.metadata);
    return {
      gateId: gate.id,
      username,
      eligible: conditionsPass(gate.conditions ?? null, check),
      conditions: check,
      delivery: {
        id: existing.id,
        token: existing.deliveryToken,
        consumedAt: existing.consumedAt,
      },
      lineHarness: lineHarnessForGate(gate),
    };
  }

  const account = await loadAccount(deps, gate.workspaceId, gate.socialAccountId);
  if (account.status !== "active" || gate.status !== "active") {
    return {
      gateId: gate.id,
      username,
      eligible: false,
      conditions: { liked: false, reposted: false, followed: false },
      delivery: null,
      lineHarness: lineHarnessForGate(gate),
    };
  }

  const conditions = gate.conditions ?? null;
  let check = withoutRequirements();
  if (requiresConditionCheck(conditions)) {
    const provider = getProvider(deps, account.platform);
    if (!provider.checkEngagementConditions) {
      check = { liked: false, reposted: false, followed: false };
    } else {
      const accountCredentials = decryptCredentials(
        account.credentialsEncrypted,
        deps.encryptionKey,
      );
      check = await provider.checkEngagementConditions({
        accountCredentials,
        triggerPostId: gate.triggerPostId,
        externalUserId: username,
        conditions: conditions ?? {},
      });
    }
  }

  const eligible = conditionsPass(conditions, check);
  if (!eligible) {
    return {
      gateId: gate.id,
      username,
      eligible: false,
      conditions: check,
      delivery: null,
      lineHarness: lineHarnessForGate(gate),
    };
  }

  const created = await deps.deliveryRepo.createOnce({
    workspaceId: gate.workspaceId,
    engagementGateId: gate.id,
    socialAccountId: gate.socialAccountId,
    externalUserId: username,
    externalReplyId: null,
    actionType: gate.actionType,
    status: "verified",
    responseExternalId: null,
    deliveryToken: createDeliveryToken(),
    consumedAt: null,
    metadata: { username, conditions: check },
    deliveredAt: new Date(),
  });

  return {
    gateId: gate.id,
    username,
    eligible: true,
    conditions: check,
    delivery: {
      id: created.delivery.id,
      token: created.delivery.deliveryToken,
      consumedAt: created.delivery.consumedAt,
    },
    lineHarness: lineHarnessForGate(gate),
  };
}

export async function consumeEngagementGateDeliveryToken(
  deps: EngagementGateUsecaseDeps,
  input: ConsumeEngagementGateDeliveryTokenInput,
): Promise<ConsumeEngagementGateDeliveryTokenResult> {
  await getEngagementGate(deps, input.workspaceId, input.gateId);
  const deliveryToken = input.deliveryToken.trim();
  if (!deliveryToken) throw new ValidationError("deliveryToken is required");

  const result = await deps.deliveryRepo.consumeToken(input.gateId, deliveryToken, new Date());
  if (!result) {
    throw new NotFoundError("EngagementGateDelivery", deliveryToken);
  }

  return {
    consumed: result.consumed,
    delivery: {
      id: result.delivery.id,
      deliveryToken: result.delivery.deliveryToken,
      consumedAt: result.delivery.consumedAt,
    },
  };
}
