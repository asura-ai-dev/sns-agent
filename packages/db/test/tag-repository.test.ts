import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../src/schema/index.js";
import { DrizzleFollowerRepository } from "../src/repositories/follower-repository.js";
import { DrizzleTagRepository } from "../src/repositories/tag-repository.js";

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
    CREATE TABLE tags (
      id text PRIMARY KEY NOT NULL,
      workspace_id text NOT NULL,
      social_account_id text NOT NULL,
      name text NOT NULL,
      color text,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
      FOREIGN KEY (social_account_id) REFERENCES social_accounts(id)
    );
    CREATE UNIQUE INDEX idx_tags_account_name ON tags (social_account_id, name);
    CREATE TABLE follower_tags (
      follower_id text NOT NULL,
      tag_id text NOT NULL,
      created_at integer NOT NULL,
      PRIMARY KEY (follower_id, tag_id),
      FOREIGN KEY (follower_id) REFERENCES followers(id),
      FOREIGN KEY (tag_id) REFERENCES tags(id)
    );
    CREATE INDEX idx_follower_tags_tag ON follower_tags (tag_id);
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
  sqlite
    .prepare(
      "INSERT INTO social_accounts (id, workspace_id, platform, display_name, external_account_id, credentials_encrypted, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run("acc2", "ws1", "x", "Second Brand", "brand-x-2", "encrypted", "active", now, now);

  const db = drizzle(sqlite, { schema });
  return {
    sqlite,
    followerRepo: new DrizzleFollowerRepository(db),
    tagRepo: new DrizzleTagRepository(db),
  };
}

let dbs: Database.Database[] = [];

afterEach(() => {
  for (const db of dbs) db.close();
  dbs = [];
});

describe("DrizzleTagRepository", () => {
  it("keeps tag names unique per X account", async () => {
    const { sqlite, tagRepo } = createDb();
    dbs.push(sqlite);

    const first = await tagRepo.create({
      workspaceId: "ws1",
      socialAccountId: "acc1",
      name: "vip",
      color: "#eab308",
    });
    await tagRepo.create({
      workspaceId: "ws1",
      socialAccountId: "acc2",
      name: "vip",
      color: null,
    });

    expect(first).toMatchObject({
      workspaceId: "ws1",
      socialAccountId: "acc1",
      name: "vip",
      color: "#eab308",
    });
    await expect(
      tagRepo.create({
        workspaceId: "ws1",
        socialAccountId: "acc1",
        name: "vip",
        color: null,
      }),
    ).rejects.toThrow();
    await expect(tagRepo.findByWorkspace("ws1", { socialAccountId: "acc1" })).resolves.toHaveLength(
      1,
    );
  });

  it("attaches and detaches follower tags idempotently", async () => {
    const { sqlite, followerRepo, tagRepo } = createDb();
    dbs.push(sqlite);

    const follower = await followerRepo.upsert({
      workspaceId: "ws1",
      socialAccountId: "acc1",
      platform: "x",
      externalUserId: "x-user-1",
      displayName: "Alice",
      username: "alice",
      isFollowed: true,
      isFollowing: false,
      unfollowedAt: null,
      metadata: null,
      lastSeenAt: new Date("2026-04-28T00:00:00Z"),
    });
    const tag = await tagRepo.create({
      workspaceId: "ws1",
      socialAccountId: "acc1",
      name: "customer",
      color: null,
    });

    await tagRepo.attachToFollower({
      workspaceId: "ws1",
      socialAccountId: "acc1",
      followerId: follower.id,
      tagId: tag.id,
    });
    await tagRepo.attachToFollower({
      workspaceId: "ws1",
      socialAccountId: "acc1",
      followerId: follower.id,
      tagId: tag.id,
    });

    expect(await followerRepo.findByWorkspace("ws1", { tagId: tag.id })).toEqual([
      expect.objectContaining({ id: follower.id }),
    ]);

    await tagRepo.detachFromFollower({
      workspaceId: "ws1",
      socialAccountId: "acc1",
      followerId: follower.id,
      tagId: tag.id,
    });
    await tagRepo.detachFromFollower({
      workspaceId: "ws1",
      socialAccountId: "acc1",
      followerId: follower.id,
      tagId: tag.id,
    });

    await expect(followerRepo.findByWorkspace("ws1", { tagId: tag.id })).resolves.toEqual([]);
  });
});
