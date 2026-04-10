/**
 * PostRepository の Drizzle 実装
 * core/interfaces/repositories.ts の PostRepository に準拠
 */
import { eq, and, desc } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { PostRepository } from "@sns-agent/core";
import type { Post } from "@sns-agent/core";
import { posts } from "../schema/posts.js";
import type { DbClient } from "../client.js";

function rowToEntity(row: typeof posts.$inferSelect): Post {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    socialAccountId: row.socialAccountId,
    platform: row.platform as Post["platform"],
    status: row.status as Post["status"],
    contentText: row.contentText,
    contentMedia: row.contentMedia as Post["contentMedia"],
    platformPostId: row.platformPostId,
    validationResult: row.validationResult,
    idempotencyKey: row.idempotencyKey,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    publishedAt: row.publishedAt,
  };
}

export class DrizzlePostRepository implements PostRepository {
  constructor(private readonly db: DbClient) {}

  async findById(id: string): Promise<Post | null> {
    const rows = await this.db.select().from(posts).where(eq(posts.id, id)).limit(1);
    return rows.length > 0 ? rowToEntity(rows[0]) : null;
  }

  async findByWorkspace(
    workspaceId: string,
    options?: { platform?: string; status?: string; limit?: number; offset?: number },
  ): Promise<Post[]> {
    const conditions = [eq(posts.workspaceId, workspaceId)];

    if (options?.platform) {
      conditions.push(eq(posts.platform, options.platform as Post["platform"]));
    }
    if (options?.status) {
      conditions.push(eq(posts.status, options.status as Post["status"]));
    }

    let query = this.db
      .select()
      .from(posts)
      .where(and(...conditions))
      .orderBy(desc(posts.createdAt));

    if (options?.limit) {
      query = query.limit(options.limit) as typeof query;
    }
    if (options?.offset) {
      query = query.offset(options.offset) as typeof query;
    }

    const rows = await query;
    return rows.map(rowToEntity);
  }

  async create(post: Omit<Post, "id" | "createdAt" | "updatedAt">): Promise<Post> {
    const now = new Date();
    const id = randomUUID();
    await this.db.insert(posts).values({
      id,
      workspaceId: post.workspaceId,
      socialAccountId: post.socialAccountId,
      platform: post.platform,
      status: post.status,
      contentText: post.contentText,
      contentMedia: post.contentMedia as unknown as Record<string, unknown>[] | null,
      platformPostId: post.platformPostId,
      validationResult: post.validationResult as Record<string, unknown> | null,
      idempotencyKey: post.idempotencyKey,
      createdBy: post.createdBy,
      publishedAt: post.publishedAt,
      createdAt: now,
      updatedAt: now,
    });
    return { ...post, id, createdAt: now, updatedAt: now };
  }

  async update(id: string, data: Partial<Post>): Promise<Post> {
    const now = new Date();
    const updateData: Record<string, unknown> = { ...data, updatedAt: now };
    delete updateData.id;
    delete updateData.createdAt;

    if (updateData.contentMedia !== undefined) {
      updateData.contentMedia = updateData.contentMedia as unknown as
        | Record<string, unknown>[]
        | null;
    }
    if (updateData.validationResult !== undefined) {
      updateData.validationResult = updateData.validationResult as unknown as Record<
        string,
        unknown
      > | null;
    }

    await this.db.update(posts).set(updateData).where(eq(posts.id, id));

    const updated = await this.findById(id);
    if (!updated) {
      throw new Error(`Post not found: ${id}`);
    }
    return updated;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(posts).where(eq(posts.id, id));
  }

  async findByIdempotencyKey(key: string): Promise<Post | null> {
    const rows = await this.db.select().from(posts).where(eq(posts.idempotencyKey, key)).limit(1);
    return rows.length > 0 ? rowToEntity(rows[0]) : null;
  }
}
