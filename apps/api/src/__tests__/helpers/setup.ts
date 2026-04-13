/**
 * API 統合テスト用セットアップヘルパー
 *
 * Task 6004: 各統合テストスイートで共有する DB/provider/actor のセットアップ。
 *
 * 設計方針:
 * - SQLite は in-memory（`file::memory:?cache=shared`）ではなく、スイート専用の
 *   テンポラリファイルを使用する。getDb のシングルトンと整合するため、
 *   テスト開始時に resetDb() して DATABASE_URL 相当のパスを指定する。
 * - 各テストスイートは describe ごとに createTestContext() を呼ぶ。
 * - ProviderRegistry はモック（成功応答）で差し替える。外部 HTTP は一切行わない。
 * - LLM / Skills も同様にモックを差し込む（必要になった時点で拡張）。
 */
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { resetDb } from "@sns-agent/db";
import * as schema from "@sns-agent/db";
import { ProviderRegistry, encrypt } from "@sns-agent/core";
import type {
  SocialProvider,
  ValidatePostInput,
  ValidationResult,
  PublishPostInput,
  PublishResult,
  DeletePostInput,
  DeleteResult,
  ConnectAccountInput,
  ConnectAccountResult,
  ProviderCapabilities,
  ListThreadsInput,
  ThreadListResult,
  GetMessagesInput,
  MessageListResult,
  SendReplyInput,
  SendReplyResult,
} from "@sns-agent/core";
import type { Platform } from "@sns-agent/config";
import { setProviderRegistry, resetProviderRegistry } from "../../providers.js";

const TEST_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const TEST_CREDS_PLAIN = '{"access_token":"test-token","refresh_token":"rt"}';

/** マイグレーション SQL のパス */
function getMigrationSql(): string {
  // apps/api/src/__tests__/helpers/setup.ts → ../../../../packages/db/src/migrations/0000_*.sql
  const here = dirname(fileURLToPath(import.meta.url));
  const migrationPath = resolve(
    here,
    "../../../../../packages/db/src/migrations/0000_cynical_dakota_north.sql",
  );
  return readFileSync(migrationPath, "utf8");
}

/** 個別テスト用 DB を作成 */
export function createTestDb(): {
  db: BetterSQLite3Database<typeof schema>;
  sqlite: Database.Database;
  dbPath: string;
  dbDir: string;
} {
  const dbDir = mkdtempSync(join(tmpdir(), "sns-agent-test-"));
  const dbPath = join(dbDir, "test.db");
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  // マイグレーション SQL を実行
  const sql = getMigrationSql();
  // drizzle の statement-breakpoint で分割
  const statements = sql
    .split(/-->\s*statement-breakpoint/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const stmt of statements) {
    sqlite.exec(stmt);
  }

  const db = drizzle(sqlite, { schema });
  return { db, sqlite, dbPath, dbDir };
}

/** DATABASE_URL を一時 DB に指定して getDb() をバインド */
export function bindDatabaseUrl(dbPath: string): void {
  process.env.DATABASE_URL = `file:${dbPath}`;
  process.env.ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
  resetDb();
}

