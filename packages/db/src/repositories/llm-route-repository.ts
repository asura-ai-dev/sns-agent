/**
 * LlmRouteRepository の Drizzle 実装（骨格）
 * core/interfaces/repositories.ts の LlmRouteRepository に準拠
 */
import { eq, desc } from "drizzle-orm";
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
    // Fetch all workspace routes and perform specificity scoring in the application layer.
    // Specificity rule (design.md 3.1): platform+action > platform > action > default (both NULL).
    // Ties broken by route.priority DESC.
    //
    // SQL 層で複雑な specificity ロジックを組むより、全件取得してアプリ側で判定する方が
    // v1 スコープではシンプルかつテスト容易。ワークスペースあたりのルート件数は
    // 数十件程度を想定しており、全件取得のコストは問題にならない。
    const rows = await this.db
      .select()
      .from(llmRoutes)
      .where(eq(llmRoutes.workspaceId, workspaceId));

    if (rows.length === 0) return null;

    type Scored = { row: (typeof rows)[number]; score: number };
    const candidates: Scored[] = [];

    for (const row of rows) {
      // route が platform/action を指定していて、options と一致しない場合は除外
      if (row.platform !== null && row.platform !== options.platform) continue;
      if (row.action !== null && row.action !== options.action) continue;

      let score = 0;
      if (row.platform !== null && row.platform === options.platform) score += 2;
      if (row.action !== null && row.action === options.action) score += 1;
      candidates.push({ row, score });
    }

    if (candidates.length === 0) return null;

    candidates.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.row.priority - a.row.priority;
    });

    return rowToEntity(candidates[0].row);
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
