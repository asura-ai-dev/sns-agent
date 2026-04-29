import { index, sqliteTable, text, uniqueIndex, integer } from "drizzle-orm/sqlite-core";
import { workspaces } from "./workspaces.js";
import { socialAccounts } from "./social-accounts.js";

export const engagementGates = sqliteTable(
  "engagement_gates",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    socialAccountId: text("social_account_id")
      .notNull()
      .references(() => socialAccounts.id),
    platform: text("platform", { enum: ["x", "line", "instagram"] }).notNull(),
    name: text("name").notNull(),
    status: text("status", { enum: ["active", "paused"] })
      .notNull()
      .default("active"),
    triggerType: text("trigger_type", { enum: ["reply"] })
      .notNull()
      .default("reply"),
    triggerPostId: text("trigger_post_id"),
    conditions: text("conditions", { mode: "json" }),
    actionType: text("action_type", { enum: ["mention_post", "dm", "verify_only"] }).notNull(),
    actionText: text("action_text"),
    lineHarnessUrl: text("line_harness_url"),
    lineHarnessApiKeyRef: text("line_harness_api_key_ref"),
    lineHarnessTag: text("line_harness_tag"),
    lineHarnessScenario: text("line_harness_scenario"),
    stealthConfig: text("stealth_config", { mode: "json" }),
    deliveryBackoffUntil: integer("delivery_backoff_until", { mode: "timestamp" }),
    lastReplySinceId: text("last_reply_since_id"),
    createdBy: text("created_by"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("idx_engagement_gates_workspace_account").on(table.workspaceId, table.socialAccountId),
    index("idx_engagement_gates_status_trigger").on(table.status, table.triggerType),
  ],
);

export const engagementGateDeliveries = sqliteTable(
  "engagement_gate_deliveries",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    engagementGateId: text("engagement_gate_id")
      .notNull()
      .references(() => engagementGates.id),
    socialAccountId: text("social_account_id")
      .notNull()
      .references(() => socialAccounts.id),
    externalUserId: text("external_user_id").notNull(),
    externalReplyId: text("external_reply_id"),
    actionType: text("action_type", { enum: ["mention_post", "dm", "verify_only"] }).notNull(),
    status: text("status", { enum: ["delivered", "verified"] }).notNull(),
    responseExternalId: text("response_external_id"),
    deliveryToken: text("delivery_token").notNull(),
    consumedAt: integer("consumed_at", { mode: "timestamp" }),
    metadata: text("metadata", { mode: "json" }),
    deliveredAt: integer("delivered_at", { mode: "timestamp" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("idx_engagement_gate_deliveries_gate_user").on(
      table.engagementGateId,
      table.externalUserId,
    ),
    uniqueIndex("idx_engagement_gate_deliveries_token").on(table.deliveryToken),
    index("idx_engagement_gate_deliveries_gate").on(table.engagementGateId),
  ],
);
