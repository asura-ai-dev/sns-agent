import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { workspaces } from "./workspaces.js";

export const socialAccounts = sqliteTable("social_accounts", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  platform: text("platform", {
    enum: ["x", "line", "instagram"],
  }).notNull(),
  displayName: text("display_name").notNull(),
  externalAccountId: text("external_account_id").notNull(),
  credentialsEncrypted: text("credentials_encrypted").notNull(),
  tokenExpiresAt: integer("token_expires_at", { mode: "timestamp" }),
  status: text("status", {
    enum: ["active", "expired", "revoked", "error"],
  })
    .notNull()
    .default("active"),
  capabilities: text("capabilities", { mode: "json" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});
