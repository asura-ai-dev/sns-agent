import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { workspaces } from "./workspaces.js";

export const approvalRequests = sqliteTable("approval_requests", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  resourceType: text("resource_type").notNull(),
  resourceId: text("resource_id").notNull(),
  requestedBy: text("requested_by").notNull(),
  requestedAt: integer("requested_at", { mode: "timestamp" }).notNull(),
  status: text("status", {
    enum: ["pending", "approved", "rejected", "expired"],
  })
    .notNull()
    .default("pending"),
  reviewedBy: text("reviewed_by"),
  reviewedAt: integer("reviewed_at", { mode: "timestamp" }),
  reason: text("reason"),
});
