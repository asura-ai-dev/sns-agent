import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { workspaces } from "./workspaces.js";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  email: text("email").notNull().unique(),
  name: text("name"),
  role: text("role", {
    enum: ["viewer", "operator", "editor", "admin", "owner"],
  }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});
