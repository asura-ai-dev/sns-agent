import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { workspaces } from "./workspaces.js";
import { socialAccounts } from "./social-accounts.js";

export const followers = sqliteTable(
  "followers",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    socialAccountId: text("social_account_id")
      .notNull()
      .references(() => socialAccounts.id),
    platform: text("platform", { enum: ["x", "line", "instagram"] }).notNull(),
    externalUserId: text("external_user_id").notNull(),
    displayName: text("display_name"),
    username: text("username"),
    isFollowing: integer("is_following", { mode: "boolean" }).notNull().default(false),
    isFollowed: integer("is_followed", { mode: "boolean" }).notNull().default(false),
    unfollowedAt: integer("unfollowed_at", { mode: "timestamp" }),
    metadata: text("metadata", { mode: "json" }),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("idx_followers_account_external_user").on(
      table.socialAccountId,
      table.externalUserId,
    ),
    index("idx_followers_workspace_account").on(table.workspaceId, table.socialAccountId),
    index("idx_followers_workspace_username").on(table.workspaceId, table.username),
  ],
);
