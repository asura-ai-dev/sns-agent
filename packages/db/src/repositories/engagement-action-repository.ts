import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type {
  EngagementAction,
  EngagementActionCreateInput,
  EngagementActionCreateResult,
  EngagementActionDedupeInput,
  EngagementActionRepository,
} from "@sns-agent/core";
import { engagementActions } from "../schema/engagement-actions.js";
import type { DbClient } from "../client.js";

function rowToEntity(row: typeof engagementActions.$inferSelect): EngagementAction {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    socialAccountId: row.socialAccountId,
    threadId: row.threadId,
    messageId: row.messageId,
    actionType: row.actionType as EngagementAction["actionType"],
    targetPostId: row.targetPostId,
    actorId: row.actorId,
    externalActionId: row.externalActionId,
    status: row.status as EngagementAction["status"],
    metadata: row.metadata as EngagementAction["metadata"],
    performedAt: row.performedAt,
    createdAt: row.createdAt,
  };
}

export class DrizzleEngagementActionRepository implements EngagementActionRepository {
  constructor(private readonly db: DbClient) {}

  async findByThread(threadId: string): Promise<EngagementAction[]> {
    const rows = await this.db
      .select()
      .from(engagementActions)
      .where(eq(engagementActions.threadId, threadId));
    return rows.map(rowToEntity);
  }

  async findByDedupeKey(input: EngagementActionDedupeInput): Promise<EngagementAction | null> {
    const rows = await this.db
      .select()
      .from(engagementActions)
      .where(
        and(
          eq(engagementActions.workspaceId, input.workspaceId),
          eq(engagementActions.socialAccountId, input.socialAccountId),
          eq(engagementActions.actionType, input.actionType),
          eq(engagementActions.targetPostId, input.targetPostId),
        ),
      )
      .limit(1);
    return rows.length > 0 ? rowToEntity(rows[0]) : null;
  }

  async createOnce(input: EngagementActionCreateInput): Promise<EngagementActionCreateResult> {
    const existing = await this.findByDedupeKey(input);
    if (existing) {
      return { action: existing, created: false };
    }

    const id = randomUUID();
    const now = new Date();
    await this.db.insert(engagementActions).values({
      id,
      workspaceId: input.workspaceId,
      socialAccountId: input.socialAccountId,
      threadId: input.threadId,
      messageId: input.messageId,
      actionType: input.actionType,
      targetPostId: input.targetPostId,
      actorId: input.actorId,
      externalActionId: input.externalActionId,
      status: input.status,
      metadata: input.metadata,
      performedAt: input.performedAt,
      createdAt: now,
    });

    return {
      action: {
        ...input,
        id,
        createdAt: now,
      },
      created: true,
    };
  }
}
