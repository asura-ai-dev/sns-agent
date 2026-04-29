import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { workspaces } from "./workspaces.js";
import { socialAccounts } from "./social-accounts.js";

export const stepSequences = sqliteTable(
  "step_sequences",
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
    stealthConfig: text("stealth_config", { mode: "json" }),
    deliveryBackoffUntil: integer("delivery_backoff_until", { mode: "timestamp" }),
    createdBy: text("created_by"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("idx_step_sequences_workspace_account").on(table.workspaceId, table.socialAccountId),
    index("idx_step_sequences_status").on(table.status),
  ],
);

export const stepMessages = sqliteTable(
  "step_messages",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    sequenceId: text("sequence_id")
      .notNull()
      .references(() => stepSequences.id),
    stepIndex: integer("step_index").notNull(),
    delaySeconds: integer("delay_seconds").notNull(),
    actionType: text("action_type", { enum: ["mention_post", "dm"] }).notNull(),
    contentText: text("content_text").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [index("idx_step_messages_sequence_index").on(table.sequenceId, table.stepIndex)],
);

export const stepEnrollments = sqliteTable(
  "step_enrollments",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    sequenceId: text("sequence_id")
      .notNull()
      .references(() => stepSequences.id),
    socialAccountId: text("social_account_id")
      .notNull()
      .references(() => socialAccounts.id),
    externalUserId: text("external_user_id").notNull(),
    username: text("username"),
    externalThreadId: text("external_thread_id"),
    replyToMessageId: text("reply_to_message_id"),
    status: text("status", { enum: ["active", "cancelled", "completed"] })
      .notNull()
      .default("active"),
    currentStepIndex: integer("current_step_index").notNull().default(0),
    nextStepAt: integer("next_step_at", { mode: "timestamp" }),
    lastDeliveredAt: integer("last_delivered_at", { mode: "timestamp" }),
    completedAt: integer("completed_at", { mode: "timestamp" }),
    cancelledAt: integer("cancelled_at", { mode: "timestamp" }),
    metadata: text("metadata", { mode: "json" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("idx_step_enrollments_sequence").on(table.sequenceId),
    index("idx_step_enrollments_due").on(table.status, table.nextStepAt),
    index("idx_step_enrollments_account_delivered").on(
      table.socialAccountId,
      table.lastDeliveredAt,
    ),
  ],
);
