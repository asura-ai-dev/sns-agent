/**
 * LlmRouteRepository の Drizzle 実装（骨格）
 * core/interfaces/repositories.ts の LlmRouteRepository に準拠
 */
import { eq, and, desc, isNull, or } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { LlmRouteRepository } from "@sns-agent/core";
import type { LlmRoute } from "@sns-agent/core";
import { llmRoutes } from "../schema/llm-routes.js";
import type { DbClient } from "../client.js";

function rowToEntity(row: typeof llmRoutes.$inferSelect): LlmRoute {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    platform: row.platform,
    action: row.action,
    provider: row.provider,
    model: row.model,
    temperature: row.temperature,
    maxTokens: row.maxTokens,
    fallbackProvider: row.fallbackProvider,
    fallbackModel: row.fallbackModel,
    priority: row.priority,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class DrizzleLlmRouteRepository implements LlmRouteRepository {
  constructor(private readonly db: DbClient) {}

  async findByWorkspace(workspaceId: string): Promise<LlmRoute[]> {
    const rows = await this.db
      .select()
      .from(llmRoutes)
      .where(eq(llmRoutes.workspaceId, workspaceId))
      .orderBy(desc(llmRoutes.priority));
    return rows.map(rowToEntity);
  }

  async resolve(
    workspaceId: string,
    options: { platform?: string; action?: string },
  ): Promise<LlmRoute | null> {
    // Priority-based matching: most specific first (both set), then partial, then default (both null)
    const rows = await this.db
      .select()
      .from(llmRoutes)
      .where(
        and(
          eq(llmRoutes.workspaceId, workspaceId),
          or(
            // Exact match
            options.platform
              ? eq(llmRoutes.platform, options.platform)
              : isNull(llmRoutes.platform),
            isNull(llmRoutes.platform),
          ),
          or(
            options.action ? eq(llmRoutes.action, options.action) : isNull(llmRoutes.action),
            isNull(llmRoutes.action),
          ),
        ),
      )
      .orderBy(desc(llmRoutes.priority))
      .limit(1);

    return rows.length > 0 ? rowToEntity(rows[0]) : null;
  }

  async create(route: Omit<LlmRoute, "id" | "createdAt" | "updatedAt">): Promise<LlmRoute> {
    const now = new Date();
    const id = randomUUID();
    await this.db.insert(llmRoutes).values({
      id,
      workspaceId: route.workspaceId,
      platform: route.platform,
      action: route.action,
      provider: route.provider,
      model: route.model,
      temperature: route.temperature,
      maxTokens: route.maxTokens,
      fallbackProvider: route.fallbackProvider,
      fallbackModel: route.fallbackModel,
      priority: route.priority,
      createdAt: now,
      updatedAt: now,
    });
    return { ...route, id, createdAt: now, updatedAt: now };
  }

  async update(id: string, data: Partial<LlmRoute>): Promise<LlmRoute> {
    const now = new Date();
    const updateData: Record<string, unknown> = { ...data, updatedAt: now };
    delete updateData.id;
    delete updateData.createdAt;

    await this.db.update(llmRoutes).set(updateData).where(eq(llmRoutes.id, id));

    const rows = await this.db.select().from(llmRoutes).where(eq(llmRoutes.id, id)).limit(1);
    if (rows.length === 0) {
      throw new Error(`LlmRoute not found: ${id}`);
    }
    return rowToEntity(rows[0]);
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(llmRoutes).where(eq(llmRoutes.id, id));
  }
}
