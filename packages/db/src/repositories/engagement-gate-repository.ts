import { and, eq, gte, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type {
  EngagementGate,
  EngagementGateConditions,
  EngagementGateCreateInput,
  EngagementGateDelivery,
  EngagementGateDeliveryCreateInput,
  EngagementGateDeliveryCreateResult,
  EngagementGateDeliveryRepository,
  EngagementGateListFilters,
  EngagementGateRepository,
  EngagementGateStealthConfig,
  EngagementGateUpdateInput,
} from "@sns-agent/core";
import { engagementGateDeliveries, engagementGates } from "../schema/engagement-gates.js";
import type { DbClient } from "../client.js";

function rowToGate(row: typeof engagementGates.$inferSelect): EngagementGate {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    socialAccountId: row.socialAccountId,
    platform: row.platform,
    name: row.name,
    status: row.status,
    triggerType: row.triggerType,
    triggerPostId: row.triggerPostId,
    conditions: (row.conditions as EngagementGateConditions | null) ?? null,
    actionType: row.actionType,
    actionText: row.actionText,
    lineHarnessUrl: row.lineHarnessUrl,
    lineHarnessApiKeyRef: row.lineHarnessApiKeyRef,
    lineHarnessTag: row.lineHarnessTag,
    lineHarnessScenario: row.lineHarnessScenario,
    stealthConfig: (row.stealthConfig as EngagementGateStealthConfig | null) ?? null,
    deliveryBackoffUntil: row.deliveryBackoffUntil,
    lastReplySinceId: row.lastReplySinceId,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function rowToDelivery(row: typeof engagementGateDeliveries.$inferSelect): EngagementGateDelivery {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    engagementGateId: row.engagementGateId,
    socialAccountId: row.socialAccountId,
    externalUserId: row.externalUserId,
    externalReplyId: row.externalReplyId,
    actionType: row.actionType,
    status: row.status,
    responseExternalId: row.responseExternalId,
    deliveryToken: row.deliveryToken,
    consumedAt: row.consumedAt,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    deliveredAt: row.deliveredAt,
    createdAt: row.createdAt,
  };
}

function normalizeUsername(username: string): string {
  return username.trim().replace(/^@+/, "").toLowerCase();
}

function metadataUsername(delivery: EngagementGateDelivery): string | null {
  const value = delivery.metadata?.username;
  return typeof value === "string" && value.trim() ? normalizeUsername(value) : null;
}

export class DrizzleEngagementGateRepository implements EngagementGateRepository {
  constructor(private readonly db: DbClient) {}

  async findById(id: string): Promise<EngagementGate | null> {
    const rows = await this.db
      .select()
      .from(engagementGates)
      .where(eq(engagementGates.id, id))
      .limit(1);
    return rows[0] ? rowToGate(rows[0]) : null;
  }

  async findByWorkspace(
    workspaceId: string,
    filters: EngagementGateListFilters = {},
  ): Promise<EngagementGate[]> {
    const conditions = [eq(engagementGates.workspaceId, workspaceId)];
    if (filters.socialAccountId) {
      conditions.push(eq(engagementGates.socialAccountId, filters.socialAccountId));
    }
    if (filters.status) {
      conditions.push(eq(engagementGates.status, filters.status));
    }

    let query = this.db
      .select()
      .from(engagementGates)
      .where(and(...conditions));
    if (filters.limit !== undefined) {
      query = query.limit(filters.limit) as typeof query;
    }

    const rows = await query;
    return rows.map(rowToGate);
  }

  async findActiveReplyTriggers(limit: number): Promise<EngagementGate[]> {
    const rows = await this.db
      .select()
      .from(engagementGates)
      .where(and(eq(engagementGates.status, "active"), eq(engagementGates.triggerType, "reply")))
      .limit(limit);
    return rows.map(rowToGate);
  }

  async create(input: EngagementGateCreateInput): Promise<EngagementGate> {
    const now = new Date();
    const id = randomUUID();
    await this.db.insert(engagementGates).values({
      id,
      workspaceId: input.workspaceId,
      socialAccountId: input.socialAccountId,
      platform: input.platform,
      name: input.name,
      status: input.status,
      triggerType: input.triggerType,
      triggerPostId: input.triggerPostId,
      conditions: input.conditions,
      actionType: input.actionType,
      actionText: input.actionText,
      lineHarnessUrl: input.lineHarnessUrl,
      lineHarnessApiKeyRef: input.lineHarnessApiKeyRef,
      lineHarnessTag: input.lineHarnessTag,
      lineHarnessScenario: input.lineHarnessScenario,
      stealthConfig: input.stealthConfig,
      deliveryBackoffUntil: input.deliveryBackoffUntil,
      lastReplySinceId: input.lastReplySinceId,
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
    });
    return { ...input, id, createdAt: now, updatedAt: now };
  }

  async update(id: string, data: EngagementGateUpdateInput): Promise<EngagementGate> {
    const now = new Date();
    await this.db
      .update(engagementGates)
      .set({
        ...data,
        updatedAt: now,
      })
      .where(eq(engagementGates.id, id));
    const updated = await this.findById(id);
    if (!updated) throw new Error(`EngagementGate not found: ${id}`);
    return updated;
  }

  async delete(id: string): Promise<void> {
    await this.db
      .delete(engagementGateDeliveries)
      .where(eq(engagementGateDeliveries.engagementGateId, id));
    await this.db.delete(engagementGates).where(eq(engagementGates.id, id));
  }
}

export class DrizzleEngagementGateDeliveryRepository implements EngagementGateDeliveryRepository {
  constructor(private readonly db: DbClient) {}

  async findByGate(gateId: string): Promise<EngagementGateDelivery[]> {
    const rows = await this.db
      .select()
      .from(engagementGateDeliveries)
      .where(eq(engagementGateDeliveries.engagementGateId, gateId));
    return rows.map(rowToDelivery);
  }

  async findByGateAndUser(
    gateId: string,
    externalUserId: string,
  ): Promise<EngagementGateDelivery | null> {
    const rows = await this.db
      .select()
      .from(engagementGateDeliveries)
      .where(
        and(
          eq(engagementGateDeliveries.engagementGateId, gateId),
          eq(engagementGateDeliveries.externalUserId, externalUserId),
        ),
      )
      .limit(1);
    return rows[0] ? rowToDelivery(rows[0]) : null;
  }

  async findByGateAndUsername(
    gateId: string,
    username: string,
  ): Promise<EngagementGateDelivery | null> {
    const normalized = normalizeUsername(username);
    const deliveries = await this.findByGate(gateId);
    return (
      deliveries.find(
        (delivery) =>
          metadataUsername(delivery) === normalized ||
          normalizeUsername(delivery.externalUserId) === normalized,
      ) ?? null
    );
  }

  async findByGateAndDeliveryToken(
    gateId: string,
    deliveryToken: string,
  ): Promise<EngagementGateDelivery | null> {
    const rows = await this.db
      .select()
      .from(engagementGateDeliveries)
      .where(
        and(
          eq(engagementGateDeliveries.engagementGateId, gateId),
          eq(engagementGateDeliveries.deliveryToken, deliveryToken),
        ),
      )
      .limit(1);
    return rows[0] ? rowToDelivery(rows[0]) : null;
  }

  async countByGateSince(gateId: string, since: Date): Promise<number> {
    const rows = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(engagementGateDeliveries)
      .where(
        and(
          eq(engagementGateDeliveries.engagementGateId, gateId),
          gte(engagementGateDeliveries.deliveredAt, since),
        ),
      );
    return Number(rows[0]?.count ?? 0);
  }

  async countByAccountSince(socialAccountId: string, since: Date): Promise<number> {
    const rows = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(engagementGateDeliveries)
      .where(
        and(
          eq(engagementGateDeliveries.socialAccountId, socialAccountId),
          gte(engagementGateDeliveries.deliveredAt, since),
        ),
      );
    return Number(rows[0]?.count ?? 0);
  }

  async createOnce(
    input: EngagementGateDeliveryCreateInput,
  ): Promise<EngagementGateDeliveryCreateResult> {
    const existing = await this.findByGateAndUser(input.engagementGateId, input.externalUserId);
    if (existing) {
      return { delivery: existing, created: false };
    }

    const id = randomUUID();
    const now = new Date();
    await this.db.insert(engagementGateDeliveries).values({
      id,
      workspaceId: input.workspaceId,
      engagementGateId: input.engagementGateId,
      socialAccountId: input.socialAccountId,
      externalUserId: input.externalUserId,
      externalReplyId: input.externalReplyId,
      actionType: input.actionType,
      status: input.status,
      responseExternalId: input.responseExternalId,
      deliveryToken: input.deliveryToken,
      consumedAt: input.consumedAt,
      metadata: input.metadata,
      deliveredAt: input.deliveredAt,
      createdAt: now,
    });
    return {
      delivery: {
        ...input,
        id,
        createdAt: now,
      },
      created: true,
    };
  }

  async consumeToken(
    gateId: string,
    deliveryToken: string,
    consumedAt: Date,
  ): Promise<{ delivery: EngagementGateDelivery; consumed: boolean } | null> {
    const existing = await this.findByGateAndDeliveryToken(gateId, deliveryToken);
    if (!existing) return null;
    if (existing.consumedAt) return { delivery: existing, consumed: false };

    await this.db
      .update(engagementGateDeliveries)
      .set({ consumedAt })
      .where(
        and(
          eq(engagementGateDeliveries.engagementGateId, gateId),
          eq(engagementGateDeliveries.deliveryToken, deliveryToken),
        ),
      );

    const updated = await this.findByGateAndDeliveryToken(gateId, deliveryToken);
    return updated ? { delivery: updated, consumed: true } : null;
  }
}
