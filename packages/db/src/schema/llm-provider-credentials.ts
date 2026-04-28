import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { workspaces } from "./workspaces.js";

export const llmProviderCredentials = sqliteTable(
  "llm_provider_credentials",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    provider: text("provider", {
      enum: ["openai-codex"],
    }).notNull(),
    status: text("status", {
      enum: ["connected", "expired", "reauth_required"],
    })
      .notNull()
      .default("connected"),
    // Secrets must be encrypted before reaching this table. Phase A stores only
    // encrypted token material and does not implement OAuth token exchange.
    accessTokenEncrypted: text("access_token_encrypted").notNull(),
    refreshTokenEncrypted: text("refresh_token_encrypted"),
    expiresAt: integer("expires_at", { mode: "timestamp" }),
    scopes: text("scopes", { mode: "json" }),
    subject: text("subject"),
    metadata: text("metadata", { mode: "json" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("idx_llm_provider_credentials_workspace_provider").on(
      table.workspaceId,
      table.provider,
    ),
    index("idx_llm_provider_credentials_workspace_status").on(table.workspaceId, table.status),
  ],
);
