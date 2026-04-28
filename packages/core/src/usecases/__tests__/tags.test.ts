import { describe, expect, it } from "vitest";
import type {
  AccountRepository,
  FollowerTagInput,
  TagCreateInput,
  TagRepository,
  TagUpdateInput,
} from "../../interfaces/repositories.js";
import type { SocialAccount, Tag } from "../../domain/entities.js";
import {
  attachFollowerTag,
  createTag,
  detachFollowerTag,
  listTags,
  type TagUsecaseDeps,
} from "../tags.js";

function mockAccount(platform: "x" | "line" | "instagram" = "x"): SocialAccount {
  return {
    id: "acc-1",
    workspaceId: "ws-1",
    platform,
    displayName: "Brand",
    externalAccountId: "brand-x",
    credentialsEncrypted: "encrypted",
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

function mockTagRepo(): TagRepository & {
  tags: Map<string, Tag>;
  followerTags: Set<string>;
} {
  const tags = new Map<string, Tag>();
  const followerTags = new Set<string>();
  let seq = 0;
  return {
    tags,
    followerTags,
    findById: async (id) => tags.get(id) ?? null,
    findByWorkspace: async (workspaceId, filters) =>
      [...tags.values()].filter(
        (tag) =>
          tag.workspaceId === workspaceId &&
          (!filters?.socialAccountId || tag.socialAccountId === filters.socialAccountId),
      ),
    create: async (input: TagCreateInput) => {
      const now = new Date("2026-04-28T00:00:00Z");
      const tag: Tag = {
        id: `tag-${++seq}`,
        workspaceId: input.workspaceId,
        socialAccountId: input.socialAccountId,
        name: input.name,
        color: input.color,
        createdAt: now,
        updatedAt: now,
      };
      tags.set(tag.id, tag);
      return tag;
    },
    update: async (id: string, data: TagUpdateInput) => {
      const existing = tags.get(id);
      if (!existing) throw new Error("not found");
      const updated = {
        ...existing,
        ...data,
        updatedAt: new Date("2026-04-28T01:00:00Z"),
      };
      tags.set(id, updated);
      return updated;
    },
    delete: async (id: string) => {
      tags.delete(id);
      for (const key of [...followerTags]) {
        if (key.endsWith(`:${id}`)) followerTags.delete(key);
      }
    },
    attachToFollower: async (input: FollowerTagInput) => {
      followerTags.add(`${input.followerId}:${input.tagId}`);
    },
    detachFromFollower: async (input: FollowerTagInput) => {
      followerTags.delete(`${input.followerId}:${input.tagId}`);
    },
  };
}

function buildDeps(platform: "x" | "line" | "instagram" = "x"): TagUsecaseDeps & {
  tagRepo: ReturnType<typeof mockTagRepo>;
} {
  const account = mockAccount(platform);
  const tagRepo = mockTagRepo();
  return {
    accountRepo: mockAccountRepo(account),
    tagRepo,
  };
}

describe("tags usecase", () => {
  it("creates trimmed tags that are unique per X account", async () => {
    const deps = buildDeps();

    const tag = await createTag(deps, {
      workspaceId: "ws-1",
      socialAccountId: "acc-1",
      name: "  vip  ",
      color: "#eab308",
    });

    expect(tag).toMatchObject({ name: "vip", color: "#eab308" });
    await expect(
      createTag(deps, {
        workspaceId: "ws-1",
        socialAccountId: "acc-1",
        name: "vip",
        color: null,
      }),
    ).rejects.toThrow("Tag already exists");
    await expect(listTags(deps, "ws-1", { socialAccountId: "acc-1" })).resolves.toHaveLength(1);
  });

  it("rejects non-X account tags", async () => {
    const deps = buildDeps("line");

    await expect(
      createTag(deps, {
        workspaceId: "ws-1",
        socialAccountId: "acc-1",
        name: "vip",
        color: null,
      }),
    ).rejects.toThrow("Tags are only supported for X accounts");
  });

  it("attaches and detaches follower tags idempotently", async () => {
    const deps = buildDeps();
    const tag = await createTag(deps, {
      workspaceId: "ws-1",
      socialAccountId: "acc-1",
      name: "customer",
      color: null,
    });

    await attachFollowerTag(deps, {
      workspaceId: "ws-1",
      socialAccountId: "acc-1",
      followerId: "follower-1",
      tagId: tag.id,
    });
    await attachFollowerTag(deps, {
      workspaceId: "ws-1",
      socialAccountId: "acc-1",
      followerId: "follower-1",
      tagId: tag.id,
    });

    expect(deps.tagRepo.followerTags).toEqual(new Set([`follower-1:${tag.id}`]));

    await detachFollowerTag(deps, {
      workspaceId: "ws-1",
      socialAccountId: "acc-1",
      followerId: "follower-1",
      tagId: tag.id,
    });
    await detachFollowerTag(deps, {
      workspaceId: "ws-1",
      socialAccountId: "acc-1",
      followerId: "follower-1",
      tagId: tag.id,
    });

    expect(deps.tagRepo.followerTags).toEqual(new Set());
  });
});
