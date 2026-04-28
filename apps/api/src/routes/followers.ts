import { Hono } from "hono";
import {
  listFollowers,
  syncFollowersFromProvider,
  type Follower,
  type FollowerUsecaseDeps,
} from "@sns-agent/core";
import { DrizzleAccountRepository, DrizzleFollowerRepository } from "@sns-agent/db";
import { requirePermission } from "../middleware/rbac.js";
import { getProviderRegistry } from "../providers.js";
import type { AppVariables } from "../types.js";

const followers = new Hono<{ Variables: AppVariables }>();

function buildDeps(db: AppVariables["db"]): FollowerUsecaseDeps {
  const encryptionKey =
    process.env.ENCRYPTION_KEY ||
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  return {
    accountRepo: new DrizzleAccountRepository(db),
    followerRepo: new DrizzleFollowerRepository(db),
    providers: getProviderRegistry().getAll(),
    encryptionKey,
  };
}

function parseIntOrUndefined(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isNaN(n) ? undefined : n;
}

function parseBooleanOrUndefined(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function serializeFollower(follower: Follower): Record<string, unknown> {
  return {
    id: follower.id,
    workspaceId: follower.workspaceId,
    socialAccountId: follower.socialAccountId,
    platform: follower.platform,
    externalUserId: follower.externalUserId,
    displayName: follower.displayName,
    username: follower.username,
    isFollowing: follower.isFollowing,
    isFollowed: follower.isFollowed,
    unfollowedAt: follower.unfollowedAt,
    metadata: follower.metadata,
    lastSeenAt: follower.lastSeenAt,
    createdAt: follower.createdAt,
    updatedAt: follower.updatedAt,
  };
}

followers.get("/", requirePermission("inbox:read"), async (c) => {
  const actor = c.get("actor");
  const deps = buildDeps(c.get("db"));

  const result = await listFollowers(deps, actor.workspaceId, {
    socialAccountId: c.req.query("socialAccountId"),
    isFollowed: parseBooleanOrUndefined(c.req.query("isFollowed")),
    isFollowing: parseBooleanOrUndefined(c.req.query("isFollowing")),
    limit: parseIntOrUndefined(c.req.query("limit")),
    offset: parseIntOrUndefined(c.req.query("offset")),
  });

  return c.json({
    data: result.data.map(serializeFollower),
    meta: result.meta,
  });
});

followers.post("/sync", requirePermission("inbox:read"), async (c) => {
  const actor = c.get("actor");
  const deps = buildDeps(c.get("db"));
  const body = await c.req.json<{
    socialAccountId?: string;
    limit?: number;
    followersCursor?: string | null;
    followingCursor?: string | null;
  }>();

  if (!body.socialAccountId) {
    return c.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "socialAccountId is required",
        },
      },
      400,
    );
  }

  const result = await syncFollowersFromProvider(deps, {
    workspaceId: actor.workspaceId,
    socialAccountId: body.socialAccountId,
    limit: body.limit,
    followersCursor: body.followersCursor ?? null,
    followingCursor: body.followingCursor ?? null,
  });

  return c.json({ data: result });
});

export { followers };
