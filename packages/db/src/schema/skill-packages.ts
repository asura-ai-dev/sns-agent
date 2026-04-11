import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { workspaces } from "./workspaces.js";

export const skillPackages = sqliteTable("skill_packages", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  name: text("name").notNull(),
  version: text("version").notNull(),
  platform: text("platform").notNull(),
  llmProvider: text("llm_provider").notNull(),
  manifest: text("manifest", { mode: "json" }).notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});
