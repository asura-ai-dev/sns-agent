import { describe, expect, it, vi } from "vitest";
import type {
  AccountRepository,
  EngagementGateCreateInput,
  EngagementGateDelivery,
  EngagementGateDeliveryCreateInput,
  EngagementGateDeliveryRepository,
  EngagementGateRepository,
} from "../../interfaces/repositories.js";
import type { EngagementGate, SocialAccount } from "../../domain/entities.js";
import type { SocialProvider } from "../../interfaces/social-provider.js";
import { encrypt } from "../../domain/crypto.js";
import {
  createEngagementGate,
  processEngagementGateReplies,
  type EngagementGateUsecaseDeps,
} from "../engagement-gates.js";

const TEST_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const PLAINTEXT_CREDS = '{"accessToken":"tok","xUserId":"brand-x"}';

function mockAccount(): SocialAccount {
  return {
    id: "acc-1",
    workspaceId: "ws-1",
    platform: "x",
    displayName: "Brand",
    externalAccountId: "brand-x",
    credentialsEncrypted: encrypt(PLAINTEXT_CREDS, TEST_ENCRYPTION_KEY),
    tokenExpiresAt: null,
    status: "active",
    capabilities: null,
    createdAt: new Date("2026-04-28T00:00:00Z"),
    updatedAt: new Date("2026-04-28T00:00:00Z"),
  };
}

function mockAccountRepo(account: SocialAccount): AccountRepository {
  return {
    findById: async (id) => (id === account.id ? account : null),
    findByWorkspace: async () => [account],
    create: async () => {
      throw new Error("not used");
    },
    update: async () => {
      throw new Error("not used");
    },
    delete: async () => {
      throw new Error("not used");
    },
  };
}

function buildGate(input: Partial<EngagementGate> = {}): EngagementGate {
  const now = new Date("2026-04-28T00:00:00Z");
  return {
    id: "gate-1",
    workspaceId: "ws-1",
    socialAccountId: "acc-1",
    platform: "x",
    name: "Reply gate",
    status: "active",
    triggerType: "reply",
    triggerPostId: "tweet-root-1",
    conditions: {
      requireLike: true,
      requireRepost: true,
      requireFollow: true,
    },
    actionType: "mention_post",
    actionText: "secret link",
    lastReplySinceId: null,
    createdBy: "user-1",
    createdAt: now,
    updatedAt: now,
    ...input,
  };
}

function mockGateRepo(initial: EngagementGate[] = []): EngagementGateRepository & {
  rows: Map<string, EngagementGate>;
} {
  const rows = new Map(initial.map((gate) => [gate.id, gate]));
  let seq = rows.size;
  return {
    rows,
    findById: async (id) => rows.get(id) ?? null,
    findByWorkspace: async (workspaceId, filters) =>
      [...rows.values()].filter(
        (gate) =>
          gate.workspaceId === workspaceId &&
          (!filters?.socialAccountId || gate.socialAccountId === filters.socialAccountId) &&
          (!filters?.status || gate.status === filters.status),
      ),
    findActiveReplyTriggers: async (limit) =>
      [...rows.values()]
        .filter((gate) => gate.status === "active" && gate.triggerType === "reply")
        .slice(0, limit),
    create: async (input: EngagementGateCreateInput) => {
      const now = new Date("2026-04-28T00:00:00Z");
      const row: EngagementGate = {
        ...input,
        id: `gate-${++seq}`,
        createdAt: now,
        updatedAt: now,
      };
      rows.set(row.id, row);
      return row;
    },
    update: async (id, data) => {
      const existing = rows.get(id);
      if (!existing) throw new Error("missing gate");
      const updated = {
        ...existing,
        ...data,
        updatedAt: new Date("2026-04-28T01:00:00Z"),
      };
      rows.set(id, updated);
      return updated;
    },
    delete: async (id) => {
      rows.delete(id);
    },
  };
}

function mockDeliveryRepo(): EngagementGateDeliveryRepository & {
  rows: Map<string, EngagementGateDelivery>;
} {
  const rows = new Map<string, EngagementGateDelivery>();
  let seq = 0;
  return {
    rows,
    findByGate: async (gateId) =>
      [...rows.values()].filter((delivery) => delivery.engagementGateId === gateId),
    findByGateAndUser: async (gateId, externalUserId) =>
      rows.get(`${gateId}:${externalUserId}`) ?? null,
    createOnce: async (input: EngagementGateDeliveryCreateInput) => {
      const key = `${input.engagementGateId}:${input.externalUserId}`;
      const existing = rows.get(key);
      if (existing) return { delivery: existing, created: false };
      const delivery: EngagementGateDelivery = {
        ...input,
        id: `delivery-${++seq}`,
        createdAt: input.deliveredAt,
      };
      rows.set(key, delivery);
      return { delivery, created: true };
    },
  };
}

