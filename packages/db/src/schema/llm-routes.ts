import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { workspaces } from "./workspaces.js";

export const llmRoutes = sqliteTable("llm_routes", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  platform: text("platform"),
  action: text("action"),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  temperature: real("temperature"),
  maxTokens: integer("max_tokens"),
  fallbackProvider: text("fallback_provider"),
  fallbackModel: text("fallback_model"),
  priority: integer("priority").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});
