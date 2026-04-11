import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { workspaces } from "./workspaces.js";

export const agentIdentities = sqliteTable("agent_identities", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  name: text("name").notNull(),
  role: text("role", {
    enum: ["viewer", "operator", "editor", "admin", "owner", "agent"],
  }).notNull(),
  apiKeyHash: text("api_key_hash").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});
