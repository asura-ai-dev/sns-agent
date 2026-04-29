import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { workspaces } from "./workspaces.js";
import { socialAccounts } from "./social-accounts.js";

export const followerSnapshots = sqliteTable(
  "follower_snapshots",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    socialAccountId: text("social_account_id")
      .notNull()
      .references(() => socialAccounts.id),
    platform: text("platform", { enum: ["x", "line", "instagram"] }).notNull(),
    snapshotDate: text("snapshot_date").notNull(),
    followerCount: integer("follower_count").notNull(),
    followingCount: integer("following_count").notNull(),
    capturedAt: integer("captured_at", { mode: "timestamp" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("idx_follower_snapshots_account_day").on(
      table.workspaceId,
      table.socialAccountId,
      table.snapshotDate,
    ),
    index("idx_follower_snapshots_workspace_account").on(table.workspaceId, table.socialAccountId),
    index("idx_follower_snapshots_date").on(table.workspaceId, table.snapshotDate),
  ],
);
