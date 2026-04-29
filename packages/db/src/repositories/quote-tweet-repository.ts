import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type {
  MediaAttachment,
  QuoteTweet,
  QuoteTweetActionRecordInput,
  QuoteTweetListFilters,
  QuoteTweetRepository,
  QuoteTweetUpsertInput,
} from "@sns-agent/core";
import { quoteTweets } from "../schema/quote-tweets.js";
import type { DbClient } from "../client.js";

function rowToEntity(row: typeof quoteTweets.$inferSelect): QuoteTweet {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    socialAccountId: row.socialAccountId,
    sourceTweetId: row.sourceTweetId,
    quoteTweetId: row.quoteTweetId,
    authorExternalId: row.authorExternalId,
    authorUsername: row.authorUsername,
    authorDisplayName: row.authorDisplayName,
    authorProfileImageUrl: row.authorProfileImageUrl,
    authorVerified: row.authorVerified,
    contentText: row.contentText,
    contentMedia: (row.contentMedia as MediaAttachment[] | null) ?? null,
    quotedAt: row.quotedAt,
    metrics: (row.metrics as Record<string, unknown> | null) ?? null,
    providerMetadata: (row.providerMetadata as Record<string, unknown> | null) ?? null,
    lastActionType: row.lastActionType,
    lastActionExternalId: row.lastActionExternalId,
    lastActionAt: row.lastActionAt,
    discoveredAt: row.discoveredAt,
    lastSeenAt: row.lastSeenAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class DrizzleQuoteTweetRepository implements QuoteTweetRepository {
  constructor(private readonly db: DbClient) {}

  async findById(id: string): Promise<QuoteTweet | null> {
    const rows = await this.db.select().from(quoteTweets).where(eq(quoteTweets.id, id)).limit(1);
    return rows[0] ? rowToEntity(rows[0]) : null;
  }

  async findBySourceAndQuote(
    workspaceId: string,
    socialAccountId: string,
    sourceTweetId: string,
    quoteTweetId: string,
  ): Promise<QuoteTweet | null> {
    const rows = await this.db
      .select()
      .from(quoteTweets)
      .where(
        and(
          eq(quoteTweets.workspaceId, workspaceId),
          eq(quoteTweets.socialAccountId, socialAccountId),
          eq(quoteTweets.sourceTweetId, sourceTweetId),
          eq(quoteTweets.quoteTweetId, quoteTweetId),
        ),
      )
      .limit(1);
    return rows[0] ? rowToEntity(rows[0]) : null;
  }

  async findByWorkspace(
    workspaceId: string,
    filters: QuoteTweetListFilters = {},
  ): Promise<QuoteTweet[]> {
    const conditions = [eq(quoteTweets.workspaceId, workspaceId)];
    if (filters.socialAccountId) {
      conditions.push(eq(quoteTweets.socialAccountId, filters.socialAccountId));
    }
    if (filters.sourceTweetId) {
      conditions.push(eq(quoteTweets.sourceTweetId, filters.sourceTweetId));
    }

    let query = this.db
      .select()
      .from(quoteTweets)
      .where(and(...conditions))
      .orderBy(desc(quoteTweets.quotedAt), desc(quoteTweets.createdAt));
    if (filters.limit !== undefined) {
      query = query.limit(filters.limit) as typeof query;
    }
    if (filters.offset !== undefined) {
      query = query.offset(filters.offset) as typeof query;
    }
    const rows = await query;
    return rows.map(rowToEntity);
  }

  async upsert(input: QuoteTweetUpsertInput): Promise<QuoteTweet> {
    const existing = await this.findBySourceAndQuote(
      input.workspaceId,
      input.socialAccountId,
      input.sourceTweetId,
      input.quoteTweetId,
    );
    const now = new Date();

    if (existing) {
      await this.db
        .update(quoteTweets)
        .set({
          authorExternalId: input.authorExternalId,
          authorUsername: input.authorUsername,
          authorDisplayName: input.authorDisplayName,
          authorProfileImageUrl: input.authorProfileImageUrl,
          authorVerified: input.authorVerified,
          contentText: input.contentText,
          contentMedia: input.contentMedia,
          quotedAt: input.quotedAt,
          metrics: input.metrics,
          providerMetadata: input.providerMetadata,
          lastSeenAt: input.lastSeenAt,
          updatedAt: now,
        })
        .where(eq(quoteTweets.id, existing.id));
      return {
        ...existing,
        ...input,
        updatedAt: now,
      };
    }

    const id = randomUUID();
    await this.db.insert(quoteTweets).values({
      id,
      workspaceId: input.workspaceId,
      socialAccountId: input.socialAccountId,
      sourceTweetId: input.sourceTweetId,
      quoteTweetId: input.quoteTweetId,
      authorExternalId: input.authorExternalId,
      authorUsername: input.authorUsername,
      authorDisplayName: input.authorDisplayName,
      authorProfileImageUrl: input.authorProfileImageUrl,
      authorVerified: input.authorVerified,
      contentText: input.contentText,
      contentMedia: input.contentMedia,
      quotedAt: input.quotedAt,
      metrics: input.metrics,
      providerMetadata: input.providerMetadata,
      lastActionType: null,
      lastActionExternalId: null,
      lastActionAt: null,
      discoveredAt: input.discoveredAt,
      lastSeenAt: input.lastSeenAt,
      createdAt: now,
      updatedAt: now,
    });
    return {
      ...input,
      id,
      lastActionType: null,
      lastActionExternalId: null,
      lastActionAt: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  async recordAction(id: string, input: QuoteTweetActionRecordInput): Promise<QuoteTweet> {
    await this.db
      .update(quoteTweets)
      .set({
        lastActionType: input.actionType,
        lastActionExternalId: input.externalActionId,
        lastActionAt: input.actedAt,
        updatedAt: input.actedAt,
      })
      .where(eq(quoteTweets.id, id));

    const row = await this.findById(id);
    if (!row) {
      throw new Error(`QuoteTweet not found: ${id}`);
    }
    return row;
  }
}
