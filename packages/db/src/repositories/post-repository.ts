/**
 * PostRepository の Drizzle 実装
 * core/interfaces/repositories.ts の PostRepository に準拠
 *
 * Task 2006: 一覧クエリを拡充し、複数 platform / status、日付範囲、
 * contentText 部分一致検索、ソートキー切り替え、total count 返却に対応する。
 */
import { eq, and, desc, asc, inArray, gte, lte, like, sql, type SQL } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { PostRepository, PostListFilters } from "@sns-agent/core";
import type { Post } from "@sns-agent/core";
import { posts } from "../schema/posts.js";
import { scheduledJobs } from "../schema/scheduled-jobs.js";
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
    providerMetadata: (row.providerMetadata as Post["providerMetadata"]) ?? null,
    platformPostId: row.platformPostId,
    validationResult: row.validationResult,
    idempotencyKey: row.idempotencyKey,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    publishedAt: row.publishedAt,
  };
}

/**
 * PostListFilters から WHERE 条件の配列を構築する。
 * workspaceId は別途呼び出し側で追加する。
 */
function buildConditions(options: PostListFilters | undefined): SQL[] {
  const conditions: SQL[] = [];
  if (!options) return conditions;

  // platforms (配列) を優先、なければ単一 platform
  const platformList =
    options.platforms && options.platforms.length > 0
      ? options.platforms
      : options.platform
        ? [options.platform]
        : undefined;
  if (platformList && platformList.length > 0) {
    conditions.push(inArray(posts.platform, platformList as Array<Post["platform"]>));
  }

  const statusList =
    options.statuses && options.statuses.length > 0
      ? options.statuses
      : options.status
        ? [options.status]
        : undefined;
  if (statusList && statusList.length > 0) {
    conditions.push(inArray(posts.status, statusList as Array<Post["status"]>));
  }

  if (options.from) {
    conditions.push(gte(posts.createdAt, options.from));
  }
  if (options.to) {
    conditions.push(lte(posts.createdAt, options.to));
  }

  if (options.search && options.search.length > 0) {
    // SQLite LIKE は大文字小文字を区別しない (default collation)
    // エスケープは単純化のため %/_ はそのまま扱う (v1 ベストエフォート)
    conditions.push(like(posts.contentText, `%${options.search}%`));
  }

  return conditions;
}

export class DrizzlePostRepository implements PostRepository {
  constructor(private readonly db: DbClient) {}

  async findById(id: string): Promise<Post | null> {
    const rows = await this.db.select().from(posts).where(eq(posts.id, id)).limit(1);
    return rows.length > 0 ? rowToEntity(rows[0]) : null;
  }

  async findByWorkspace(workspaceId: string, options?: PostListFilters): Promise<Post[]> {
    const conditions: SQL[] = [eq(posts.workspaceId, workspaceId), ...buildConditions(options)];

    const orderBy = options?.orderBy ?? "createdAt";

    // scheduledAt ソートは scheduled_jobs との LEFT JOIN が必要。
    // created_at / published_at は posts テーブル内で完結。
    if (orderBy === "scheduledAt") {
      // 1 post に対し複数ジョブがある可能性があるため MAX(scheduled_at) を使う
      const subquery = this.db
        .select({
          postId: scheduledJobs.postId,
          maxScheduledAt: sql<number>`MAX(${scheduledJobs.scheduledAt})`.as("max_scheduled_at"),
        })
        .from(scheduledJobs)
        .groupBy(scheduledJobs.postId)
        .as("latest_schedule");

      let query = this.db
        .select({ post: posts })
        .from(posts)
        .leftJoin(subquery, eq(posts.id, subquery.postId))
        .where(and(...conditions))
        .orderBy(desc(subquery.maxScheduledAt), desc(posts.createdAt));

      if (options?.limit) {
        query = query.limit(options.limit) as typeof query;
      }
      if (options?.offset) {
        query = query.offset(options.offset) as typeof query;
      }
      const rows = await query;
      return rows.map((r) => rowToEntity(r.post));
    }

    const orderExpr = orderBy === "publishedAt" ? desc(posts.publishedAt) : desc(posts.createdAt);

    let query = this.db
      .select()
      .from(posts)
      .where(and(...conditions))
      .orderBy(orderExpr, desc(posts.createdAt));

    if (options?.limit) {
      query = query.limit(options.limit) as typeof query;
    }
    if (options?.offset) {
      query = query.offset(options.offset) as typeof query;
    }

    const rows = await query;
    return rows.map(rowToEntity);
  }

  async countByWorkspace(
    workspaceId: string,
    options?: Omit<PostListFilters, "limit" | "offset" | "orderBy">,
  ): Promise<number> {
    const conditions: SQL[] = [eq(posts.workspaceId, workspaceId), ...buildConditions(options)];
    const rows = await this.db
      .select({ count: sql<number>`COUNT(*)` })
      .from(posts)
      .where(and(...conditions));
    return Number(rows[0]?.count ?? 0);
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
      providerMetadata: (post.providerMetadata ?? null) as Record<string, unknown> | null,
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
    if (updateData.providerMetadata !== undefined) {
      updateData.providerMetadata = updateData.providerMetadata as unknown as Record<
        string,
        unknown
      > | null;
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

// asc is exported to keep the import surface aligned with future sort extensions.
void asc;
