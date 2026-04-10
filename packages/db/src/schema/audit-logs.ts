import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";
import { workspaces } from "./workspaces.js";

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    actorId: text("actor_id").notNull(),
    actorType: text("actor_type", {
      enum: ["user", "agent", "system"],
    }).notNull(),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id"),
    platform: text("platform"),
    socialAccountId: text("social_account_id"),
    inputSummary: text("input_summary", { mode: "json" }),
    resultSummary: text("result_summary", { mode: "json" }),
    estimatedCostUsd: real("estimated_cost_usd"),
    requestId: text("request_id"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("idx_audit_logs_workspace_created").on(table.workspaceId, table.createdAt),
    index("idx_audit_logs_actor_created").on(table.actorId, table.createdAt),
  ],
);
