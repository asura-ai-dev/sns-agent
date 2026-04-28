import { and, asc, eq, gte, lte } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type {
  FollowerSnapshot,
  FollowerSnapshotCreateInput,
  FollowerSnapshotRepository,
  FollowerSnapshotUpsertResult,
} from "@sns-agent/core";
import { followerSnapshots } from "../schema/follower-snapshots.js";
import type { DbClient } from "../client.js";

function rowToEntity(row: typeof followerSnapshots.$inferSelect): FollowerSnapshot {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    socialAccountId: row.socialAccountId,
    platform: row.platform,
    snapshotDate: row.snapshotDate,
    followerCount: row.followerCount,
    followingCount: row.followingCount,
    capturedAt: row.capturedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class DrizzleFollowerSnapshotRepository implements FollowerSnapshotRepository {
  constructor(private readonly db: DbClient) {}

  async upsertDailySnapshot(
    input: FollowerSnapshotCreateInput,
  ): Promise<FollowerSnapshotUpsertResult> {
    const existing = await this.findByAccount(input.workspaceId, input.socialAccountId, {
      fromDate: input.snapshotDate,
      toDate: input.snapshotDate,
    });
    const current = existing[0];
    if (current) {
      await this.db
        .update(followerSnapshots)
        .set({
          followerCount: input.followerCount,
          followingCount: input.followingCount,
          capturedAt: input.capturedAt,
          updatedAt: input.capturedAt,
        })
        .where(eq(followerSnapshots.id, current.id));

      return {
        snapshot: {
          ...current,
          followerCount: input.followerCount,
          followingCount: input.followingCount,
          capturedAt: input.capturedAt,
          updatedAt: input.capturedAt,
        },
        created: false,
      };
    }

    const id = randomUUID();
    await this.db.insert(followerSnapshots).values({
      id,
      workspaceId: input.workspaceId,
      socialAccountId: input.socialAccountId,
      platform: input.platform,
      snapshotDate: input.snapshotDate,
      followerCount: input.followerCount,
      followingCount: input.followingCount,
      capturedAt: input.capturedAt,
      createdAt: input.capturedAt,
      updatedAt: input.capturedAt,
    });

    return {
      snapshot: {
        ...input,
        id,
        createdAt: input.capturedAt,
        updatedAt: input.capturedAt,
      },
      created: true,
    };
  }

  async findByAccount(
    workspaceId: string,
    socialAccountId: string,
    options: { fromDate?: string; toDate?: string } = {},
  ): Promise<FollowerSnapshot[]> {
    const conditions = [
      eq(followerSnapshots.workspaceId, workspaceId),
      eq(followerSnapshots.socialAccountId, socialAccountId),
    ];
    if (options.fromDate) {
      conditions.push(gte(followerSnapshots.snapshotDate, options.fromDate));
    }
    if (options.toDate) {
      conditions.push(lte(followerSnapshots.snapshotDate, options.toDate));
    }

    const rows = await this.db
      .select()
      .from(followerSnapshots)
      .where(and(...conditions))
      .orderBy(asc(followerSnapshots.snapshotDate));
    return rows.map(rowToEntity);
  }
}
