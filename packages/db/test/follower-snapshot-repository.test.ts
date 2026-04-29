import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../src/schema/index.js";
import { DrizzleFollowerSnapshotRepository } from "../src/repositories/follower-snapshot-repository.js";

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
    CREATE TABLE social_accounts (
      id text PRIMARY KEY NOT NULL,
      workspace_id text NOT NULL,
      platform text NOT NULL,
      display_name text NOT NULL,
      external_account_id text NOT NULL,
      credentials_encrypted text NOT NULL,
      token_expires_at integer,
      status text DEFAULT 'active' NOT NULL,
      capabilities text,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    );
    CREATE TABLE follower_snapshots (
      id text PRIMARY KEY NOT NULL,
      workspace_id text NOT NULL,
      social_account_id text NOT NULL,
      platform text NOT NULL,
      snapshot_date text NOT NULL,
      follower_count integer NOT NULL,
      following_count integer NOT NULL,
      captured_at integer NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
      FOREIGN KEY (social_account_id) REFERENCES social_accounts(id)
    );
    CREATE UNIQUE INDEX idx_follower_snapshots_account_day
      ON follower_snapshots (workspace_id, social_account_id, snapshot_date);
  `);
  const now = Math.floor(Date.now() / 1000);
  sqlite
    .prepare("INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)")
    .run("ws1", "Workspace", now, now);
  sqlite
    .prepare(
      "INSERT INTO social_accounts (id, workspace_id, platform, display_name, external_account_id, credentials_encrypted, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run("acc1", "ws1", "x", "Brand", "brand-x", "encrypted", "active", now, now);
  return {
    sqlite,
    repo: new DrizzleFollowerSnapshotRepository(drizzle(sqlite, { schema })),
  };
}

let dbs: Database.Database[] = [];

afterEach(() => {
  for (const db of dbs) db.close();
  dbs = [];
});

describe("DrizzleFollowerSnapshotRepository", () => {
  it("upserts one snapshot per account and day", async () => {
    const { sqlite, repo } = createDb();
    dbs.push(sqlite);

    const first = await repo.upsertDailySnapshot({
      workspaceId: "ws1",
      socialAccountId: "acc1",
      platform: "x",
      snapshotDate: "2026-04-29",
      followerCount: 10,
      followingCount: 3,
      capturedAt: new Date("2026-04-29T00:00:00Z"),
    });
    const second = await repo.upsertDailySnapshot({
      workspaceId: "ws1",
      socialAccountId: "acc1",
      platform: "x",
      snapshotDate: "2026-04-29",
      followerCount: 12,
      followingCount: 4,
      capturedAt: new Date("2026-04-29T12:00:00Z"),
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.snapshot.id).toBe(first.snapshot.id);
    expect(second.snapshot.followerCount).toBe(12);
    expect(await repo.findByAccount("ws1", "acc1")).toHaveLength(1);
  });
});
