import { describe, expect, it } from "vitest";
import type {
  AccountRepository,
  FollowerRepository,
  FollowerSnapshotRepository,
} from "../../interfaces/repositories.js";
import type { FollowerSnapshot, SocialAccount } from "../../domain/entities.js";
import {
  captureFollowerSnapshot,
  getFollowerAnalytics,
  type FollowerAnalyticsUsecaseDeps,
} from "../follower-analytics.js";

function mockAccount(): SocialAccount {
  return {
    id: "acc-1",
    workspaceId: "ws-1",
    platform: "x",
    displayName: "Brand",
    externalAccountId: "x-brand",
    credentialsEncrypted: "encrypted",
    tokenExpiresAt: null,
    status: "active",
    capabilities: null,
    createdAt: new Date("2026-04-01T00:00:00Z"),
    updatedAt: new Date("2026-04-01T00:00:00Z"),
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

function mockFollowerRepo(counts: { followed: number; following: number }): FollowerRepository {
  return {
    findByWorkspace: async (_workspaceId, filters) =>
      Array.from({ length: filters?.isFollowing ? counts.following : counts.followed }, (_, i) => ({
        id: `follower-${i}`,
        workspaceId: "ws-1",
        socialAccountId: "acc-1",
        platform: "x" as const,
        externalUserId: `user-${i}`,
        displayName: null,
        username: null,
        isFollowing: Boolean(filters?.isFollowing),
        isFollowed: Boolean(filters?.isFollowed),
        unfollowedAt: null,
        metadata: null,
        lastSeenAt: new Date("2026-04-01T00:00:00Z"),
        createdAt: new Date("2026-04-01T00:00:00Z"),
        updatedAt: new Date("2026-04-01T00:00:00Z"),
      })),
    findByAccountAndExternalUser: async () => null,
    upsert: async () => {
      throw new Error("not used");
    },
    markMissingFollowersUnfollowed: async () => 0,
    markMissingFollowingInactive: async () => 0,
  };
}

function mockSnapshotRepo(initial: FollowerSnapshot[] = []): FollowerSnapshotRepository & {
  rows: FollowerSnapshot[];
} {
  const rows = [...initial];
  return {
    rows,
    upsertDailySnapshot: async (input) => {
      const existing = rows.find(
        (row) =>
          row.workspaceId === input.workspaceId &&
          row.socialAccountId === input.socialAccountId &&
          row.snapshotDate === input.snapshotDate,
      );
      if (existing) {
        Object.assign(existing, input, { updatedAt: input.capturedAt });
        return { snapshot: existing, created: false };
      }
      const snapshot: FollowerSnapshot = {
        ...input,
        id: `snapshot-${rows.length + 1}`,
        createdAt: input.capturedAt,
        updatedAt: input.capturedAt,
      };
      rows.push(snapshot);
      return { snapshot, created: true };
    },
    findByAccount: async (workspaceId, socialAccountId) =>
      rows.filter(
        (row) => row.workspaceId === workspaceId && row.socialAccountId === socialAccountId,
      ),
  };
}

function buildDeps(opts?: {
  followerCounts?: { followed: number; following: number };
  snapshots?: FollowerSnapshot[];
}): FollowerAnalyticsUsecaseDeps {
  const account = mockAccount();
  return {
    accountRepo: mockAccountRepo(account),
    followerRepo: mockFollowerRepo(opts?.followerCounts ?? { followed: 0, following: 0 }),
    snapshotRepo: mockSnapshotRepo(opts?.snapshots),
  };
}

describe("follower analytics usecase", () => {
  it("captures one idempotent daily follower snapshot from current follower rows", async () => {
    const deps = buildDeps({ followerCounts: { followed: 42, following: 17 } });

    const first = await captureFollowerSnapshot(deps, {
      workspaceId: "ws-1",
      socialAccountId: "acc-1",
      capturedAt: new Date("2026-04-29T14:30:00Z"),
    });
    const second = await captureFollowerSnapshot(deps, {
      workspaceId: "ws-1",
      socialAccountId: "acc-1",
      capturedAt: new Date("2026-04-29T16:00:00Z"),
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.snapshot).toMatchObject({
      snapshotDate: "2026-04-29",
      followerCount: 42,
      followingCount: 17,
    });
  });

  it("returns current count, 7 day delta, 30 day delta, and sorted time series", async () => {
    const deps = buildDeps({
      snapshots: [
        {
          id: "snap-30",
          workspaceId: "ws-1",
          socialAccountId: "acc-1",
          platform: "x",
          snapshotDate: "2026-03-30",
          followerCount: 80,
          followingCount: 20,
          capturedAt: new Date("2026-03-30T00:00:00Z"),
          createdAt: new Date("2026-03-30T00:00:00Z"),
          updatedAt: new Date("2026-03-30T00:00:00Z"),
        },
        {
          id: "snap-current",
          workspaceId: "ws-1",
          socialAccountId: "acc-1",
          platform: "x",
          snapshotDate: "2026-04-29",
          followerCount: 120,
          followingCount: 30,
          capturedAt: new Date("2026-04-29T00:00:00Z"),
          createdAt: new Date("2026-04-29T00:00:00Z"),
          updatedAt: new Date("2026-04-29T00:00:00Z"),
        },
        {
          id: "snap-7",
          workspaceId: "ws-1",
          socialAccountId: "acc-1",
          platform: "x",
          snapshotDate: "2026-04-22",
          followerCount: 100,
          followingCount: 25,
          capturedAt: new Date("2026-04-22T00:00:00Z"),
          createdAt: new Date("2026-04-22T00:00:00Z"),
          updatedAt: new Date("2026-04-22T00:00:00Z"),
        },
      ],
    });

    const result = await getFollowerAnalytics(deps, {
      workspaceId: "ws-1",
      socialAccountId: "acc-1",
      asOfDate: "2026-04-29",
    });

    expect(result).toMatchObject({
      currentCount: 120,
      delta7Days: 20,
      delta30Days: 40,
    });
    expect(result.series.map((point) => point.date)).toEqual([
      "2026-03-30",
      "2026-04-22",
      "2026-04-29",
    ]);
  });
});
