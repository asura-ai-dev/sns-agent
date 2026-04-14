import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type Database from "better-sqlite3";
import {
  bindDatabaseUrl,
  cleanupTestContext,
  createTestDb,
  seedTestData,
  type SeedResult,
} from "../../__tests__/helpers/setup.js";
import {
  enrichPreviewForChat,
  ensureConversationId,
  normalizeAgentScheduledAt,
  summarizeHistoryField,
} from "../agent.js";

let ctx: {
  db: BetterSQLite3Database<Record<string, unknown>>;
  sqlite: Database.Database;
  dbPath: string;
  dbDir: string;
};
let seed: SeedResult;

beforeAll(() => {
  ctx = createTestDb();
  bindDatabaseUrl(ctx.dbPath);
  seed = seedTestData(ctx.sqlite);
});

afterAll(() => {
  cleanupTestContext(ctx);
});

describe("agent route helpers", () => {
  it("reuses an existing conversation id", () => {
    expect(ensureConversationId("conv-42")).toBe("conv-42");
  });

  it("generates a conversation id when none is provided", () => {
    expect(ensureConversationId(null)).toMatch(/^agent-/);
  });

  it("enriches post preview with resolved X account details", async () => {
    const preview = await enrichPreviewForChat({
      db: ctx.db,
      workspaceId: seed.workspaceId,
      intent: {
        actionName: "post.schedule",
        packageName: "sns-agent-x-openai",
        args: {
          accountName: "Mock X Account",
          text: "夕方の告知を投稿してください",
          scheduledAt: "2026-04-15T18:00:00+09:00",
        },
      },
      preview: {
        actionName: "post.schedule",
        packageName: "sns-agent-x-openai",
        description: "X のテキスト投稿を指定日時に予約投稿する",
        preview: {
          mode: "approval-required",
          operation: "schedule",
          account: "Mock X Account",
          scheduledAt: "2026-04-15T18:00:00+09:00",
          text: "夕方の告知を投稿してください",
          characterCount: 14,
        },
        requiredPermissions: ["schedule:create"],
        missingPermissions: [],
        argumentErrors: [],
        mode: "approval-required",
        allowed: true,
        blockedReason: null,
      },
    });

    expect(preview.preview).toMatchObject({
      platform: "x",
      accountInput: "Mock X Account",
      accountResolutionStatus: "resolved",
      targetAccountName: "Mock X Account",
      targetAccountId: seed.socialAccountId,
      scheduledAtIso: "2026-04-15T09:00:00.000Z",
    });
  });

  it("blocks preview when accountName matches multiple X accounts", async () => {
    ctx.sqlite
      .prepare(
        "INSERT INTO social_accounts (id, workspace_id, platform, display_name, external_account_id, credentials_encrypted, token_expires_at, status, capabilities, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        "sa-test-x-duplicate",
        seed.workspaceId,
        "x",
        "Mock X Account",
        "ext-mock-2",
        "encrypted",
        new Date("2026-04-20T00:00:00Z").toISOString(),
        "active",
        JSON.stringify({ textPost: true }),
        new Date("2026-04-10T00:00:00Z").toISOString(),
        new Date("2026-04-10T00:00:00Z").toISOString(),
      );

    const preview = await enrichPreviewForChat({
      db: ctx.db,
      workspaceId: seed.workspaceId,
      intent: {
        actionName: "post.create",
        packageName: "sns-agent-x-openai",
        args: {
          accountName: "Mock X Account",
          text: "重複アカウント確認",
        },
      },
      preview: {
        actionName: "post.create",
        packageName: "sns-agent-x-openai",
        description: "X の投稿を作成する",
        preview: {
          mode: "approval-required",
          operation: "draft",
          account: "Mock X Account",
          text: "重複アカウント確認",
          characterCount: 9,
        },
        requiredPermissions: ["post:create"],
        missingPermissions: [],
        argumentErrors: [],
        mode: "approval-required",
        allowed: true,
        blockedReason: null,
      },
    });

    expect(preview.allowed).toBe(false);
    expect(preview.blockedReason).toContain("ambiguous");
    expect(preview.argumentErrors).toEqual(
      expect.arrayContaining([expect.stringContaining("matched multiple X accounts")]),
    );
    expect(preview.preview).toMatchObject({
      accountResolutionStatus: "ambiguous",
    });
    expect(preview.preview).toHaveProperty("accountCandidates");
  });

  it("blocks preview when scheduledAt is missing timezone information", async () => {
    const preview = await enrichPreviewForChat({
      db: ctx.db,
      workspaceId: seed.workspaceId,
      intent: {
        actionName: "post.schedule",
        packageName: "sns-agent-x-openai",
        args: {
          accountName: "Mock X Account",
          text: "朝の投稿",
          scheduledAt: "2026-04-15T18:00:00",
        },
      },
      preview: {
        actionName: "post.schedule",
        packageName: "sns-agent-x-openai",
        description: "X のテキスト投稿を指定日時に予約投稿する",
        preview: {
          mode: "approval-required",
          operation: "schedule",
          account: "Mock X Account",
          scheduledAt: "2026-04-15T18:00:00",
          text: "朝の投稿",
          characterCount: 4,
        },
        requiredPermissions: ["schedule:create"],
        missingPermissions: [],
        argumentErrors: [],
        mode: "approval-required",
        allowed: true,
        blockedReason: null,
      },
    });

    expect(preview.allowed).toBe(false);
    expect(preview.blockedReason).toContain("Scheduled time is ambiguous");
    expect(preview.argumentErrors).toEqual(
      expect.arrayContaining([expect.stringContaining("timezone-aware ISO 8601")]),
    );
    expect(preview.preview).toMatchObject({
      scheduledAtInput: "2026-04-15T18:00:00",
    });
  });

  it("normalizes timezone-aware ISO scheduledAt values", () => {
    expect(normalizeAgentScheduledAt("2026-04-15T18:00:00+09:00")).toEqual({
      ok: true,
      normalized: "2026-04-15T09:00:00.000Z",
      reason: null,
    });

    expect(normalizeAgentScheduledAt("2026-04-15T18:00:00")).toEqual({
      ok: false,
      normalized: null,
      reason:
        "scheduledAt must be a timezone-aware ISO 8601 string like 2026-04-15T09:00:00+09:00",
    });
  });

  it("summarizes structured history payloads into readable text", () => {
    expect(
      summarizeHistoryField({
        actionName: "post.schedule",
        packageName: "sns-agent-x-openai",
        mode: "approval-required",
      }),
    ).toBe("post.schedule (sns-agent-x-openai, approval-required)");

    expect(
      summarizeHistoryField({
        message: "予約を受け付けました",
      }),
    ).toBe("予約を受け付けました");
  });
});
