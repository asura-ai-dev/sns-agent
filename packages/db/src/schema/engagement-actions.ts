import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { workspaces } from "./workspaces.js";
import { socialAccounts } from "./social-accounts.js";
import { conversationThreads } from "./conversation-threads.js";
import { messages } from "./messages.js";

export const engagementActions = sqliteTable(
  "engagement_actions",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    socialAccountId: text("social_account_id")
      .notNull()
      .references(() => socialAccounts.id),
    threadId: text("thread_id")
      .notNull()
      .references(() => conversationThreads.id),
    messageId: text("message_id").references(() => messages.id),
    actionType: text("action_type", { enum: ["like", "repost"] }).notNull(),
    targetPostId: text("target_post_id").notNull(),
    actorId: text("actor_id").notNull(),
    externalActionId: text("external_action_id"),
    status: text("status", { enum: ["applied"] }).notNull(),
    metadata: text("metadata", { mode: "json" }),
    performedAt: integer("performed_at", { mode: "timestamp" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("idx_engagement_actions_dedupe").on(
      table.workspaceId,
      table.socialAccountId,
      table.actionType,
      table.targetPostId,
    ),
    index("idx_engagement_actions_thread").on(table.threadId),
  ],
);
