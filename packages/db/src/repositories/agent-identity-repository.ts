/**
 * AgentIdentityRepository の Drizzle 実装
 * Task 2001: API キー認証で AgentIdentity を解決するために使用
 */
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { AgentIdentity } from "@sns-agent/core";
import { agentIdentities } from "../schema/agent-identities.js";
import type { DbClient } from "../client.js";

/**
 * AgentIdentity Repository インターフェース
 */
export interface AgentIdentityRepository {
  findById(id: string): Promise<AgentIdentity | null>;
  findByApiKeyHash(apiKeyHash: string): Promise<AgentIdentity | null>;
  findByWorkspace(workspaceId: string): Promise<AgentIdentity[]>;
  create(identity: Omit<AgentIdentity, "id" | "createdAt">): Promise<AgentIdentity>;
  update(
    id: string,
    data: Partial<Pick<AgentIdentity, "name" | "role" | "apiKeyHash">>,
  ): Promise<AgentIdentity>;
  delete(id: string): Promise<void>;
}

function rowToEntity(row: typeof agentIdentities.$inferSelect): AgentIdentity {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    role: row.role as AgentIdentity["role"],
    apiKeyHash: row.apiKeyHash,
    createdAt: row.createdAt,
  };
}

export class DrizzleAgentIdentityRepository implements AgentIdentityRepository {
  constructor(private readonly db: DbClient) {}

  async findById(id: string): Promise<AgentIdentity | null> {
    const rows = await this.db
      .select()
      .from(agentIdentities)
      .where(eq(agentIdentities.id, id))
      .limit(1);
    return rows.length > 0 ? rowToEntity(rows[0]) : null;
  }

  async findByApiKeyHash(apiKeyHash: string): Promise<AgentIdentity | null> {
    const rows = await this.db
      .select()
      .from(agentIdentities)
      .where(eq(agentIdentities.apiKeyHash, apiKeyHash))
      .limit(1);
    return rows.length > 0 ? rowToEntity(rows[0]) : null;
  }

  async findByWorkspace(workspaceId: string): Promise<AgentIdentity[]> {
    const rows = await this.db
      .select()
      .from(agentIdentities)
      .where(eq(agentIdentities.workspaceId, workspaceId));
    return rows.map(rowToEntity);
  }

  async create(identity: Omit<AgentIdentity, "id" | "createdAt">): Promise<AgentIdentity> {
    const now = new Date();
    const id = randomUUID();
    await this.db.insert(agentIdentities).values({
      id,
      workspaceId: identity.workspaceId,
      name: identity.name,
      role: identity.role,
      apiKeyHash: identity.apiKeyHash,
      createdAt: now,
    });
    return { ...identity, id, createdAt: now };
  }

  async update(
    id: string,
    data: Partial<Pick<AgentIdentity, "name" | "role" | "apiKeyHash">>,
  ): Promise<AgentIdentity> {
    await this.db.update(agentIdentities).set(data).where(eq(agentIdentities.id, id));
    const updated = await this.findById(id);
    if (!updated) {
      throw new Error(`AgentIdentity not found: ${id}`);
    }
    return updated;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(agentIdentities).where(eq(agentIdentities.id, id));
  }
}