/** モック SocialProvider（X 相当） */
export function createMockXProvider(): SocialProvider {
  return {
    platform: "x",
    getCapabilities(): ProviderCapabilities {
      return {
        textPost: true,
        imagePost: true,
        videoPost: true,
        threadPost: true,
        directMessage: true,
        commentReply: true,
        broadcast: false,
        nativeSchedule: false,
        usageApi: false,
      };
    },
    async connectAccount(input: ConnectAccountInput): Promise<ConnectAccountResult> {
      if (!input.authorizationCode) {
        return {
          authorizationUrl: `https://mock-oauth.example.com/authorize?state=${input.state ?? "st"}`,
        };
      }
      return {
        account: {
          externalAccountId: "mock-ext-1",
          displayName: "Mock X Account",
          credentialsEncrypted: encrypt(TEST_CREDS_PLAIN, TEST_ENCRYPTION_KEY),
          tokenExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          capabilities: this.getCapabilities(),
        },
      };
    },
    async validatePost(input: ValidatePostInput): Promise<ValidationResult> {
      const text = input.contentText ?? "";
      // X の 280 文字制限
      if (text.length > 280) {
        return {
          valid: false,
          errors: [
            {
              field: "contentText",
              message: `Text exceeds 280 characters (${text.length})`,
              constraint: 280,
            },
          ],
          warnings: [],
        };
      }
      return { valid: true, errors: [], warnings: [] };
    },
    async publishPost(_input: PublishPostInput): Promise<PublishResult> {
      return {
        success: true,
        platformPostId: `mock-post-${randomUUID()}`,
        publishedAt: new Date(),
      };
    },
    async deletePost(_input: DeletePostInput): Promise<DeleteResult> {
      return { success: true };
    },
    async listThreads(_input: ListThreadsInput): Promise<ThreadListResult> {
      return {
        threads: [
          {
            externalThreadId: "conv-sync-1",
            participantName: "Alice",
            participantExternalId: "user-sync-1",
            channel: "public",
            initiatedBy: "external",
            lastMessageAt: new Date("2026-04-10T10:05:00Z"),
            providerMetadata: {
              x: {
                entryType: "reply",
                conversationId: "conv-sync-1",
                rootPostId: "conv-sync-1",
                focusPostId: "tweet-sync-2",
                replyToPostId: "tweet-sync-root",
                authorXUserId: "user-sync-1",
                authorUsername: "alice",
              },
            },
          },
        ],
        nextCursor: '{"sinceId":"tweet-sync-2"}',
      };
    },
    async getMessages(_input: GetMessagesInput): Promise<MessageListResult> {
      return {
        messages: [
          {
            externalMessageId: "tweet-sync-1",
            direction: "inbound",
            contentText: "@brand hello",
            contentMedia: null,
            authorExternalId: "user-sync-1",
            authorDisplayName: "Alice",
            sentAt: new Date("2026-04-10T10:00:00Z"),
            providerMetadata: {
              x: {
                entryType: "mention",
                conversationId: "conv-sync-1",
                postId: "tweet-sync-1",
                replyToPostId: null,
                authorUsername: "alice",
                mentionedXUserIds: ["mock-ext-1"],
              },
            },
          },
          {
            externalMessageId: "tweet-sync-2",
            direction: "outbound",
            contentText: "thanks!",
            contentMedia: null,
            authorExternalId: "mock-ext-1",
            authorDisplayName: "Mock X Account",
            sentAt: new Date("2026-04-10T10:05:00Z"),
            providerMetadata: {
              x: {
                entryType: "reply",
                conversationId: "conv-sync-1",
                postId: "tweet-sync-2",
                replyToPostId: "tweet-sync-root",
                authorUsername: "brand",
                mentionedXUserIds: ["user-sync-1"],
              },
            },
          },
        ],
        nextCursor: null,
      };
    },
    async sendReply(_input: SendReplyInput): Promise<SendReplyResult> {
      return {
        success: true,
        externalMessageId: `mock-reply-${randomUUID()}`,
      };
    },
  };
}

/** モック ProviderRegistry 差し替え */
export function installMockProviders(): void {
  const registry = new ProviderRegistry();
  registry.register(createMockXProvider());
  setProviderRegistry(registry);
}

/** シードデータ投入 */
export interface SeedResult {
  workspaceId: string;
  ownerUserId: string;
  editorUserId: string;
  viewerUserId: string;
  adminUserId: string;
  agentUserId: string;
  socialAccountId: string;
  ownerApiKey: string;
  editorApiKey: string;
  viewerApiKey: string;
  adminApiKey: string;
  agentApiKey: string;
}

