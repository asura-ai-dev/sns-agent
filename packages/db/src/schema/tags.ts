import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { followers } from "./followers.js";
import { socialAccounts } from "./social-accounts.js";
import { workspaces } from "./workspaces.js";

export const tags = sqliteTable(
  "tags",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    socialAccountId: text("social_account_id")
      .notNull()
      .references(() => socialAccounts.id),
    name: text("name").notNull(),
    color: text("color"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("idx_tags_account_name").on(table.socialAccountId, table.name),
    index("idx_tags_workspace_account").on(table.workspaceId, table.socialAccountId),
  ],
);

export const followerTags = sqliteTable(
  "follower_tags",
  {
    followerId: text("follower_id")
      .notNull()
      .references(() => followers.id),
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.followerId, table.tagId] }),
    index("idx_follower_tags_tag").on(table.tagId),
  ],
);
