import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type {
  StepEnrollment,
  StepEnrollmentCreateInput,
  StepEnrollmentRepository,
  StepEnrollmentUpdateInput,
  StepMessage,
  StepMessageCreateInput,
  StepMessageRepository,
  StepSequence,
  StepSequenceCreateInput,
  StepSequenceListFilters,
  StepSequenceRepository,
  StepSequenceUpdateInput,
  EngagementGateStealthConfig,
} from "@sns-agent/core";
import { stepEnrollments, stepMessages, stepSequences } from "../schema/step-sequences.js";
import type { DbClient } from "../client.js";

function rowToSequence(row: typeof stepSequences.$inferSelect): StepSequence {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    socialAccountId: row.socialAccountId,
    platform: row.platform,
    name: row.name,
    status: row.status,
    stealthConfig: (row.stealthConfig as EngagementGateStealthConfig | null) ?? null,
    deliveryBackoffUntil: row.deliveryBackoffUntil,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function rowToMessage(row: typeof stepMessages.$inferSelect): StepMessage {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    sequenceId: row.sequenceId,
    stepIndex: row.stepIndex,
    delaySeconds: row.delaySeconds,
    actionType: row.actionType,
    contentText: row.contentText,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function rowToEnrollment(row: typeof stepEnrollments.$inferSelect): StepEnrollment {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    sequenceId: row.sequenceId,
    socialAccountId: row.socialAccountId,
    externalUserId: row.externalUserId,
    username: row.username,
    externalThreadId: row.externalThreadId,
    replyToMessageId: row.replyToMessageId,
    status: row.status,
    currentStepIndex: row.currentStepIndex,
    nextStepAt: row.nextStepAt,
    lastDeliveredAt: row.lastDeliveredAt,
    completedAt: row.completedAt,
    cancelledAt: row.cancelledAt,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class DrizzleStepSequenceRepository implements StepSequenceRepository {
  constructor(private readonly db: DbClient) {}

  async findById(id: string): Promise<StepSequence | null> {
    const rows = await this.db
      .select()
      .from(stepSequences)
      .where(eq(stepSequences.id, id))
      .limit(1);
    return rows[0] ? rowToSequence(rows[0]) : null;
  }

  async findByWorkspace(
    workspaceId: string,
    filters: StepSequenceListFilters = {},
  ): Promise<StepSequence[]> {
    const conditions = [eq(stepSequences.workspaceId, workspaceId)];
    if (filters.socialAccountId) {
      conditions.push(eq(stepSequences.socialAccountId, filters.socialAccountId));
    }
    if (filters.status) {
      conditions.push(eq(stepSequences.status, filters.status));
    }
    const rows = await this.db
      .select()
      .from(stepSequences)
      .where(and(...conditions))
      .orderBy(asc(stepSequences.createdAt));
    return rows.map(rowToSequence);
  }

  async create(input: StepSequenceCreateInput): Promise<StepSequence> {
    const now = new Date();
    const id = randomUUID();
    await this.db.insert(stepSequences).values({
      id,
      workspaceId: input.workspaceId,
      socialAccountId: input.socialAccountId,
      platform: input.platform,
      name: input.name,
      status: input.status,
      stealthConfig: input.stealthConfig,
      deliveryBackoffUntil: input.deliveryBackoffUntil,
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
    });
    return { ...input, id, createdAt: now, updatedAt: now };
  }

  async update(id: string, data: StepSequenceUpdateInput): Promise<StepSequence> {
    const now = new Date();
    await this.db
      .update(stepSequences)
      .set({ ...data, updatedAt: now })
      .where(eq(stepSequences.id, id));
    const updated = await this.findById(id);
    if (!updated) throw new Error(`StepSequence not found: ${id}`);
    return updated;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(stepEnrollments).where(eq(stepEnrollments.sequenceId, id));
    await this.db.delete(stepMessages).where(eq(stepMessages.sequenceId, id));
    await this.db.delete(stepSequences).where(eq(stepSequences.id, id));
  }
}

export class DrizzleStepMessageRepository implements StepMessageRepository {
  constructor(private readonly db: DbClient) {}

  async findBySequence(sequenceId: string): Promise<StepMessage[]> {
    const rows = await this.db
      .select()
      .from(stepMessages)
      .where(eq(stepMessages.sequenceId, sequenceId))
      .orderBy(asc(stepMessages.stepIndex));
    return rows.map(rowToMessage);
  }

  async replaceForSequence(
    sequenceId: string,
    messages: StepMessageCreateInput[],
  ): Promise<StepMessage[]> {
    await this.db.delete(stepMessages).where(eq(stepMessages.sequenceId, sequenceId));
    const now = new Date();
    const rows = messages.map((message) => ({
      id: randomUUID(),
      workspaceId: message.workspaceId,
      sequenceId: message.sequenceId,
      stepIndex: message.stepIndex,
      delaySeconds: message.delaySeconds,
      actionType: message.actionType,
      contentText: message.contentText,
      createdAt: now,
      updatedAt: now,
    }));
    if (rows.length > 0) {
      await this.db.insert(stepMessages).values(rows);
    }
    return rows;
  }
}

export class DrizzleStepEnrollmentRepository implements StepEnrollmentRepository {
  constructor(private readonly db: DbClient) {}

  async findById(id: string): Promise<StepEnrollment | null> {
    const rows = await this.db
      .select()
      .from(stepEnrollments)
      .where(eq(stepEnrollments.id, id))
      .limit(1);
    return rows[0] ? rowToEnrollment(rows[0]) : null;
  }

  async findBySequence(sequenceId: string): Promise<StepEnrollment[]> {
    const rows = await this.db
      .select()
      .from(stepEnrollments)
      .where(eq(stepEnrollments.sequenceId, sequenceId));
    return rows.map(rowToEnrollment);
  }

  async findActiveDue(input: {
    now: Date;
    limit: number;
    workspaceId?: string;
  }): Promise<StepEnrollment[]> {
    const conditions = [
      eq(stepEnrollments.status, "active"),
      lte(stepEnrollments.nextStepAt, input.now),
    ];
    if (input.workspaceId) {
      conditions.push(eq(stepEnrollments.workspaceId, input.workspaceId));
    }

    const rows = await this.db
      .select()
      .from(stepEnrollments)
      .where(and(...conditions))
      .limit(input.limit);
    return rows.map(rowToEnrollment);
  }

  async countDeliveredBySequenceSince(sequenceId: string, since: Date): Promise<number> {
    const rows = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(stepEnrollments)
      .where(
        and(
          eq(stepEnrollments.sequenceId, sequenceId),
          gte(stepEnrollments.lastDeliveredAt, since),
        ),
      );
    return Number(rows[0]?.count ?? 0);
  }

  async countDeliveredByAccountSince(socialAccountId: string, since: Date): Promise<number> {
    const rows = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(stepEnrollments)
      .where(
        and(
          eq(stepEnrollments.socialAccountId, socialAccountId),
          gte(stepEnrollments.lastDeliveredAt, since),
        ),
      );
    return Number(rows[0]?.count ?? 0);
  }

  async create(input: StepEnrollmentCreateInput): Promise<StepEnrollment> {
    const now = new Date();
    const id = randomUUID();
    await this.db.insert(stepEnrollments).values({
      id,
      workspaceId: input.workspaceId,
      sequenceId: input.sequenceId,
      socialAccountId: input.socialAccountId,
      externalUserId: input.externalUserId,
      username: input.username,
      externalThreadId: input.externalThreadId,
      replyToMessageId: input.replyToMessageId,
      status: input.status,
      currentStepIndex: input.currentStepIndex,
      nextStepAt: input.nextStepAt,
      lastDeliveredAt: input.lastDeliveredAt,
      completedAt: input.completedAt,
      cancelledAt: input.cancelledAt,
      metadata: input.metadata,
      createdAt: now,
      updatedAt: now,
    });
    return { ...input, id, createdAt: now, updatedAt: now };
  }

  async update(id: string, data: StepEnrollmentUpdateInput): Promise<StepEnrollment> {
    const now = new Date();
    await this.db
      .update(stepEnrollments)
      .set({ ...data, updatedAt: now })
      .where(eq(stepEnrollments.id, id));
    const updated = await this.findById(id);
    if (!updated) throw new Error(`StepEnrollment not found: ${id}`);
    return updated;
  }
}
