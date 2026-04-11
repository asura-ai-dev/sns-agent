import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { workspaces } from "./workspaces.js";
import { posts } from "./posts.js";

export const scheduledJobs = sqliteTable(
  "scheduled_jobs",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    postId: text("post_id")
      .notNull()
      .references(() => posts.id),
    scheduledAt: integer("scheduled_at", { mode: "timestamp" }).notNull(),
    status: text("status", {
      enum: ["pending", "locked", "running", "succeeded", "failed", "retrying"],
    }).notNull(),
    lockedAt: integer("locked_at", { mode: "timestamp" }),
    startedAt: integer("started_at", { mode: "timestamp" }),
    completedAt: integer("completed_at", { mode: "timestamp" }),
    attemptCount: integer("attempt_count").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    lastError: text("last_error"),
    nextRetryAt: integer("next_retry_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [index("idx_scheduled_jobs_status_scheduled").on(table.status, table.scheduledAt)],
);
