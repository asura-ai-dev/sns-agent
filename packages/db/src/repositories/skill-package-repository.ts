/**
 * SkillPackageRepository の Drizzle 実装 (Task 5002)
 *
 * core/interfaces/repositories.ts の SkillPackageRepository に準拠。
 * design.md セクション 3.1 の skill_packages テーブルに対応する。
 */
import { eq, and, desc } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { SkillPackage, SkillPackageRepository } from "@sns-agent/core";
import { skillPackages } from "../schema/skill-packages.js";
import type { DbClient } from "../client.js";

function rowToEntity(row: typeof skillPackages.$inferSelect): SkillPackage {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    version: row.version,
    platform: row.platform,
    llmProvider: row.llmProvider,
    manifest: (row.manifest ?? {}) as Record<string, unknown>,
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class DrizzleSkillPackageRepository implements SkillPackageRepository {
  constructor(private readonly db: DbClient) {}

  async findById(id: string): Promise<SkillPackage | null> {
    const rows = await this.db
      .select()
      .from(skillPackages)
      .where(eq(skillPackages.id, id))
      .limit(1);
    return rows[0] ? rowToEntity(rows[0]) : null;
  }

  async findByWorkspace(workspaceId: string, onlyEnabled = false): Promise<SkillPackage[]> {
    const condition = onlyEnabled
      ? and(eq(skillPackages.workspaceId, workspaceId), eq(skillPackages.enabled, true))
      : eq(skillPackages.workspaceId, workspaceId);
    const rows = await this.db
      .select()
      .from(skillPackages)
      .where(condition)
      .orderBy(desc(skillPackages.updatedAt));
    return rows.map(rowToEntity);
  }

  async findByName(workspaceId: string, name: string): Promise<SkillPackage | null> {
    const rows = await this.db
      .select()
      .from(skillPackages)
      .where(and(eq(skillPackages.workspaceId, workspaceId), eq(skillPackages.name, name)))
      .limit(1);
    return rows[0] ? rowToEntity(rows[0]) : null;
  }

  async create(pkg: Omit<SkillPackage, "id" | "createdAt" | "updatedAt">): Promise<SkillPackage> {
    const now = new Date();
    const id = randomUUID();
    await this.db.insert(skillPackages).values({
      id,
      workspaceId: pkg.workspaceId,
      name: pkg.name,
      version: pkg.version,
      platform: pkg.platform,
      llmProvider: pkg.llmProvider,
      manifest: pkg.manifest,
      enabled: pkg.enabled,
      createdAt: now,
      updatedAt: now,
    });
    const created = await this.findById(id);
    if (!created) {
      throw new Error(`Failed to create skill package: ${id}`);
    }
    return created;
  }

  async update(id: string, data: Partial<SkillPackage>): Promise<SkillPackage> {
    const patch: Partial<typeof skillPackages.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (data.name !== undefined) patch.name = data.name;
    if (data.version !== undefined) patch.version = data.version;
    if (data.platform !== undefined) patch.platform = data.platform;
    if (data.llmProvider !== undefined) patch.llmProvider = data.llmProvider;
    if (data.manifest !== undefined) patch.manifest = data.manifest;
    if (data.enabled !== undefined) patch.enabled = data.enabled;

    await this.db.update(skillPackages).set(patch).where(eq(skillPackages.id, id));
    const updated = await this.findById(id);
    if (!updated) {
      throw new Error(`Skill package not found after update: ${id}`);
    }
    return updated;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(skillPackages).where(eq(skillPackages.id, id));
  }
}
