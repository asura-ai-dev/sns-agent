import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../src/schema/index.js";
import {
  DrizzleEngagementGateDeliveryRepository,
  DrizzleEngagementGateRepository,
} from "../src/repositories/engagement-gate-repository.js";

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
    CREATE TABLE engagement_gates (
      id text PRIMARY KEY NOT NULL,
      workspace_id text NOT NULL,
      social_account_id text NOT NULL,
      platform text NOT NULL,
      name text NOT NULL,
      status text DEFAULT 'active' NOT NULL,
      trigger_type text DEFAULT 'reply' NOT NULL,
      trigger_post_id text,
      conditions text,
      action_type text NOT NULL,
      action_text text,
      last_reply_since_id text,
      created_by text,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
      FOREIGN KEY (social_account_id) REFERENCES social_accounts(id)
    );
    CREATE INDEX idx_engagement_gates_workspace_account
      ON engagement_gates (workspace_id, social_account_id);
    CREATE INDEX idx_engagement_gates_status_trigger
      ON engagement_gates (status, trigger_type);
    CREATE TABLE engagement_gate_deliveries (
      id text PRIMARY KEY NOT NULL,
      workspace_id text NOT NULL,
      engagement_gate_id text NOT NULL,
      social_account_id text NOT NULL,
      external_user_id text NOT NULL,
      external_reply_id text,
      action_type text NOT NULL,
      status text NOT NULL,
      response_external_id text,
      metadata text,
      delivered_at integer NOT NULL,
      created_at integer NOT NULL,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
      FOREIGN KEY (engagement_gate_id) REFERENCES engagement_gates(id),
      FOREIGN KEY (social_account_id) REFERENCES social_accounts(id)
    );
    CREATE UNIQUE INDEX idx_engagement_gate_deliveries_gate_user
      ON engagement_gate_deliveries (engagement_gate_id, external_user_id);
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

  const db = drizzle(sqlite, { schema });
  return {
    sqlite,
    gateRepo: new DrizzleEngagementGateRepository(db),
    deliveryRepo: new DrizzleEngagementGateDeliveryRepository(db),
  };
}

let dbs: Database.Database[] = [];

afterEach(() => {
  for (const db of dbs) db.close();
  dbs = [];
});

describe("DrizzleEngagementGateRepository", () => {
  it("creates lists updates and deletes engagement gates", async () => {
    const { sqlite, gateRepo } = createDb();
    dbs.push(sqlite);

    const gate = await gateRepo.create({
      workspaceId: "ws1",
      socialAccountId: "acc1",
      platform: "x",
      name: "Launch reply gate",
      status: "active",
      triggerType: "reply",
      triggerPostId: "tweet-root-1",
      conditions: {
        requireLike: true,
        requireRepost: true,
        requireFollow: false,
      },
      actionType: "mention_post",
      actionText: "Thanks for joining!",
      lastReplySinceId: null,
      createdBy: "user-1",
    });

    expect(gate).toMatchObject({
      workspaceId: "ws1",
      socialAccountId: "acc1",
      platform: "x",
      name: "Launch reply gate",
      triggerType: "reply",
      triggerPostId: "tweet-root-1",
      conditions: {
        requireLike: true,
        requireRepost: true,
        requireFollow: false,
      },
      actionType: "mention_post",
      lastReplySinceId: null,
    });

    await gateRepo.update(gate.id, { status: "paused", lastReplySinceId: "tweet-10" });

    expect(await gateRepo.findById(gate.id)).toMatchObject({
      id: gate.id,
      status: "paused",
      lastReplySinceId: "tweet-10",
    });
    expect(await gateRepo.findByWorkspace("ws1", { socialAccountId: "acc1" })).toHaveLength(1);
    expect(await gateRepo.findActiveReplyTriggers(10)).toHaveLength(0);

    await gateRepo.delete(gate.id);
    expect(await gateRepo.findById(gate.id)).toBeNull();
  });

  it("records at most one delivery per gate and external user", async () => {
    const { sqlite, gateRepo, deliveryRepo } = createDb();
    dbs.push(sqlite);

    const gate = await gateRepo.create({
      workspaceId: "ws1",
      socialAccountId: "acc1",
      platform: "x",
      name: "DM gate",
      status: "active",
      triggerType: "reply",
      triggerPostId: "tweet-root-1",
      conditions: {
        requireLike: false,
        requireRepost: false,
        requireFollow: true,
      },
      actionType: "dm",
      actionText: "Here is the secret.",
      lastReplySinceId: null,
      createdBy: null,
    });

    const first = await deliveryRepo.createOnce({
      workspaceId: "ws1",
      engagementGateId: gate.id,
      socialAccountId: "acc1",
      externalUserId: "user-1",
      externalReplyId: "reply-1",
      actionType: "dm",
      status: "delivered",
      responseExternalId: "dm-1",
      metadata: { eligible: true },
      deliveredAt: new Date("2026-04-28T00:00:00Z"),
    });
    const second = await deliveryRepo.createOnce({
      workspaceId: "ws1",
      engagementGateId: gate.id,
      socialAccountId: "acc1",
      externalUserId: "user-1",
      externalReplyId: "reply-2",
      actionType: "dm",
      status: "delivered",
      responseExternalId: "dm-2",
      metadata: { eligible: true },
      deliveredAt: new Date("2026-04-28T01:00:00Z"),
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.delivery).toMatchObject({
      id: first.delivery.id,
      externalReplyId: "reply-1",
      responseExternalId: "dm-1",
    });
    expect(await deliveryRepo.findByGate(gate.id)).toHaveLength(1);
  });
});
