import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { workspaces } from "./workspaces.js";
import { socialAccounts } from "./social-accounts.js";

export const conversationThreads = sqliteTable("conversation_threads", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  socialAccountId: text("social_account_id")
    .notNull()
    .references(() => socialAccounts.id),
  platform: text("platform", {
    enum: ["x", "line", "instagram"],
  }).notNull(),
  externalThreadId: text("external_thread_id"),
  participantName: text("participant_name"),
  participantExternalId: text("participant_external_id"),
  channel: text("channel", {
    enum: ["direct", "public"],
  }),
  initiatedBy: text("initiated_by", {
    enum: ["self", "external", "mixed", "unknown"],
  }),
  lastMessageAt: integer("last_message_at", { mode: "timestamp" }),
  providerMetadata: text("provider_metadata", { mode: "json" }),
  status: text("status", {
    enum: ["open", "closed", "archived"],
  })
    .notNull()
    .default("open"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});
