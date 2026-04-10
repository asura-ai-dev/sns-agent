/**
 * Seed スクリプト
 *
 * Task 2001: 開発用の初期データを作成する。
 * - デフォルトワークスペース
 * - owner ユーザー
 * - agent identity（API キー付き）
 *
 * 使用方法: npx tsx packages/db/src/seed.ts
 */
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "./client.js";
import { workspaces } from "./schema/workspaces.js";
import { users } from "./schema/users.js";
import { agentIdentities } from "./schema/agent-identities.js";

/**
 * API キーを SHA-256 でハッシュ化する。
 */
function hashApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

async function seed() {
  const databaseUrl = process.env.DATABASE_URL ?? "file:./dev.db";
  const db = getDb(databaseUrl);
  const now = new Date();

  // --- デフォルトワークスペース ---
  const workspaceId = "ws-default-00000000";
  const existingWs = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);

  if (existingWs.length === 0) {
    await db.insert(workspaces).values({
      id: workspaceId,
      name: "Default Workspace",
      createdAt: now,
      updatedAt: now,
    });
    console.log("Created default workspace:", workspaceId);
  } else {
    console.log("Default workspace already exists:", workspaceId);
  }

  // --- Owner ユーザー ---
  const ownerId = "user-owner-00000000";
  const existingUser = await db.select().from(users).where(eq(users.id, ownerId)).limit(1);

  if (existingUser.length === 0) {
    await db.insert(users).values({
      id: ownerId,
      workspaceId,
      email: "owner@example.com",
      name: "Default Owner",
      role: "owner",
      createdAt: now,
    });
    console.log("Created owner user:", ownerId);
  } else {
    console.log("Owner user already exists:", ownerId);
  }

  // --- Agent Identity ---
  const agentId = "agent-default-00000000";
  const agentApiKey = "sns-agent-dev-key-00000000";
  const agentApiKeyHash = hashApiKey(agentApiKey);

  const existingAgent = await db
    .select()
    .from(agentIdentities)
    .where(eq(agentIdentities.id, agentId))
    .limit(1);

  if (existingAgent.length === 0) {
    await db.insert(agentIdentities).values({
      id: agentId,
      workspaceId,
      name: "Default Agent",
      role: "agent",
      apiKeyHash: agentApiKeyHash,
      createdAt: now,
    });
    console.log("Created agent identity:", agentId);
    console.log("Agent API key (save this!):", agentApiKey);
  } else {
    console.log("Agent identity already exists:", agentId);
  }

  console.log("\nSeed completed successfully.");
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
