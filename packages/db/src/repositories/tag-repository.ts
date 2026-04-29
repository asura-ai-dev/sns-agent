import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type {
  FollowerTagInput,
  Tag,
  TagCreateInput,
  TagListFilters,
  TagRepository,
  TagUpdateInput,
} from "@sns-agent/core";
import { followers } from "../schema/followers.js";
import { followerTags, tags } from "../schema/tags.js";
import type { DbClient } from "../client.js";

function rowToEntity(row: typeof tags.$inferSelect): Tag {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    socialAccountId: row.socialAccountId,
    name: row.name,
    color: row.color,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class DrizzleTagRepository implements TagRepository {
  constructor(private readonly db: DbClient) {}

  async findById(id: string): Promise<Tag | null> {
    const rows = await this.db.select().from(tags).where(eq(tags.id, id)).limit(1);
    return rows[0] ? rowToEntity(rows[0]) : null;
  }

  async findByWorkspace(workspaceId: string, filters: TagListFilters = {}): Promise<Tag[]> {
    const conditions = [eq(tags.workspaceId, workspaceId)];
    if (filters.socialAccountId) {
      conditions.push(eq(tags.socialAccountId, filters.socialAccountId));
    }

    const rows = await this.db
      .select()
      .from(tags)
      .where(and(...conditions));
    return rows.map(rowToEntity);
  }

  async create(input: TagCreateInput): Promise<Tag> {
    const id = randomUUID();
    const now = new Date();
    await this.db.insert(tags).values({
      id,
      workspaceId: input.workspaceId,
      socialAccountId: input.socialAccountId,
      name: input.name,
      color: input.color,
      createdAt: now,
      updatedAt: now,
    });
    return { ...input, id, createdAt: now, updatedAt: now };
  }

  async update(id: string, data: TagUpdateInput): Promise<Tag> {
    const now = new Date();
    await this.db.update(tags).set({ ...data, updatedAt: now }).where(eq(tags.id, id));
    const updated = await this.findById(id);
    if (!updated) {
      throw new Error(`Tag not found: ${id}`);
    }
    return updated;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(followerTags).where(eq(followerTags.tagId, id));
    await this.db.delete(tags).where(eq(tags.id, id));
  }

  async attachToFollower(input: FollowerTagInput): Promise<void> {
    await this.assertFollowerAndTagInSameAccount(input);
    await this.db
      .insert(followerTags)
      .values({
        followerId: input.followerId,
        tagId: input.tagId,
        createdAt: new Date(),
      })
      .onConflictDoNothing();
  }

  async detachFromFollower(input: FollowerTagInput): Promise<void> {
    await this.assertFollowerAndTagInSameAccount(input);
    await this.db
      .delete(followerTags)
      .where(
        and(eq(followerTags.followerId, input.followerId), eq(followerTags.tagId, input.tagId)),
      );
  }

  private async assertFollowerAndTagInSameAccount(input: FollowerTagInput): Promise<void> {
    const rows = await this.db
      .select({ followerId: followers.id, tagId: tags.id })
      .from(followers)
      .innerJoin(tags, eq(tags.id, input.tagId))
      .where(
        and(
          eq(followers.id, input.followerId),
          eq(followers.workspaceId, input.workspaceId),
          eq(followers.socialAccountId, input.socialAccountId),
          eq(tags.workspaceId, input.workspaceId),
          eq(tags.socialAccountId, input.socialAccountId),
        ),
      )
      .limit(1);
    if (!rows[0]) {
      throw new Error("Follower and tag must belong to the same workspace account");
    }
  }
}
