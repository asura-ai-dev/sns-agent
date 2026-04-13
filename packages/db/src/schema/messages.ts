import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { conversationThreads } from "./conversation-threads.js";

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  threadId: text("thread_id")
    .notNull()
    .references(() => conversationThreads.id),
  direction: text("direction", {
    enum: ["inbound", "outbound"],
  }).notNull(),
  contentText: text("content_text"),
  contentMedia: text("content_media", { mode: "json" }),
  externalMessageId: text("external_message_id"),
  authorExternalId: text("author_external_id"),
  authorDisplayName: text("author_display_name"),
  sentAt: integer("sent_at", { mode: "timestamp" }),
  providerMetadata: text("provider_metadata", { mode: "json" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});
