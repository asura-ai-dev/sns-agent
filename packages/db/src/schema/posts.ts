import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { workspaces } from "./workspaces.js";
import { socialAccounts } from "./social-accounts.js";

export const posts = sqliteTable(
  "posts",
  {
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
    status: text("status", {
      enum: ["draft", "scheduled", "publishing", "published", "failed", "deleted"],
    }).notNull(),
    contentText: text("content_text"),
    contentMedia: text("content_media", { mode: "json" }),
    platformPostId: text("platform_post_id"),
    validationResult: text("validation_result", { mode: "json" }),
    idempotencyKey: text("idempotency_key").unique(),
    createdBy: text("created_by"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
    publishedAt: integer("published_at", { mode: "timestamp" }),
  },
  (table) => [
    index("idx_posts_workspace_status").on(table.workspaceId, table.status),
    index("idx_posts_workspace_platform_created").on(
      table.workspaceId,
      table.platform,
      table.createdAt,
    ),
  ],
);
