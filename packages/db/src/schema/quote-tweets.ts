import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { workspaces } from "./workspaces.js";
import { socialAccounts } from "./social-accounts.js";

export const quoteTweets = sqliteTable(
  "quote_tweets",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    socialAccountId: text("social_account_id")
      .notNull()
      .references(() => socialAccounts.id),
    sourceTweetId: text("source_tweet_id").notNull(),
    quoteTweetId: text("quote_tweet_id").notNull(),
    authorExternalId: text("author_external_id").notNull(),
    authorUsername: text("author_username"),
    authorDisplayName: text("author_display_name"),
    authorProfileImageUrl: text("author_profile_image_url"),
    authorVerified: integer("author_verified", { mode: "boolean" }).notNull().default(false),
    contentText: text("content_text"),
    contentMedia: text("content_media", { mode: "json" }),
    quotedAt: integer("quoted_at", { mode: "timestamp" }),
    metrics: text("metrics", { mode: "json" }),
    providerMetadata: text("provider_metadata", { mode: "json" }),
    lastActionType: text("last_action_type", { enum: ["reply", "like", "repost"] }),
    lastActionExternalId: text("last_action_external_id"),
    lastActionAt: integer("last_action_at", { mode: "timestamp" }),
    discoveredAt: integer("discovered_at", { mode: "timestamp" }).notNull(),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("idx_quote_tweets_source_quote").on(
      table.workspaceId,
      table.socialAccountId,
      table.sourceTweetId,
      table.quoteTweetId,
    ),
    index("idx_quote_tweets_workspace_account").on(table.workspaceId, table.socialAccountId),
    index("idx_quote_tweets_source").on(table.workspaceId, table.sourceTweetId),
  ],
);
