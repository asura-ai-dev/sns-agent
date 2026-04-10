import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { workspaces } from "./workspaces.js";

export const budgetPolicies = sqliteTable("budget_policies", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  scopeType: text("scope_type", {
    enum: ["workspace", "platform", "endpoint"],
  }).notNull(),
  scopeValue: text("scope_value"),
  period: text("period", {
    enum: ["daily", "weekly", "monthly"],
  }).notNull(),
  limitAmountUsd: real("limit_amount_usd").notNull(),
  actionOnExceed: text("action_on_exceed", {
    enum: ["warn", "require-approval", "block"],
  })
    .notNull()
    .default("warn"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});
