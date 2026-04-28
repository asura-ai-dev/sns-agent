import { describe, it, expect, afterEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../src/schema/index.js";
import { DrizzleLlmProviderCredentialRepository } from "../src/repositories/llm-provider-credential-repository.js";

function createDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(`
    CREATE TABLE workspaces (
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    );
    CREATE TABLE llm_provider_credentials (
      id text PRIMARY KEY NOT NULL,
      workspace_id text NOT NULL,
      provider text NOT NULL,
      status text DEFAULT 'connected' NOT NULL,
      access_token_encrypted text NOT NULL,
      refresh_token_encrypted text,
      expires_at integer,
      scopes text,
      subject text,
      metadata text,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    );
    CREATE UNIQUE INDEX idx_llm_provider_credentials_workspace_provider
      ON llm_provider_credentials (workspace_id, provider);
  `);
  const now = Math.floor(Date.now() / 1000);
  sqlite
    .prepare("INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)")
    .run("ws1", "Workspace", now, now);
  return {
    sqlite,
    repo: new DrizzleLlmProviderCredentialRepository(drizzle(sqlite, { schema })),
  };
}

let dbs: Database.Database[] = [];

afterEach(() => {
  for (const db of dbs) db.close();
  dbs = [];
});

describe("DrizzleLlmProviderCredentialRepository", () => {
  it("upserts and retrieves encrypted provider credentials by workspace/provider", async () => {
    const { sqlite, repo } = createDb();
    dbs.push(sqlite);

    const created = await repo.upsert({
      workspaceId: "ws1",
      provider: "openai-codex",
      status: "connected",
      accessTokenEncrypted: "encrypted-access",
      refreshTokenEncrypted: "encrypted-refresh",
      expiresAt: new Date("2026-04-21T00:00:00Z"),
      scopes: ["codex"],
      subject: "user@example.com",
      metadata: { source: "test" },
    });

    expect(created.id).toBeTruthy();
    const found = await repo.findByWorkspaceAndProvider("ws1", "openai-codex");
    expect(found).toMatchObject({
      workspaceId: "ws1",
      provider: "openai-codex",
      status: "connected",
      accessTokenEncrypted: "encrypted-access",
      refreshTokenEncrypted: "encrypted-refresh",
      scopes: ["codex"],
      subject: "user@example.com",
      metadata: { source: "test" },
    });

    const updated = await repo.upsert({
      workspaceId: "ws1",
      provider: "openai-codex",
      status: "reauth_required",
      accessTokenEncrypted: "encrypted-access-2",
      refreshTokenEncrypted: null,
      expiresAt: null,
      scopes: null,
      subject: null,
      metadata: null,
    });

    expect(updated.id).toBe(created.id);
    expect((await repo.findByWorkspaceAndProvider("ws1", "openai-codex"))?.status).toBe(
      "reauth_required",
    );
  });

  it("deletes credentials by workspace/provider", async () => {
    const { sqlite, repo } = createDb();
    dbs.push(sqlite);

    await repo.upsert({
      workspaceId: "ws1",
      provider: "openai-codex",
      status: "connected",
      accessTokenEncrypted: "encrypted-access",
      refreshTokenEncrypted: null,
      expiresAt: null,
      scopes: null,
      subject: null,
      metadata: null,
    });

    await repo.deleteByWorkspaceAndProvider("ws1", "openai-codex");

    expect(await repo.findByWorkspaceAndProvider("ws1", "openai-codex")).toBeNull();
  });
});
