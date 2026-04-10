/**
 * AccountRepository の Drizzle 実装
 * core/interfaces/repositories.ts の AccountRepository に準拠
 */
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { AccountRepository } from "@sns-agent/core";
import type { SocialAccount } from "@sns-agent/core";
import { socialAccounts } from "../schema/social-accounts.js";
import type { DbClient } from "../client.js";

function rowToEntity(row: typeof socialAccounts.$inferSelect): SocialAccount {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    platform: row.platform as SocialAccount["platform"],
    displayName: row.displayName,
    externalAccountId: row.externalAccountId,
    credentialsEncrypted: row.credentialsEncrypted,
    tokenExpiresAt: row.tokenExpiresAt,
    status: row.status as SocialAccount["status"],
    capabilities: row.capabilities as SocialAccount["capabilities"],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class DrizzleAccountRepository implements AccountRepository {
  constructor(private readonly db: DbClient) {}

  async findById(id: string): Promise<SocialAccount | null> {
    const rows = await this.db
      .select()
      .from(socialAccounts)
      .where(eq(socialAccounts.id, id))
      .limit(1);
    return rows.length > 0 ? rowToEntity(rows[0]) : null;
  }

  async findByWorkspace(workspaceId: string): Promise<SocialAccount[]> {
    const rows = await this.db
      .select()
      .from(socialAccounts)
      .where(eq(socialAccounts.workspaceId, workspaceId));
    return rows.map(rowToEntity);
  }

  async create(
    account: Omit<SocialAccount, "id" | "createdAt" | "updatedAt">,
  ): Promise<SocialAccount> {
    const now = new Date();
    const id = randomUUID();
    await this.db.insert(socialAccounts).values({
      id,
      workspaceId: account.workspaceId,
      platform: account.platform,
      displayName: account.displayName,
      externalAccountId: account.externalAccountId,
      credentialsEncrypted: account.credentialsEncrypted,
      tokenExpiresAt: account.tokenExpiresAt,
      status: account.status,
      capabilities: account.capabilities as Record<string, unknown> | null,
      createdAt: now,
      updatedAt: now,
    });
    return { ...account, id, createdAt: now, updatedAt: now };
  }

  async update(id: string, data: Partial<SocialAccount>): Promise<SocialAccount> {
    const now = new Date();
    const updateData: Record<string, unknown> = { ...data, updatedAt: now };
    delete updateData.id;
    delete updateData.createdAt;

    if (updateData.capabilities !== undefined) {
      updateData.capabilities = updateData.capabilities as unknown as Record<
        string,
        unknown
      > | null;
    }

    await this.db.update(socialAccounts).set(updateData).where(eq(socialAccounts.id, id));

    const updated = await this.findById(id);
    if (!updated) {
      throw new Error(`Account not found: ${id}`);
    }
    return updated;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(socialAccounts).where(eq(socialAccounts.id, id));
  }
}
