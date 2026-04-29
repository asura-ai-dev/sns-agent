import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../src/schema/index.js";
import { DrizzleFollowerRepository } from "../src/repositories/follower-repository.js";

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
    CREATE TABLE followers (
      id text PRIMARY KEY NOT NULL,
      workspace_id text NOT NULL,
      social_account_id text NOT NULL,
      platform text NOT NULL,
      external_user_id text NOT NULL,
      display_name text,
      username text,
      is_following integer DEFAULT false NOT NULL,
      is_followed integer DEFAULT false NOT NULL,
      unfollowed_at integer,
      metadata text,
      last_seen_at integer NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
      FOREIGN KEY (social_account_id) REFERENCES social_accounts(id)
    );
    CREATE UNIQUE INDEX idx_followers_account_external_user
      ON followers (social_account_id, external_user_id);
    CREATE INDEX idx_followers_workspace_account
      ON followers (workspace_id, social_account_id);
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
    repo: new DrizzleFollowerRepository(drizzle(sqlite, { schema })),
  };
}

let dbs: Database.Database[] = [];

afterEach(() => {
  for (const db of dbs) db.close();
  dbs = [];
});

describe("DrizzleFollowerRepository", () => {
  it("upserts one row per account and external X user", async () => {
    const { sqlite, repo } = createDb();
    dbs.push(sqlite);

    const first = await repo.upsert({
      workspaceId: "ws1",
      socialAccountId: "acc1",
      platform: "x",
      externalUserId: "x-user-1",
      displayName: "Alice",
      username: "alice",
      isFollowed: true,
      isFollowing: false,
      unfollowedAt: null,
      metadata: { verified: false },
      lastSeenAt: new Date("2026-04-28T00:00:00Z"),
    });
    const second = await repo.upsert({
      workspaceId: "ws1",
      socialAccountId: "acc1",
      platform: "x",
      externalUserId: "x-user-1",
      displayName: "Alice A.",
      username: "alice_a",
      isFollowed: true,
      isFollowing: true,
      unfollowedAt: null,
      metadata: { verified: true },
      lastSeenAt: new Date("2026-04-28T01:00:00Z"),
    });

    expect(second.id).toBe(first.id);
    expect(await repo.findByAccountAndExternalUser("acc1", "x-user-1")).toMatchObject({
      displayName: "Alice A.",
      username: "alice_a",
      isFollowed: true,
      isFollowing: true,
      metadata: { verified: true },
    });
    expect(await repo.findByWorkspace("ws1", { socialAccountId: "acc1" })).toHaveLength(1);
  });

  it("marks missing current followers as unfollowed without deleting rows", async () => {
    const { sqlite, repo } = createDb();
    dbs.push(sqlite);

    await repo.upsert({
      workspaceId: "ws1",
      socialAccountId: "acc1",
      platform: "x",
      externalUserId: "stayed",
      displayName: "Stayed",
      username: "stayed",
      isFollowed: true,
      isFollowing: false,
      unfollowedAt: null,
      metadata: null,
      lastSeenAt: new Date("2026-04-28T00:00:00Z"),
    });
    await repo.upsert({
      workspaceId: "ws1",
      socialAccountId: "acc1",
      platform: "x",
      externalUserId: "left",
      displayName: "Left",
      username: "left",
      isFollowed: true,
      isFollowing: false,
      unfollowedAt: null,
      metadata: null,
      lastSeenAt: new Date("2026-04-28T00:00:00Z"),
    });

    await repo.markMissingFollowersUnfollowed({
      workspaceId: "ws1",
      socialAccountId: "acc1",
      currentExternalUserIds: ["stayed"],
      unfollowedAt: new Date("2026-04-28T02:00:00Z"),
    });

    const stayed = await repo.findByAccountAndExternalUser("acc1", "stayed");
    const left = await repo.findByAccountAndExternalUser("acc1", "left");
    expect(stayed?.isFollowed).toBe(true);
    expect(stayed?.unfollowedAt).toBeNull();
    expect(left).toMatchObject({
      isFollowed: false,
      isFollowing: false,
    });
    expect(left?.unfollowedAt?.toISOString()).toBe("2026-04-28T02:00:00.000Z");
  });
});
