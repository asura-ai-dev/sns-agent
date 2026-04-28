import { and, eq, inArray, notInArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type {
  Follower,
  FollowerListFilters,
  FollowerRepository,
  FollowerUpsertInput,
  MarkMissingFollowersInput,
  MarkMissingFollowingInput,
} from "@sns-agent/core";
import { followers } from "../schema/followers.js";
import { followerTags } from "../schema/tags.js";
import type { DbClient } from "../client.js";

function rowToEntity(row: typeof followers.$inferSelect): Follower {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    socialAccountId: row.socialAccountId,
    platform: row.platform,
    externalUserId: row.externalUserId,
    displayName: row.displayName,
    username: row.username,
    isFollowing: row.isFollowing,
    isFollowed: row.isFollowed,
    unfollowedAt: row.unfollowedAt,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    lastSeenAt: row.lastSeenAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class DrizzleFollowerRepository implements FollowerRepository {
  constructor(private readonly db: DbClient) {}

  async findByWorkspace(
    workspaceId: string,
    filters: FollowerListFilters = {},
  ): Promise<Follower[]> {
    const conditions = [eq(followers.workspaceId, workspaceId)];
    if (filters.tagId) {
      const taggedRows = await this.db
        .select({ followerId: followerTags.followerId })
        .from(followerTags)
        .where(eq(followerTags.tagId, filters.tagId));
      if (taggedRows.length === 0) return [];
      conditions.push(
        inArray(
          followers.id,
          taggedRows.map((row) => row.followerId),
        ),
      );
    }
    if (filters.socialAccountId) {
      conditions.push(eq(followers.socialAccountId, filters.socialAccountId));
    }
    if (filters.isFollowed !== undefined) {
      conditions.push(eq(followers.isFollowed, filters.isFollowed));
    }
    if (filters.isFollowing !== undefined) {
      conditions.push(eq(followers.isFollowing, filters.isFollowing));
    }

    let query = this.db
      .select()
      .from(followers)
      .where(and(...conditions));
    if (filters.limit !== undefined) {
      query = query.limit(filters.limit) as typeof query;
    }
    if (filters.offset !== undefined) {
      query = query.offset(filters.offset) as typeof query;
    }

    const rows = await query;
    return rows.map(rowToEntity);
  }

  async findByAccountAndExternalUser(
    socialAccountId: string,
    externalUserId: string,
  ): Promise<Follower | null> {
    const rows = await this.db
      .select()
      .from(followers)
      .where(
        and(
          eq(followers.socialAccountId, socialAccountId),
          eq(followers.externalUserId, externalUserId),
        ),
      )
      .limit(1);
    return rows[0] ? rowToEntity(rows[0]) : null;
  }

  async upsert(input: FollowerUpsertInput): Promise<Follower> {
    const now = new Date();
    const existing = await this.findByAccountAndExternalUser(
      input.socialAccountId,
      input.externalUserId,
    );

    if (existing) {
      await this.db
        .update(followers)
        .set({
          displayName: input.displayName,
          username: input.username,
          isFollowed: input.isFollowed,
          isFollowing: input.isFollowing,
          unfollowedAt: input.unfollowedAt,
          metadata: input.metadata,
          lastSeenAt: input.lastSeenAt,
          updatedAt: now,
        })
        .where(eq(followers.id, existing.id));

      return {
        ...existing,
        ...input,
        updatedAt: now,
      };
    }

    const id = randomUUID();
    await this.db.insert(followers).values({
      id,
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
      createdAt: now,
      updatedAt: now,
    });

    return { ...input, id, createdAt: now, updatedAt: now };
  }

  async markMissingFollowersUnfollowed(input: MarkMissingFollowersInput): Promise<number> {
    const conditions = [
      eq(followers.workspaceId, input.workspaceId),
      eq(followers.socialAccountId, input.socialAccountId),
      eq(followers.isFollowed, true),
    ];
    if (input.currentExternalUserIds.length > 0) {
      conditions.push(notInArray(followers.externalUserId, input.currentExternalUserIds));
    }

    const rows = await this.db
      .select({ id: followers.id })
      .from(followers)
      .where(and(...conditions));
    if (rows.length === 0) return 0;

    await this.db
      .update(followers)
      .set({
        isFollowed: false,
        unfollowedAt: input.unfollowedAt,
        updatedAt: input.unfollowedAt,
      })
      .where(
        inArray(
          followers.id,
          rows.map((row) => row.id),
        ),
      );
    return rows.length;
  }

  async markMissingFollowingInactive(input: MarkMissingFollowingInput): Promise<number> {
    const conditions = [
      eq(followers.workspaceId, input.workspaceId),
      eq(followers.socialAccountId, input.socialAccountId),
      eq(followers.isFollowing, true),
    ];
    if (input.currentExternalUserIds.length > 0) {
      conditions.push(notInArray(followers.externalUserId, input.currentExternalUserIds));
    }

    const rows = await this.db
      .select({ id: followers.id })
      .from(followers)
      .where(and(...conditions));
    if (rows.length === 0) return 0;

    await this.db
      .update(followers)
      .set({
        isFollowing: false,
        updatedAt: input.updatedAt,
      })
      .where(
        inArray(
          followers.id,
          rows.map((row) => row.id),
        ),
      );
    return rows.length;
  }
}
