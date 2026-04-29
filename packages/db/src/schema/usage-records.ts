import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";
import { workspaces } from "./workspaces.js";

export const usageRecords = sqliteTable(
  "usage_records",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    platform: text("platform").notNull(),
    endpoint: text("endpoint").notNull(),
    gateId: text("gate_id"),
    feature: text("feature"),
    metadata: text("metadata", { mode: "json" }),
    actorId: text("actor_id"),
    actorType: text("actor_type", {
      enum: ["user", "agent"],
    }).notNull(),
    requestCount: integer("request_count").notNull().default(1),
    success: integer("success", { mode: "boolean" }).notNull(),
    estimatedCostUsd: real("estimated_cost_usd"),
    recordedAt: integer("recorded_at", { mode: "timestamp" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("idx_usage_records_workspace_platform_recorded").on(
      table.workspaceId,
      table.platform,
      table.recordedAt,
    ),
    index("idx_usage_records_workspace_endpoint_recorded").on(
      table.workspaceId,
      table.endpoint,
      table.recordedAt,
    ),
    index("idx_usage_records_workspace_gate_recorded").on(
      table.workspaceId,
      table.gateId,
      table.recordedAt,
    ),
  ],
);