function mockProvider(): SocialProvider {
  return {
    platform: "x",
    getCapabilities: () => ({
      textPost: true,
      imagePost: true,
      videoPost: false,
      threadPost: true,
      directMessage: true,
      commentReply: true,
      broadcast: false,
      nativeSchedule: false,
      usageApi: false,
    }),
    connectAccount: async () => ({}),
    validatePost: async () => ({ valid: true, errors: [], warnings: [] }),
    publishPost: async () => ({ success: true, platformPostId: "post-1", publishedAt: null }),
    deletePost: async () => ({ success: true }),
    listEngagementReplies: vi.fn(async () => ({
      replies: [
        {
          externalReplyId: "tweet-10",
          externalUserId: "user-1",
          username: "alice",
          text: "@brand count me in",
          createdAt: new Date("2026-04-28T00:10:00Z"),
          conversationId: "tweet-root-1",
          inReplyToPostId: "tweet-root-1",
        },
      ],
      nextSinceId: "tweet-10",
    })),
    checkEngagementConditions: vi.fn(async () => ({
      liked: true,
      reposted: true,
      followed: true,
    })),
    sendReply: vi.fn(async () => ({
      success: true,
      externalMessageId: "reply-secret-1",
    })),
  };
}

function buildDeps(
  gate: EngagementGate = buildGate(),
  provider: SocialProvider = mockProvider(),
): EngagementGateUsecaseDeps & {
  gateRepo: ReturnType<typeof mockGateRepo>;
  deliveryRepo: ReturnType<typeof mockDeliveryRepo>;
  provider: SocialProvider;
} {
  const account = mockAccount();
  const gateRepo = mockGateRepo([gate]);
  const deliveryRepo = mockDeliveryRepo();
  return {
    accountRepo: mockAccountRepo(account),
    gateRepo,
    deliveryRepo,
    providers: new Map([["x", provider]]),
    encryptionKey: TEST_ENCRYPTION_KEY,
    provider,
  };
}

describe("engagement gate usecases", () => {
  it("creates a reply-trigger gate for the account workspace", async () => {
    const deps = buildDeps();

    const gate = await createEngagementGate(deps, {
      workspaceId: "ws-1",
      socialAccountId: "acc-1",
      name: " Launch gate ",
      triggerPostId: "tweet-root-1",
      conditions: { requireLike: true },
      actionType: "verify_only",
      actionText: null,
      createdBy: "user-1",
    });

    expect(gate).toMatchObject({
      workspaceId: "ws-1",
      socialAccountId: "acc-1",
      platform: "x",
      name: "Launch gate",
      status: "active",
      triggerType: "reply",
      conditions: { requireLike: true },
      actionType: "verify_only",
    });
  });

  it("processes reply-trigger gates with condition checks delivery dedupe and since-id update", async () => {
    const deps = buildDeps();

    const result = await processEngagementGateReplies(deps, { limit: 10 });

    expect(result).toMatchObject({
      gatesScanned: 1,
      repliesScanned: 1,
      deliveriesCreated: 1,
      skippedDuplicate: 0,
      skippedIneligible: 0,
      actionsSent: 1,
      lastReplySinceIdsUpdated: 1,
    });
    expect(deps.provider.listEngagementReplies).toHaveBeenCalledWith(
      expect.objectContaining({
        accountCredentials: PLAINTEXT_CREDS,
        accountExternalId: "brand-x",
        triggerPostId: "tweet-root-1",
        sinceId: null,
      }),
    );
    expect(deps.provider.checkEngagementConditions).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerPostId: "tweet-root-1",
        externalUserId: "user-1",
        conditions: {
          requireLike: true,
          requireRepost: true,
          requireFollow: true,
        },
      }),
    );
    expect(deps.provider.sendReply).toHaveBeenCalledWith(
      expect.objectContaining({
        externalThreadId: "tweet-root-1",
        replyToMessageId: "tweet-10",
        contentText: "@alice secret link",
      }),
    );
    expect(deps.gateRepo.rows.get("gate-1")?.lastReplySinceId).toBe("tweet-10");
    expect([...deps.deliveryRepo.rows.values()][0]).toMatchObject({
      engagementGateId: "gate-1",
      externalUserId: "user-1",
      externalReplyId: "tweet-10",
      actionType: "mention_post",
      status: "delivered",
      responseExternalId: "reply-secret-1",
    });
  });

  it("skips duplicate gate/user deliveries before sending another action", async () => {
    const deps = buildDeps();
    await processEngagementGateReplies(deps, { limit: 10 });

    const second = await processEngagementGateReplies(deps, { limit: 10 });

    expect(second.skippedDuplicate).toBe(1);
    expect(deps.provider.sendReply).toHaveBeenCalledTimes(1);
    expect(deps.deliveryRepo.rows).toHaveLength(1);
  });

  it("supports dm and verify_only action types", async () => {
    const dmDeps = buildDeps(buildGate({ id: "gate-dm", actionType: "dm" }));
    await processEngagementGateReplies(dmDeps, { limit: 10 });

    expect(dmDeps.provider.sendReply).toHaveBeenCalledWith(
      expect.objectContaining({
        externalThreadId: "dm:user-1",
        replyToMessageId: null,
        contentText: "secret link",
      }),
    );

    const verifyProvider = mockProvider();
    const verifyDeps = buildDeps(
      buildGate({ id: "gate-verify", actionType: "verify_only", actionText: null }),
      verifyProvider,
    );
    await processEngagementGateReplies(verifyDeps, { limit: 10 });

    expect(verifyProvider.sendReply).not.toHaveBeenCalled();
    expect([...verifyDeps.deliveryRepo.rows.values()][0]).toMatchObject({
      status: "verified",
      responseExternalId: null,
    });
  });
});
