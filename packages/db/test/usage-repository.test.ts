import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../src/schema/index.js";
import { DrizzleUsageRepository } from "../src/repositories/usage-repository.js";

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
    CREATE TABLE usage_records (
      id text PRIMARY KEY NOT NULL,
      workspace_id text NOT NULL,
      platform text NOT NULL,
      endpoint text NOT NULL,
      gate_id text,
      feature text,
      metadata text,
      actor_id text,
      actor_type text NOT NULL,
      request_count integer DEFAULT 1 NOT NULL,
      success integer NOT NULL,
      estimated_cost_usd real,
      recorded_at integer NOT NULL,
      created_at integer NOT NULL,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    );
  `);
  const now = Math.floor(Date.now() / 1000);
  sqlite
    .prepare("INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)")
    .run("ws1", "Workspace", now, now);
  return {
    sqlite,
    repo: new DrizzleUsageRepository(drizzle(sqlite, { schema })),
  };
}

let dbs: Database.Database[] = [];

afterEach(() => {
  for (const db of dbs) db.close();
  dbs = [];
});

describe("DrizzleUsageRepository", () => {
  it("persists X usage dimension metadata", async () => {
    const { sqlite, repo } = createDb();
    dbs.push(sqlite);

    const usage = await repo.record({
      workspaceId: "ws1",
      platform: "x",
      endpoint: "engagement.gate.deliver",
      gateId: "gate-1",
      feature: "engagement_gate",
      metadata: { source: "reply-trigger" },
      actorId: null,
      actorType: "agent",
      requestCount: 1,
      success: true,
      estimatedCostUsd: 0.002,
      recordedAt: new Date("2026-04-29T00:00:00.000Z"),
    });

    expect(usage).toMatchObject({
      gateId: "gate-1",
      feature: "engagement_gate",
      metadata: { source: "reply-trigger" },
    });
    await expect(repo.findRecent("ws1", 1)).resolves.toEqual([
      expect.objectContaining({
        gateId: "gate-1",
        feature: "engagement_gate",
        metadata: { source: "reply-trigger" },
      }),
    ]);
  });

  it("aggregates usage by endpoint and gate dimensions", async () => {
    const { sqlite, repo } = createDb();
    dbs.push(sqlite);
    const recordedAt = new Date("2026-04-29T00:00:00.000Z");

    await repo.record({
      workspaceId: "ws1",
      platform: "x",
      endpoint: "inbox.reply",
      gateId: "gate-1",
      feature: "engagement_gate",
      metadata: null,
      actorId: null,
      actorType: "agent",
      requestCount: 2,
      success: true,
      estimatedCostUsd: 0.004,
      recordedAt,
    });
    await repo.record({
      workspaceId: "ws1",
      platform: "x",
      endpoint: "inbox.list",
      gateId: "gate-2",
      feature: "inbox_sync",
      metadata: null,
      actorId: null,
      actorType: "agent",
      requestCount: 1,
      success: false,
      estimatedCostUsd: 0.001,
      recordedAt,
    });

    await expect(
      repo.aggregate("ws1", {
        platform: "x",
        dimension: "endpoint",
        startDate: new Date("2026-04-28T00:00:00.000Z"),
        endDate: new Date("2026-04-30T00:00:00.000Z"),
      }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ endpoint: "inbox.reply", totalRequests: 2 }),
        expect.objectContaining({ endpoint: "inbox.list", failureCount: 1 }),
      ]),
    );

    await expect(
      repo.aggregate("ws1", {
        platform: "x",
        dimension: "gate",
        startDate: new Date("2026-04-28T00:00:00.000Z"),
        endDate: new Date("2026-04-30T00:00:00.000Z"),
      }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ gateId: "gate-1", totalRequests: 2 }),
        expect.objectContaining({ gateId: "gate-2", failureCount: 1 }),
      ]),
    );
  });
});