function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function seedTestData(sqlite: Database.Database): SeedResult {
  const now = Math.floor(Date.now() / 1000);
  const workspaceId = "ws-test-00000000";

  // workspaces
  sqlite
    .prepare("INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)")
    .run(workspaceId, "Test Workspace", now, now);

  // users (owner / editor / viewer / admin)
  const users: Array<{ id: string; email: string; role: string }> = [
    { id: "user-owner", email: "owner@test", role: "owner" },
    { id: "user-editor", email: "editor@test", role: "editor" },
    { id: "user-viewer", email: "viewer@test", role: "viewer" },
    { id: "user-admin", email: "admin@test", role: "admin" },
  ];
  for (const u of users) {
    sqlite
      .prepare(
        "INSERT INTO users (id, workspace_id, email, name, role, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(u.id, workspaceId, u.email, u.role, u.role, now);
  }

  // agent identity（API キー方式）
  // 5 つの agent identity を作成し、それぞれの role で API キー経由アクセス可能にする
  const ownerApiKey = "test-key-owner";
  const editorApiKey = "test-key-editor";
  const viewerApiKey = "test-key-viewer";
  const adminApiKey = "test-key-admin";
  const agentApiKey = "test-key-agent";

  const agents: Array<{ id: string; name: string; role: string; key: string }> = [
    { id: "agent-owner", name: "Owner Agent", role: "owner", key: ownerApiKey },
    { id: "agent-editor", name: "Editor Agent", role: "editor", key: editorApiKey },
    { id: "agent-viewer", name: "Viewer Agent", role: "viewer", key: viewerApiKey },
    { id: "agent-admin", name: "Admin Agent", role: "admin", key: adminApiKey },
    { id: "agent-agent", name: "Agent Agent", role: "agent", key: agentApiKey },
  ];
  for (const a of agents) {
    sqlite
      .prepare(
        "INSERT INTO agent_identities (id, workspace_id, name, role, api_key_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(a.id, workspaceId, a.name, a.role, hashApiKey(a.key), now);
  }

  // social account
  const socialAccountId = "sa-test-x";
  sqlite
    .prepare(
      "INSERT INTO social_accounts (id, workspace_id, platform, display_name, external_account_id, credentials_encrypted, token_expires_at, status, capabilities, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      socialAccountId,
      workspaceId,
      "x",
      "Mock X Account",
      "ext-mock-1",
      encrypt(TEST_CREDS_PLAIN, TEST_ENCRYPTION_KEY),
      now + 7 * 24 * 60 * 60,
      "active",
      JSON.stringify({
        textPost: true,
        imagePost: true,
        videoPost: true,
        threadPost: true,
        directMessage: true,
        commentReply: true,
        broadcast: false,
        nativeSchedule: false,
        usageApi: false,
      }),
      now,
      now,
    );

  return {
    workspaceId,
    ownerUserId: "user-owner",
    editorUserId: "user-editor",
    viewerUserId: "user-viewer",
    adminUserId: "user-admin",
    agentUserId: "agent-agent",
    socialAccountId,
    ownerApiKey,
    editorApiKey,
    viewerApiKey,
    adminApiKey,
    agentApiKey,
  };
}

/** 予算ポリシー挿入 */
export function insertBudgetPolicy(
  sqlite: Database.Database,
  opts: {
    workspaceId: string;
    scopeType: "workspace" | "platform" | "endpoint";
    scopeValue: string | null;
    period: "daily" | "weekly" | "monthly";
    limit: number;
    actionOnExceed: "warn" | "require-approval" | "block";
  },
): string {
  const id = `bp-${randomUUID().slice(0, 8)}`;
  const now = Math.floor(Date.now() / 1000);
  sqlite
    .prepare(
      "INSERT INTO budget_policies (id, workspace_id, scope_type, scope_value, period, limit_amount_usd, action_on_exceed, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      id,
      opts.workspaceId,
      opts.scopeType,
      opts.scopeValue,
      opts.period,
      opts.limit,
      opts.actionOnExceed,
      now,
      now,
    );
  return id;
}

/** 使用量記録挿入（予算超過シミュレーション用） */
export function insertUsageRecord(
  sqlite: Database.Database,
  opts: {
    workspaceId: string;
    platform: Platform;
    endpoint: string;
    costUsd: number;
  },
): void {
  const id = `ur-${randomUUID().slice(0, 8)}`;
  const now = Math.floor(Date.now() / 1000);
  sqlite
    .prepare(
      "INSERT INTO usage_records (id, workspace_id, platform, endpoint, actor_id, actor_type, request_count, success, estimated_cost_usd, recorded_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      id,
      opts.workspaceId,
      opts.platform,
      opts.endpoint,
      "user-editor",
      "user",
      1,
      1,
      opts.costUsd,
      now,
      now,
    );
}

/** クリーンアップ（DB 削除 + provider reset） */
export function cleanupTestContext(ctx: { sqlite: Database.Database; dbDir: string }): void {
  try {
    ctx.sqlite.close();
  } catch {
    /* ignore */
  }
  try {
    rmSync(ctx.dbDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  resetProviderRegistry();
  resetDb();
}
