import { describe, expect, it } from "vitest";
import type {
  AccountRepository,
  FollowerRepository,
  FollowerUpsertInput,
} from "../../interfaces/repositories.js";
import type { Follower, SocialAccount } from "../../domain/entities.js";
import type { SocialProvider } from "../../interfaces/social-provider.js";
import { encrypt } from "../../domain/crypto.js";
import {
  listFollowers,
  syncFollowersFromProvider,
  type FollowerUsecaseDeps,
} from "../followers.js";

const TEST_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const PLAINTEXT_CREDS = '{"accessToken":"tok","xUserId":"123"}';

function mockAccount(): SocialAccount {
  return {
    id: "acc-1",
    workspaceId: "ws-1",
    platform: "x",
    displayName: "Brand",
    externalAccountId: "123",
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

function mockFollowerRepo(): FollowerRepository & {
  rows: Map<string, Follower>;
  missingFollowerCalls: unknown[];
  missingFollowingCalls: unknown[];
} {
  const rows = new Map<string, Follower>();
  const missingFollowerCalls: unknown[] = [];
  const missingFollowingCalls: unknown[] = [];
  let seq = 0;
  return {
    rows,
    missingFollowerCalls,
    missingFollowingCalls,
    findByWorkspace: async (workspaceId, filters) =>
      [...rows.values()].filter(
        (row) =>
          row.workspaceId === workspaceId &&
          (!filters?.socialAccountId || row.socialAccountId === filters.socialAccountId),
      ),
    findByAccountAndExternalUser: async (socialAccountId, externalUserId) =>
      [...rows.values()].find(
        (row) => row.socialAccountId === socialAccountId && row.externalUserId === externalUserId,
      ) ?? null,
    upsert: async (input: FollowerUpsertInput) => {
      const key = `${input.socialAccountId}:${input.externalUserId}`;
      const existing = rows.get(key);
      const now = input.lastSeenAt;
      const row: Follower = {
        id: existing?.id ?? `follower-${++seq}`,
        workspaceId: input.workspaceId,
        socialAccountId: input.socialAccountId,
        platform: input.platform,
        externalUserId: input.externalUserId,
        displayName: input.displayName,
        username: input.username,
        isFollowed: input.isFollowed,
        isFollowing: input.isFollowing,
        unfollowedAt: input.unfollowedAt,
        metadata: input.metadata,
        lastSeenAt: input.lastSeenAt,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      rows.set(key, row);
      return row;
    },
    markMissingFollowersUnfollowed: async (input) => {
      missingFollowerCalls.push(input);
      return 0;
    },
    markMissingFollowingInactive: async (input) => {
      missingFollowingCalls.push(input);
      return 0;
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
    listFollowers: async () => ({
      profiles: [
        {
          externalUserId: "u-1",
          displayName: "Alice",
          username: "alice",
          metadata: { verified: true },
        },
      ],
      nextCursor: null,
    }),
    listFollowing: async () => ({
      profiles: [
        {
          externalUserId: "u-1",
          displayName: "Alice",
          username: "alice",
          metadata: { verified: true },
        },
        {
          externalUserId: "u-2",
          displayName: "Bob",
          username: "bob",
          metadata: null,
        },
      ],
      nextCursor: null,
    }),
  };
}

function buildDeps(): FollowerUsecaseDeps & {
  followerRepo: ReturnType<typeof mockFollowerRepo>;
} {
  const account = mockAccount();
  const followerRepo = mockFollowerRepo();
  return {
    accountRepo: mockAccountRepo(account),
    followerRepo,
    providers: new Map([["x", mockProvider()]]),
    encryptionKey: TEST_ENCRYPTION_KEY,
  };
}

describe("followers usecase", () => {
  it("syncs followers and following into one relationship row per X user", async () => {
    const deps = buildDeps();

    const result = await syncFollowersFromProvider(deps, {
      workspaceId: "ws-1",
      socialAccountId: "acc-1",
      limit: 100,
    });

    expect(result).toEqual({
      followerCount: 1,
      followingCount: 2,
      nextFollowersCursor: null,
      nextFollowingCursor: null,
      markedUnfollowedCount: 0,
      markedUnfollowingCount: 0,
    });
    expect(await deps.followerRepo.findByWorkspace("ws-1", { socialAccountId: "acc-1" })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          externalUserId: "u-1",
          isFollowed: true,
          isFollowing: true,
          unfollowedAt: null,
        }),
        expect.objectContaining({
          externalUserId: "u-2",
          isFollowed: false,
          isFollowing: true,
        }),
      ]),
    );
    expect(deps.followerRepo.missingFollowerCalls).toHaveLength(1);
    expect(deps.followerRepo.missingFollowingCalls).toHaveLength(1);
  });

  it("lists followers for one account", async () => {
    const deps = buildDeps();
    await deps.followerRepo.upsert({
      workspaceId: "ws-1",
      socialAccountId: "acc-1",
      platform: "x",
      externalUserId: "u-1",
      displayName: "Alice",
      username: "alice",
      isFollowed: true,
      isFollowing: false,
      unfollowedAt: null,
      metadata: null,
      lastSeenAt: new Date("2026-04-28T00:00:00Z"),
    });

    const result = await listFollowers(deps, "ws-1", { socialAccountId: "acc-1" });

    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.externalUserId).toBe("u-1");
  });
});
