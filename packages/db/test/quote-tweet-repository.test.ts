import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../src/schema/index.js";
import { DrizzleQuoteTweetRepository } from "../src/repositories/quote-tweet-repository.js";

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
    CREATE TABLE quote_tweets (
      id text PRIMARY KEY NOT NULL,
      workspace_id text NOT NULL,
      social_account_id text NOT NULL,
      source_tweet_id text NOT NULL,
      quote_tweet_id text NOT NULL,
      author_external_id text NOT NULL,
      author_username text,
      author_display_name text,
      author_profile_image_url text,
      author_verified integer DEFAULT false NOT NULL,
      content_text text,
      content_media text,
      quoted_at integer,
      metrics text,
      provider_metadata text,
      last_action_type text,
      last_action_external_id text,
      last_action_at integer,
      discovered_at integer NOT NULL,
      last_seen_at integer NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
      FOREIGN KEY (social_account_id) REFERENCES social_accounts(id)
    );
    CREATE UNIQUE INDEX idx_quote_tweets_source_quote
      ON quote_tweets (workspace_id, social_account_id, source_tweet_id, quote_tweet_id);
    CREATE INDEX idx_quote_tweets_workspace_account
      ON quote_tweets (workspace_id, social_account_id);
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
    repo: new DrizzleQuoteTweetRepository(drizzle(sqlite, { schema })),
  };
}

let dbs: Database.Database[] = [];

afterEach(() => {
  for (const db of dbs) db.close();
  dbs = [];
});

describe("DrizzleQuoteTweetRepository", () => {
  it("upserts one quote per source tweet and quote id while preserving UI author fields", async () => {
    const { sqlite, repo } = createDb();
    dbs.push(sqlite);

    const first = await repo.upsert({
      workspaceId: "ws1",
      socialAccountId: "acc1",
      sourceTweetId: "source-1",
      quoteTweetId: "quote-1",
      authorExternalId: "user-1",
      authorUsername: "alice",
      authorDisplayName: "Alice",
      authorProfileImageUrl: "https://cdn.example.test/alice.jpg",
      authorVerified: false,
      contentText: "quoting the launch",
      contentMedia: null,
      quotedAt: new Date("2026-04-29T00:00:00Z"),
      metrics: { like_count: 1 },
      providerMetadata: { referenced: ["source-1"] },
      discoveredAt: new Date("2026-04-29T00:01:00Z"),
      lastSeenAt: new Date("2026-04-29T00:01:00Z"),
    });
    const second = await repo.upsert({
      workspaceId: "ws1",
      socialAccountId: "acc1",
      sourceTweetId: "source-1",
      quoteTweetId: "quote-1",
      authorExternalId: "user-1",
      authorUsername: "alice_new",
      authorDisplayName: "Alice A.",
      authorProfileImageUrl: "https://cdn.example.test/alice-new.jpg",
      authorVerified: true,
      contentText: "updated quote text",
      contentMedia: [
        { type: "image", url: "https://cdn.example.test/q.jpg", mimeType: "image/jpeg" },
      ],
      quotedAt: new Date("2026-04-29T00:00:00Z"),
      metrics: { like_count: 2 },
      providerMetadata: { referenced: ["source-1"], lang: "en" },
      discoveredAt: new Date("2026-04-29T00:02:00Z"),
      lastSeenAt: new Date("2026-04-29T00:02:00Z"),
    });

    expect(second.id).toBe(first.id);
    expect(await repo.findBySourceAndQuote("ws1", "acc1", "source-1", "quote-1")).toMatchObject({
      id: first.id,
      authorUsername: "alice_new",
      authorDisplayName: "Alice A.",
      authorProfileImageUrl: "https://cdn.example.test/alice-new.jpg",
      authorVerified: true,
      contentText: "updated quote text",
      contentMedia: [
        { type: "image", url: "https://cdn.example.test/q.jpg", mimeType: "image/jpeg" },
      ],
      metrics: { like_count: 2 },
    });
    expect(await repo.findByWorkspace("ws1", { socialAccountId: "acc1" })).toHaveLength(1);
  });

  it("records the latest reply like or repost action for the quote", async () => {
    const { sqlite, repo } = createDb();
    dbs.push(sqlite);

    const quote = await repo.upsert({
      workspaceId: "ws1",
      socialAccountId: "acc1",
      sourceTweetId: "source-1",
      quoteTweetId: "quote-1",
      authorExternalId: "user-1",
      authorUsername: "alice",
      authorDisplayName: "Alice",
      authorProfileImageUrl: null,
      authorVerified: false,
      contentText: null,
      contentMedia: null,
      quotedAt: null,
      metrics: null,
      providerMetadata: null,
      discoveredAt: new Date("2026-04-29T00:01:00Z"),
      lastSeenAt: new Date("2026-04-29T00:01:00Z"),
    });

    const acted = await repo.recordAction(quote.id, {
      actionType: "like",
      externalActionId: "brand:like:quote-1",
      actedAt: new Date("2026-04-29T00:03:00Z"),
    });

    expect(acted).toMatchObject({
      id: quote.id,
      lastActionType: "like",
      lastActionExternalId: "brand:like:quote-1",
    });
    expect(acted.lastActionAt?.toISOString()).toBe("2026-04-29T00:03:00.000Z");
  });
});
