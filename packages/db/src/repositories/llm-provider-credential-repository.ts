import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type {
  LlmProviderCredential,
  LlmProviderCredentialProvider,
  LlmProviderCredentialRepository,
} from "@sns-agent/core";
import { llmProviderCredentials } from "../schema/llm-provider-credentials.js";
import type { DbClient } from "../client.js";

function rowToEntity(row: typeof llmProviderCredentials.$inferSelect): LlmProviderCredential {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    provider: row.provider as LlmProviderCredentialProvider,
    status: row.status,
    accessTokenEncrypted: row.accessTokenEncrypted,
    refreshTokenEncrypted: row.refreshTokenEncrypted,
    expiresAt: row.expiresAt,
    scopes: (row.scopes as string[] | null) ?? null,
    subject: row.subject,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class DrizzleLlmProviderCredentialRepository implements LlmProviderCredentialRepository {
  constructor(private readonly db: DbClient) {}

  async findByWorkspaceAndProvider(
    workspaceId: string,
    provider: LlmProviderCredentialProvider,
  ): Promise<LlmProviderCredential | null> {
    const rows = await this.db
      .select()
      .from(llmProviderCredentials)
      .where(
        and(
          eq(llmProviderCredentials.workspaceId, workspaceId),
          eq(llmProviderCredentials.provider, provider),
        ),
      )
      .limit(1);
    return rows.length > 0 ? rowToEntity(rows[0]) : null;
  }

  async upsert(
    credential: Omit<LlmProviderCredential, "id" | "createdAt" | "updatedAt">,
  ): Promise<LlmProviderCredential> {
    const now = new Date();
    const existing = await this.findByWorkspaceAndProvider(
      credential.workspaceId,
      credential.provider,
    );

    if (existing) {
      await this.db
        .update(llmProviderCredentials)
        .set({
          status: credential.status,
          accessTokenEncrypted: credential.accessTokenEncrypted,
          refreshTokenEncrypted: credential.refreshTokenEncrypted,
          expiresAt: credential.expiresAt,
          scopes: credential.scopes,
          subject: credential.subject,
          metadata: credential.metadata,
          updatedAt: now,
        })
        .where(eq(llmProviderCredentials.id, existing.id));

      return {
        ...existing,
        ...credential,
        updatedAt: now,
      };
    }

    const id = randomUUID();
    await this.db.insert(llmProviderCredentials).values({
      id,
      workspaceId: credential.workspaceId,
      provider: credential.provider,
      status: credential.status,
      accessTokenEncrypted: credential.accessTokenEncrypted,
      refreshTokenEncrypted: credential.refreshTokenEncrypted,
      expiresAt: credential.expiresAt,
      scopes: credential.scopes,
      subject: credential.subject,
      metadata: credential.metadata,
      createdAt: now,
      updatedAt: now,
    });

    return { ...credential, id, createdAt: now, updatedAt: now };
  }

  async deleteByWorkspaceAndProvider(
    workspaceId: string,
    provider: LlmProviderCredentialProvider,
  ): Promise<void> {
    await this.db
      .delete(llmProviderCredentials)
      .where(
        and(
          eq(llmProviderCredentials.workspaceId, workspaceId),
          eq(llmProviderCredentials.provider, provider),
        ),
      );
  }
}
