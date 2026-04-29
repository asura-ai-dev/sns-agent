/**
 * API 統合テスト (Task 6004)
 *
 * Hono の app.fetch を直接呼び、実際のルーティング + ミドルウェア + DB +
 * モック Provider を貫通するエンドツーエンドの挙動を検証する。
 *
 * spec.md AC-3〜AC-6, AC-21, 評価観点「主要ユーザーフロー / API / 保存状態」
 * および design.md セクション 4 に準拠。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type Database from "better-sqlite3";
import {
  createTestDb,
  bindDatabaseUrl,
  seedTestData,
  installMockProviders,
  insertBudgetPolicy,
  insertUsageRecord,
  cleanupTestContext,
  type SeedResult,
} from "../helpers/setup.js";

// setup がグローバルな getDb キャッシュと env を差し替えるため、
// app の import は setup の後に遅延 import する必要がある。
type HonoApp = { fetch: (req: Request) => Response | Promise<Response> };

let app: HonoApp;
let ctx: {
  db: BetterSQLite3Database<Record<string, unknown>>;
  sqlite: Database.Database;
  dbPath: string;
  dbDir: string;
};
let seed: SeedResult;

/** Authorization ヘッダを付けた fetch ヘルパー */
async function req(
  method: string,
  path: string,
  apiKey: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    ...extraHeaders,
  };
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  const res = await app.fetch(new Request(`http://localhost${path}`, init));
  const text = await res.text();
  let parsed: Record<string, unknown> = {};
  if (text) {
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      parsed = { raw: text };
    }
  }
  return { status: res.status, body: parsed };
}

beforeAll(async () => {
  // DB とテスト環境をまず構築してから app を import する
  ctx = createTestDb();
  bindDatabaseUrl(ctx.dbPath);
  seed = seedTestData(ctx.sqlite);
  installMockProviders();

  // 動的 import（getDb が正しい DATABASE_URL を拾うため）
  const mod = (await import("../../app.js")) as { app: HonoApp };
  app = mod.app;
});

afterAll(() => {
  cleanupTestContext(ctx);
});

async function publicReq(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const init: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  const res = await app.fetch(new Request(`http://localhost${path}`, init));
  const text = await res.text();
  let parsed: Record<string, unknown> = {};
  if (text) {
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      parsed = { raw: text };
    }
  }
  return { status: res.status, body: parsed };
}

// ───────────────────────────────────────────
// 0. LLM provider credentials status (Task 5007 Phase A)
// ───────────────────────────────────────────
describe("0. openai-codex provider status", () => {
  it("GET /api/llm/providers/openai-codex/status returns missing when not connected", async () => {
    const res = await req("GET", "/api/llm/providers/openai-codex/status", seed.adminApiKey);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      provider: "openai-codex",
      status: "missing",
      connected: false,
      requiresReauth: false,
      reason: "not_connected",
    });
  });

  it("GET /api/llm/providers/openai-codex/status returns connected credential metadata", async () => {
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + 3600;
    ctx.sqlite
      .prepare(
        "INSERT INTO llm_provider_credentials (id, workspace_id, provider, status, access_token_encrypted, refresh_token_encrypted, expires_at, scopes, subject, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        "llm-cred-openai-codex",
        seed.workspaceId,
        "openai-codex",
        "connected",
        "encrypted-access-token",
        "encrypted-refresh-token",
        expiresAt,
        JSON.stringify(["codex"]),
        "user@example.com",
        JSON.stringify({ source: "integration-test" }),
        now,
        now,
      );

    const res = await req("GET", "/api/llm/providers/openai-codex/status", seed.adminApiKey);

    expect(res.status).toBe(200);
    const data = res.body.data as Record<string, unknown>;
    expect(data).toMatchObject({
      provider: "openai-codex",
      status: "connected",
      connected: true,
      requiresReauth: false,
      subject: "user@example.com",
    });
    expect(data.expiresAt).toBeTruthy();
    expect(data.scopes).toEqual(["codex"]);
  });

  it("viewer cannot read llm provider status", async () => {
    const res = await req("GET", "/api/llm/providers/openai-codex/status", seed.viewerApiKey);

    expect(res.status).toBe(403);
  });

  it("DELETE /api/llm/providers/openai-codex/disconnect removes credentials", async () => {
    const res = await req("DELETE", "/api/llm/providers/openai-codex/disconnect", seed.adminApiKey);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      provider: "openai-codex",
      status: "missing",
      connected: false,
    });

    const row = ctx.sqlite
      .prepare("SELECT id FROM llm_provider_credentials WHERE workspace_id = ? AND provider = ?")
      .get(seed.workspaceId, "openai-codex");
    expect(row).toBeUndefined();
  });
});

// ───────────────────────────────────────────
// a. アカウント接続フロー (GET /api/accounts)
// ───────────────────────────────────────────
describe("a. accounts flow", () => {
  it("GET /api/accounts returns seeded social account", async () => {
    const res = await req("GET", "/api/accounts", seed.editorApiKey);
    expect(res.status).toBe(200);
    const data = res.body.data as Array<Record<string, unknown>>;
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(1);
    expect(data[0].platform).toBe("x");
    expect(data[0].id).toBe(seed.socialAccountId);
  });

  it("POST /api/accounts initiates OAuth and returns authorization URL", async () => {
    const res = await req("POST", "/api/accounts", seed.ownerApiKey, {
      platform: "x",
    });
    expect(res.status).toBe(200);
    const data = res.body.data as { authorizationUrl?: string };
    expect(data).toBeDefined();
    expect(typeof data.authorizationUrl).toBe("string");
    expect(data.authorizationUrl).toContain("mock-oauth.example.com");
  });
});

// ───────────────────────────────────────────
// a2. フォロワー同期
// ───────────────────────────────────────────
describe("a2. followers sync flow", () => {
  it("POST /api/followers/sync stores X followers and GET /api/followers lists them", async () => {
    const sync = await req("POST", "/api/followers/sync", seed.editorApiKey, {
      socialAccountId: seed.socialAccountId,
      limit: 100,
    });

    expect(sync.status).toBe(200);
    expect(sync.body.data).toMatchObject({
      followerCount: 1,
      followingCount: 2,
      nextFollowersCursor: null,
      nextFollowingCursor: null,
    });

    const listed = await req(
      "GET",
      `/api/followers?socialAccountId=${seed.socialAccountId}`,
      seed.viewerApiKey,
    );

    expect(listed.status).toBe(200);
    const data = listed.body.data as Array<Record<string, unknown>>;
    expect(data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          externalUserId: "follower-sync-1",
          isFollowed: true,
          isFollowing: true,
        }),
        expect.objectContaining({
          externalUserId: "following-sync-1",
          isFollowed: false,
          isFollowing: true,
        }),
      ]),
    );
  });

  it("creates follower tags and filters followers by tag", async () => {
    const sync = await req("POST", "/api/followers/sync", seed.editorApiKey, {
      socialAccountId: seed.socialAccountId,
      limit: 100,
    });
    expect(sync.status).toBe(200);

    const followers = await req(
      "GET",
      `/api/followers?socialAccountId=${seed.socialAccountId}`,
      seed.viewerApiKey,
    );
    expect(followers.status).toBe(200);
    const follower = (followers.body.data as Array<Record<string, unknown>>).find(
      (item) => item.externalUserId === "follower-sync-1",
    );
    expect(follower?.id).toBeTruthy();

    const createdTag = await req("POST", "/api/tags", seed.editorApiKey, {
      socialAccountId: seed.socialAccountId,
      name: "  vip  ",
      color: "#eab308",
    });
    expect(createdTag.status).toBe(201);
    expect(createdTag.body.data).toMatchObject({
      socialAccountId: seed.socialAccountId,
      name: "vip",
      color: "#eab308",
    });
    const tagId = (createdTag.body.data as { id: string }).id;

    const attached = await req(
      "POST",
      `/api/followers/${String(follower?.id)}/tags/${tagId}`,
      seed.editorApiKey,
      { socialAccountId: seed.socialAccountId },
    );
    expect(attached.status).toBe(200);

    const filtered = await req(
      "GET",
      `/api/followers?socialAccountId=${seed.socialAccountId}&tagId=${tagId}`,
      seed.viewerApiKey,
    );
    expect(filtered.status).toBe(200);
    expect(filtered.body.data).toEqual([expect.objectContaining({ id: follower?.id })]);

    const detached = await req(
      "DELETE",
      `/api/followers/${String(follower?.id)}/tags/${tagId}`,
      seed.editorApiKey,
      { socialAccountId: seed.socialAccountId },
    );
    expect(detached.status).toBe(200);

    const afterDetach = await req(
      "GET",
      `/api/followers?socialAccountId=${seed.socialAccountId}&tagId=${tagId}`,
      seed.viewerApiKey,
    );
    expect(afterDetach.status).toBe(200);
    expect(afterDetach.body.data).toEqual([]);
  });
});

// ───────────────────────────────────────────
// a3. フォロワー分析
// ───────────────────────────────────────────
describe("a3. follower analytics flow", () => {
  it("GET /api/analytics/followers returns follower snapshot deltas and series", async () => {
    const capturedAt = Math.floor(new Date("2026-04-29T00:00:00Z").getTime() / 1000);
    const insert = ctx.sqlite.prepare(
      "INSERT INTO follower_snapshots (id, workspace_id, social_account_id, platform, snapshot_date, follower_count, following_count, captured_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    insert.run(
      "snap-30",
      seed.workspaceId,
      seed.socialAccountId,
      "x",
      "2026-03-30",
      80,
      20,
      capturedAt,
      capturedAt,
      capturedAt,
    );
    insert.run(
      "snap-7",
      seed.workspaceId,
      seed.socialAccountId,
      "x",
      "2026-04-22",
      100,
      25,
      capturedAt,
      capturedAt,
      capturedAt,
    );
    insert.run(
      "snap-current",
      seed.workspaceId,
      seed.socialAccountId,
      "x",
      "2026-04-29",
      120,
      30,
      capturedAt,
      capturedAt,
      capturedAt,
    );

    const res = await req(
      "GET",
      `/api/analytics/followers?socialAccountId=${seed.socialAccountId}&asOfDate=2026-04-29`,
      seed.viewerApiKey,
    );

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      currentCount: 120,
      delta7Days: 20,
      delta30Days: 40,
    });
    expect(
      (res.body.data as { series: Array<{ date: string }> }).series.map((p) => p.date),
    ).toEqual(["2026-03-30", "2026-04-22", "2026-04-29"]);
  });
});

// ───────────────────────────────────────────
// a2b. Quote tweets
// ───────────────────────────────────────────
describe("a2b. quote tweets flow", () => {
  it("syncs quote tweets, lists detail, and triggers engagement actions", async () => {
    const now = Math.floor(Date.now() / 1000);
    ctx.sqlite
      .prepare(
        "INSERT INTO posts (id, workspace_id, social_account_id, platform, status, content_text, content_media, provider_metadata, platform_post_id, validation_result, idempotency_key, created_by, created_at, updated_at, published_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        "post-source-1",
        seed.workspaceId,
        seed.socialAccountId,
        "x",
        "published",
        "launch source",
        null,
        null,
        "source-post-1",
        null,
        null,
        seed.editorUserId,
        now,
        now,
        now,
      );

    const sync = await req("POST", "/api/quote-tweets/sync", seed.editorApiKey, {
      socialAccountId: seed.socialAccountId,
      limit: 50,
    });
    expect(sync.status).toBe(200);
    expect(sync.body.data).toMatchObject({
      sourceTweetsScanned: 1,
      quotesScanned: 1,
      quotesStored: 1,
    });

    const listed = await req(
      "GET",
      `/api/quote-tweets?socialAccountId=${seed.socialAccountId}`,
      seed.viewerApiKey,
    );
    expect(listed.status).toBe(200);
    const quotes = listed.body.data as Array<Record<string, unknown>>;
    expect(quotes).toHaveLength(1);
    expect(quotes[0]).toMatchObject({
      socialAccountId: seed.socialAccountId,
      sourceTweetId: "source-post-1",
      quoteTweetId: "quote-sync-1",
      authorUsername: "quote_alice",
      authorDisplayName: "Quote Alice",
      authorProfileImageUrl: "https://cdn.example.test/quote-alice.jpg",
      authorVerified: true,
    });

    const quoteId = String(quotes[0].id);
    const detail = await req("GET", `/api/quote-tweets/${quoteId}`, seed.viewerApiKey);
    expect(detail.status).toBe(200);
    expect(detail.body.data).toMatchObject({
      id: quoteId,
      contentText: "quoting this with a note",
    });

    const liked = await req("POST", `/api/quote-tweets/${quoteId}/actions`, seed.editorApiKey, {
      actionType: "like",
    });
    expect(liked.status).toBe(201);
    expect(liked.body.data).toMatchObject({
      externalActionId: "mock-like-quote-sync-1",
      quote: {
        id: quoteId,
        lastActionType: "like",
        lastActionExternalId: "mock-like-quote-sync-1",
      },
    });
  });
});

// ───────────────────────────────────────────
// a3. Engagement gates
// ───────────────────────────────────────────
describe("a3. engagement gates flow", () => {
  it("supports protected CRUD under /api/engagement-gates", async () => {
    const created = await req("POST", "/api/engagement-gates", seed.editorApiKey, {
      socialAccountId: seed.socialAccountId,
      name: "  Launch reply gate  ",
      triggerPostId: "tweet-root-1",
      conditions: {
        requireLike: true,
        requireRepost: false,
        requireFollow: true,
      },
      actionType: "verify_only",
      actionText: null,
      stealthConfig: {
        gateHourlyLimit: 10,
        gateDailyLimit: 50,
        accountHourlyLimit: 20,
        accountDailyLimit: 100,
        jitterMinSeconds: 30,
        jitterMaxSeconds: 90,
        backoffSeconds: 300,
        templateVariants: ["secret A", "secret B"],
      },
    });

    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      socialAccountId: seed.socialAccountId,
      platform: "x",
      name: "Launch reply gate",
      triggerType: "reply",
      triggerPostId: "tweet-root-1",
      conditions: {
        requireLike: true,
        requireRepost: false,
        requireFollow: true,
      },
      actionType: "verify_only",
      stealthConfig: {
        gateHourlyLimit: 10,
        gateDailyLimit: 50,
        accountHourlyLimit: 20,
        accountDailyLimit: 100,
        jitterMinSeconds: 30,
        jitterMaxSeconds: 90,
        backoffSeconds: 300,
        templateVariants: ["secret A", "secret B"],
      },
      deliveryBackoffUntil: null,
      lastReplySinceId: null,
    });
    const gateId = (created.body.data as { id: string }).id;

    const listed = await req(
      "GET",
      `/api/engagement-gates?socialAccountId=${seed.socialAccountId}`,
      seed.viewerApiKey,
    );
    expect(listed.status).toBe(200);
    expect(listed.body.data).toEqual([expect.objectContaining({ id: gateId })]);

    const updated = await req("PATCH", `/api/engagement-gates/${gateId}`, seed.editorApiKey, {
      status: "paused",
      actionType: "dm",
      actionText: "secret",
      stealthConfig: {
        gateHourlyLimit: 2,
        jitterMinSeconds: 0,
        jitterMaxSeconds: 0,
        templateVariants: ["dm secret"],
      },
    });
    expect(updated.status).toBe(200);
    expect(updated.body.data).toMatchObject({
      id: gateId,
      status: "paused",
      actionType: "dm",
      actionText: "secret",
      stealthConfig: {
        gateHourlyLimit: 2,
        gateDailyLimit: null,
        accountHourlyLimit: null,
        accountDailyLimit: null,
        jitterMinSeconds: 0,
        jitterMaxSeconds: 0,
        backoffSeconds: null,
        templateVariants: ["dm secret"],
      },
    });

    const viewerCreate = await req("POST", "/api/engagement-gates", seed.viewerApiKey, {
      socialAccountId: seed.socialAccountId,
      name: "viewer blocked",
      actionType: "verify_only",
    });
    expect(viewerCreate.status).toBe(403);

    const deleted = await req("DELETE", `/api/engagement-gates/${gateId}`, seed.editorApiKey);
    expect(deleted.status).toBe(200);
  });

  it("processes reply-trigger gates and persists delivery dedupe state", async () => {
    const created = await req("POST", "/api/engagement-gates", seed.editorApiKey, {
      socialAccountId: seed.socialAccountId,
      name: "Process gate",
      triggerPostId: "tweet-root-1",
      conditions: {
        requireLike: true,
        requireRepost: true,
        requireFollow: true,
      },
      actionType: "verify_only",
    });
    expect(created.status).toBe(201);
    const gateId = (created.body.data as { id: string }).id;

    const processed = await req("POST", "/api/engagement-gates/process", seed.editorApiKey, {
      limit: 10,
    });
    expect(processed.status).toBe(200);
    expect(processed.body.data).toMatchObject({
      gatesScanned: expect.any(Number),
      deliveriesCreated: 1,
      skippedDuplicate: 0,
      lastReplySinceIdsUpdated: expect.any(Number),
    });

    const gateRow = ctx.sqlite
      .prepare("SELECT last_reply_since_id FROM engagement_gates WHERE id = ?")
      .get(gateId) as { last_reply_since_id: string | null } | undefined;
    expect(gateRow?.last_reply_since_id).toBe("tweet-gate-10");

    const deliveries = ctx.sqlite
      .prepare(
        "SELECT external_user_id, external_reply_id, status FROM engagement_gate_deliveries WHERE engagement_gate_id = ?",
      )
      .all(gateId);
    expect(deliveries).toEqual([
      expect.objectContaining({
        external_user_id: "user-gate-1",
        external_reply_id: "tweet-gate-10",
        status: "verified",
      }),
    ]);

    const processedAgain = await req("POST", "/api/engagement-gates/process", seed.editorApiKey, {
      limit: 10,
    });
    expect(processedAgain.status).toBe(200);
    expect(processedAgain.body.data).toMatchObject({
      deliveriesCreated: 0,
      skippedDuplicate: expect.any(Number),
    });
  });

  it("verifies gate eligibility and consumes delivery tokens without leaking LINE secrets", async () => {
    const created = await req("POST", "/api/engagement-gates", seed.editorApiKey, {
      socialAccountId: seed.socialAccountId,
      name: "LINE handoff gate",
      triggerPostId: "tweet-root-1",
      conditions: {
        requireLike: true,
        requireRepost: true,
        requireFollow: true,
      },
      actionType: "verify_only",
      lineHarnessUrl: "https://line-harness.example/campaigns/gate",
      lineHarnessApiKeyRef: "line-harness-prod",
      lineHarnessApiKey: "super-secret-value",
      lineHarnessTag: "launch",
      lineHarnessScenario: "reward-a",
    });

    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      lineHarnessUrl: "https://line-harness.example/campaigns/gate",
      lineHarnessApiKeyRef: "line-harness-prod",
      lineHarnessTag: "launch",
      lineHarnessScenario: "reward-a",
    });
    expect(JSON.stringify(created.body)).not.toContain("super-secret-value");
    expect(created.body.data).not.toHaveProperty("lineHarnessApiKey");

    const gateId = (created.body.data as { id: string }).id;
    const verified = await req(
      "GET",
      `/api/engagement-gates/${gateId}/verify?username=@gate_user`,
      seed.viewerApiKey,
    );

    expect(verified.status).toBe(200);
    expect(verified.body.data).toMatchObject({
      gateId,
      username: "gate_user",
      eligible: true,
      conditions: {
        liked: true,
        reposted: true,
        followed: true,
      },
      delivery: {
        consumedAt: null,
      },
      lineHarness: {
        url: "https://line-harness.example/campaigns/gate",
        apiKeyRef: "line-harness-prod",
        tag: "launch",
        scenario: "reward-a",
      },
    });
    const token = (verified.body.data as { delivery?: { token?: string } }).delivery?.token;
    expect(token).toEqual(expect.any(String));
    expect(JSON.stringify(verified.body)).not.toContain("super-secret-value");
    expect(verified.body.data).not.toHaveProperty("lineHarnessApiKey");

    const consumed = await req(
      "POST",
      `/api/engagement-gates/${gateId}/deliveries/consume`,
      seed.editorApiKey,
      { deliveryToken: token },
    );
    expect(consumed.status).toBe(200);
    expect(consumed.body.data).toMatchObject({
      consumed: true,
      delivery: {
        deliveryToken: token,
        consumedAt: expect.any(String),
      },
    });

    const consumedAgain = await req(
      "POST",
      `/api/engagement-gates/${gateId}/deliveries/consume`,
      seed.editorApiKey,
      { deliveryToken: token },
    );
    expect(consumedAgain.status).toBe(200);
    expect(consumedAgain.body.data).toMatchObject({
      consumed: false,
      delivery: {
        deliveryToken: token,
        consumedAt: (consumed.body.data as { delivery: { consumedAt: string } }).delivery
          .consumedAt,
      },
    });
  });
});

// ───────────────────────────────────────────
// b. 投稿作成→公開フロー
// ───────────────────────────────────────────
describe("b. post draft→publish flow", () => {
  let postId: string;

  it("POST /api/posts creates a draft", async () => {
    const res = await req("POST", "/api/posts", seed.editorApiKey, {
      socialAccountId: seed.socialAccountId,
      contentText: "Hello world from integration test",
      publishNow: false,
    });
    expect(res.status).toBe(201);
    const data = res.body.data as { id: string; status: string };
    expect(data.status).toBe("draft");
    postId = data.id;
  });

  it("POST /api/posts/:id/publish publishes the post", async () => {
    const res = await req("POST", `/api/posts/${postId}/publish`, seed.editorApiKey);
    expect([200, 202]).toContain(res.status);
    const data = res.body.data as { id: string; status: string };
    // publish may be sync or async; if published directly, status becomes published
    if (res.status === 200) {
      expect(data.status).toBe("published");
    }
  });

  it("GET /api/posts/:id reflects published state", async () => {
    const res = await req("GET", `/api/posts/${postId}`, seed.editorApiKey);
    expect(res.status).toBe(200);
    const data = res.body.data as { status: string };
    expect(["published", "scheduled"]).toContain(data.status);
  });

  it("POST /api/posts accepts quote-only payload for X", async () => {
    const res = await req("POST", "/api/posts", seed.editorApiKey, {
      socialAccountId: seed.socialAccountId,
      providerMetadata: {
        x: {
          quotePostId: "tweet-42",
        },
      },
    });
    expect(res.status).toBe(201);
    const data = res.body.data as {
      status: string;
      providerMetadata?: { x?: { quotePostId?: string | null } };
    };
    expect(data.status).toBe("draft");
    expect(data.providerMetadata?.x?.quotePostId).toBe("tweet-42");
  });
});

// ───────────────────────────────────────────
// c. 予約投稿フロー
// ───────────────────────────────────────────
describe("c. schedule flow", () => {
  let scheduledPostId: string;
  let scheduledJobId: string;

  it("creates a draft and schedules it", async () => {
    const draft = await req("POST", "/api/posts", seed.editorApiKey, {
      socialAccountId: seed.socialAccountId,
      contentText: "Scheduled post",
    });
    expect(draft.status).toBe(201);
    const draftData = draft.body.data as { id: string };

    const futureAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const sched = await req("POST", "/api/schedules", seed.editorApiKey, {
      postId: draftData.id,
      scheduledAt: futureAt,
    });
    expect(sched.status).toBe(201);
    const job = sched.body.data as { id: string; status: string; postId: string };
    expect(job.status).toBe("pending");
    expect(job.postId).toBe(draftData.id);
    scheduledPostId = draftData.id;
    scheduledJobId = job.id;

    // GET /api/schedules/:id
    const got = await req("GET", `/api/schedules/${job.id}`, seed.editorApiKey);
    expect(got.status).toBe(200);
    expect((got.body.data as { id: string }).id).toBe(job.id);
  });

  it("POST /api/schedules/run-due executes due jobs manually", async () => {
    const dueUnix = Math.floor((Date.now() - 60_000) / 1000);
    ctx.sqlite
      .prepare("UPDATE scheduled_jobs SET scheduled_at = ?, status = 'pending' WHERE id = ?")
      .run(dueUnix, scheduledJobId);
    ctx.sqlite.prepare("UPDATE posts SET status = 'scheduled' WHERE id = ?").run(scheduledPostId);

    const run = await req("POST", "/api/schedules/run-due", seed.editorApiKey, {
      limit: 5,
    });
    expect(run.status).toBe(200);
    const data = run.body.data as {
      processed: number;
      succeeded: number;
      jobs: Array<{ id: string; afterStatus: string }>;
    };
    expect(data.processed).toBeGreaterThanOrEqual(1);
    expect(data.succeeded).toBeGreaterThanOrEqual(1);
    expect(
      data.jobs.some((job) => job.id === scheduledJobId && job.afterStatus === "succeeded"),
    ).toBe(true);

    const got = await req("GET", `/api/schedules/${scheduledJobId}`, seed.editorApiKey);
    expect(got.status).toBe(200);
    expect((got.body.data as { status: string }).status).toBe("succeeded");
    expect(((got.body.detail as { executionLogs?: unknown[] })?.executionLogs ?? []).length).toBe(
      1,
    );
  });
});

// ───────────────────────────────────────────
// d. バリデーションエラー (280 文字超過)
// ───────────────────────────────────────────
describe("d. validation error", () => {
  it("rejects X post exceeding 280 characters at draft creation", async () => {
    const longText = "a".repeat(290);
    const res = await req("POST", "/api/posts", seed.editorApiKey, {
      socialAccountId: seed.socialAccountId,
      contentText: longText,
    });
    // Provider.validatePost は createPost 時点で実行されるため 400 が正しい
    expect(res.status).toBe(400);
    const err = res.body.error as { code: string; message: string };
    expect(err.code).toBeDefined();
    expect(err.message.toLowerCase()).toContain("validation");
  });
});

// ───────────────────────────────────────────
// e. RBAC (viewer 403, editor 201)
// ───────────────────────────────────────────
describe("e. RBAC", () => {
  it("viewer cannot POST /api/posts (403)", async () => {
    const res = await req("POST", "/api/posts", seed.viewerApiKey, {
      socialAccountId: seed.socialAccountId,
      contentText: "viewer should not be able to post",
    });
    expect(res.status).toBe(403);
    const err = res.body.error as { code: string };
    expect(err.code).toBe("AUTH_FORBIDDEN");
  });

  it("editor can POST /api/posts (201)", async () => {
    const res = await req("POST", "/api/posts", seed.editorApiKey, {
      socialAccountId: seed.socialAccountId,
      contentText: "editor can post",
    });
    expect(res.status).toBe(201);
  });
});

// ───────────────────────────────────────────
// f. Idempotency (X-Idempotency-Key)
// ───────────────────────────────────────────
describe("f. idempotency", () => {
  it("returns the same post on repeated POST with same X-Idempotency-Key", async () => {
    const key = "idem-test-key-001";
    const first = await req(
      "POST",
      "/api/posts",
      seed.editorApiKey,
      {
        socialAccountId: seed.socialAccountId,
        contentText: "idempotent draft",
      },
      { "X-Idempotency-Key": key },
    );
    expect(first.status).toBe(201);
    const firstData = first.body.data as { id: string };

    const second = await req(
      "POST",
      "/api/posts",
      seed.editorApiKey,
      {
        socialAccountId: seed.socialAccountId,
        contentText: "second call with same key",
      },
      { "X-Idempotency-Key": key },
    );
    // 2 回目は middleware が 200 で既存を返す
    expect(second.status).toBe(200);
    const secondData = second.body.data as { id: string };
    expect(secondData.id).toBe(firstData.id);
  });
});

// ───────────────────────────────────────────
// g. 予算チェック (block ポリシー)
// ───────────────────────────────────────────
describe("g. budget block policy", () => {
  it("blocks publish when workspace budget is exceeded (block policy)", async () => {
    // 非常に低い上限の block ポリシーを設定
    insertBudgetPolicy(ctx.sqlite, {
      workspaceId: seed.workspaceId,
      scopeType: "workspace",
      scopeValue: null,
      period: "monthly",
      limit: 0.0001,
      actionOnExceed: "block",
    });
    // 既存の大きな使用量を挿入（これにより予算超過）
    insertUsageRecord(ctx.sqlite, {
      workspaceId: seed.workspaceId,
      platform: "x",
      endpoint: "post:publish",
      costUsd: 1.0,
    });

    const draft = await req("POST", "/api/posts", seed.editorApiKey, {
      socialAccountId: seed.socialAccountId,
      contentText: "should be blocked by budget",
    });
    expect(draft.status).toBe(201);
    const { id } = draft.body.data as { id: string };
    const pub = await req("POST", `/api/posts/${id}/publish`, seed.editorApiKey);
    // block ポリシーの場合は 403 Forbidden または 429 Too Many Requests が返る
    expect([400, 402, 403, 429]).toContain(pub.status);
    const err = pub.body.error as { code?: string } | undefined;
    expect(err?.code).toBeDefined();
  });
});

// ───────────────────────────────────────────
// h. 承認フロー (agent ロールが公開→承認)
// ───────────────────────────────────────────
describe("h. approval flow", () => {
  it("agent role is blocked by RBAC from post:publish (403)", async () => {
    // agent role は post:create は持つが post:publish は持たないため、
    // publish エンドポイントは RBAC レイヤで 403 になる。
    const draft = await req("POST", "/api/posts", seed.agentApiKey, {
      socialAccountId: seed.socialAccountId,
      contentText: "agent drafting",
    });
    expect(draft.status).toBe(201);
    const { id } = draft.body.data as { id: string };
    const pub = await req("POST", `/api/posts/${id}/publish`, seed.agentApiKey);
    expect(pub.status).toBe(403);
  });

  it("admin can list pending approvals and approve", async () => {
    // 1. editor が draft を作成
    const draft = await req("POST", "/api/posts", seed.editorApiKey, {
      socialAccountId: seed.socialAccountId,
      contentText: "post pending approval",
    });
    expect(draft.status).toBe(201);
    const { id: postId } = draft.body.data as { id: string };

    // 2. approval_requests を直接挿入（UI/承認ポリシー経由でも同じ結果になる）
    const approvalId = `ap-${Math.floor(Math.random() * 1e8)}`;
    const now = Math.floor(Date.now() / 1000);
    ctx.sqlite
      .prepare(
        "INSERT INTO approval_requests (id, workspace_id, resource_type, resource_id, requested_by, requested_at, status, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        approvalId,
        seed.workspaceId,
        "post",
        postId,
        seed.editorUserId,
        now,
        "pending",
        "integration-test",
      );
    // 対象 Post の status を scheduled(承認待ち) に変更
    ctx.sqlite
      .prepare("UPDATE posts SET status = 'scheduled', updated_at = ? WHERE id = ?")
      .run(now, postId);

    // 3. admin が一覧を取得
    const list = await req("GET", "/api/approvals?status=pending", seed.adminApiKey);
    expect(list.status).toBe(200);
    const items = list.body.data as Array<{ id: string; resourceId: string }>;
    expect(items.some((i) => i.id === approvalId)).toBe(true);

    // 4. admin が承認
    const approveRes = await req("POST", `/api/approvals/${approvalId}/approve`, seed.adminApiKey);
    expect(approveRes.status).toBe(200);
    const body = approveRes.body.data as {
      request: { status: string };
      executorMissing: boolean;
    };
    expect(body.request.status).toBe("approved");
  });
});

// ───────────────────────────────────────────
// i. 監査ログ記録
// ───────────────────────────────────────────
describe("i. audit log", () => {
  it("GET /api/audit returns entries after write operations", async () => {
    // まず 1 件書き込みを実行しておく
    await req("POST", "/api/posts", seed.editorApiKey, {
      socialAccountId: seed.socialAccountId,
      contentText: "audit log probe",
    });
    // admin で audit を読み取る
    const res = await req("GET", "/api/audit", seed.adminApiKey);
    expect(res.status).toBe(200);
    const data = res.body.data as Array<Record<string, unknown>>;
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
  });
});

// ───────────────────────────────────────────
// j. 使用量記録
// ───────────────────────────────────────────
describe("j. usage records", () => {
  it("GET /api/usage returns records after publish", async () => {
    const res = await req("GET", "/api/usage", seed.adminApiKey);
    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
  });

  it("GET /api/usage/summary returns summary shape", async () => {
    const res = await req("GET", "/api/usage/summary", seed.adminApiKey);
    expect(res.status).toBe(200);
    const data = res.body.data as {
      totalCost: number;
      totalRequests: number;
      successRate: number;
      byPlatform: unknown;
    };
    expect(typeof data.totalCost).toBe("number");
    expect(typeof data.totalRequests).toBe("number");
  });

  it("GET /api/usage can aggregate by endpoint and gate dimensions", async () => {
    const now = Math.floor(Date.now() / 1000);
    ctx.sqlite
      .prepare(
        "INSERT INTO usage_records (id, workspace_id, platform, endpoint, gate_id, feature, metadata, actor_id, actor_type, request_count, success, estimated_cost_usd, recorded_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        "usage-xhp015-gate-1",
        seed.workspaceId,
        "x",
        "engagement.gate.deliver",
        "gate-xhp015",
        "engagement_gate",
        JSON.stringify({ source: "integration-test" }),
        seed.editorUserId,
        "user",
        2,
        1,
        0.004,
        now,
        now,
      );

    const endpointRes = await req(
      "GET",
      "/api/usage?platform=x&dimension=endpoint",
      seed.adminApiKey,
    );
    expect(endpointRes.status).toBe(200);
    expect(endpointRes.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          platform: "x",
          endpoint: "engagement.gate.deliver",
          requestCount: expect.any(Number),
        }),
      ]),
    );

    const gateRes = await req("GET", "/api/usage?platform=x&dimension=gate", seed.adminApiKey);
    expect(gateRes.status).toBe(200);
    expect(gateRes.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          platform: "x",
          gateId: "gate-xhp015",
          feature: "engagement_gate",
          requestCount: 2,
        }),
      ]),
    );
  });
});

// ───────────────────────────────────────────
// k. X inbox model (P2-1)
// ───────────────────────────────────────────
describe("k. x inbox model", () => {
  it("stores X mentions by conversation unit and keeps X-only metadata separated", async () => {
    const webhook = await publicReq("POST", "/api/webhooks/x", {
      for_user_id: "ext-mock-1",
      tweet_create_events: [
        {
          id_str: "tweet-1",
          conversation_id_str: "conv-1",
          in_reply_to_status_id_str: "root-1",
          text: "@brand 返信です",
          user: {
            id_str: "user-42",
            name: "Alice",
            screen_name: "alice",
          },
        },
        {
          id_str: "tweet-self",
          conversation_id_str: "conv-self",
          text: "自分の投稿は inbox へ入れない",
          user: {
            id_str: "ext-mock-1",
            name: "Mock X Account",
            screen_name: "brand",
          },
        },
      ],
    });

    expect(webhook.status).toBe(200);
    expect(webhook.body.received).toBe(1);

    const inbox = await req("GET", "/api/inbox?platform=x", seed.editorApiKey);
    expect(inbox.status).toBe(200);

    const threads = inbox.body.data as Array<Record<string, unknown>>;
    const xThread = threads.find((thread) => thread.externalThreadId === "conv-1");
    expect(xThread).toBeDefined();
    expect(xThread?.channel).toBe("public");
    expect(xThread?.initiatedBy).toBe("external");
    expect(xThread?.participantExternalId).toBe("user-42");

    const metadata = xThread?.providerMetadata as
      | { x?: { entryType?: string; conversationId?: string; focusPostId?: string } }
      | undefined;
    expect(metadata?.x?.entryType).toBe("reply");
    expect(metadata?.x?.conversationId).toBe("conv-1");
    expect(metadata?.x?.focusPostId).toBe("tweet-1");
  });
});

// ───────────────────────────────────────────
// l. X inbox sync (P2-2)
// ───────────────────────────────────────────
describe("l. x inbox sync", () => {
  it("syncs mentions/replies from provider and records usage", async () => {
    const sync = await req("POST", "/api/inbox/sync", seed.editorApiKey, {
      socialAccountId: seed.socialAccountId,
      limit: 10,
    });

    expect(sync.status).toBe(200);
    expect(sync.body.data).toMatchObject({
      syncedThreadCount: 2,
      syncedMessageCount: 4,
    });

    const inbox = await req("GET", "/api/inbox?platform=x", seed.editorApiKey);
    expect(inbox.status).toBe(200);
    const threads = inbox.body.data as Array<Record<string, unknown>>;
    const thread = threads.find((row) => row.externalThreadId === "conv-sync-1");
    expect(thread).toBeDefined();

    const threadId = thread?.id as string;

    const now = Math.floor(Date.now() / 1000);
    ctx.sqlite
      .prepare(
        "INSERT INTO posts (id, workspace_id, social_account_id, platform, status, content_text, platform_post_id, created_by, created_at, updated_at, published_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        "post-root-sync",
        seed.workspaceId,
        seed.socialAccountId,
        "x",
        "published",
        "元投稿です",
        "tweet-sync-root",
        seed.editorUserId,
        now,
        now,
        now,
      );
    ctx.sqlite
      .prepare(
        "INSERT INTO posts (id, workspace_id, social_account_id, platform, status, content_text, platform_post_id, created_by, created_at, updated_at, published_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        "post-focus-sync",
        seed.workspaceId,
        seed.socialAccountId,
        "x",
        "published",
        "返信済みの自社投稿です",
        "tweet-sync-2",
        seed.editorUserId,
        now,
        now,
        now,
      );

    const detail = await req("GET", `/api/inbox/${threadId}`, seed.editorApiKey);
    expect(detail.status).toBe(200);
    const detailData = detail.body.data as {
      messages: Array<Record<string, unknown>>;
      context: {
        entryType: string | null;
        relatedPosts: Array<Record<string, unknown>>;
      };
    };
    const messages = detailData.messages;
    expect(messages).toHaveLength(2);
    expect(messages[0]?.direction).toBe("inbound");
    expect(messages[1]?.direction).toBe("outbound");
    expect(detailData.context.entryType).toBe("reply");
    expect(detailData.context.relatedPosts).toHaveLength(2);
    expect(detailData.context.relatedPosts[0]?.platformPostId).toBe("tweet-sync-2");
    expect(detailData.context.relatedPosts[1]?.platformPostId).toBe("tweet-sync-root");

    const usageRows = ctx.sqlite
      .prepare(
        "SELECT endpoint, success FROM usage_records WHERE workspace_id = ? AND platform = ? ORDER BY created_at DESC",
      )
      .all(seed.workspaceId, "x") as Array<{ endpoint: string; success: number }>;

    expect(usageRows.some((row) => row.endpoint === "inbox.list" && row.success === 1)).toBe(true);
    expect(usageRows.some((row) => row.endpoint === "inbox.getMessages" && row.success === 1)).toBe(
      true,
    );
  });

  it("syncs X DM conversations into generic threads/messages and returns actionable permission errors", async () => {
    const sync = await req("POST", "/api/inbox/sync", seed.editorApiKey, {
      socialAccountId: seed.socialAccountId,
      limit: 10,
    });
    expect(sync.status).toBe(200);

    const inbox = await req("GET", "/api/inbox?platform=x", seed.editorApiKey);
    expect(inbox.status).toBe(200);
    const threads = inbox.body.data as Array<Record<string, unknown>>;
    const dmThread = threads.find((row) => row.externalThreadId === "dm:user-dm-1");
    expect(dmThread).toMatchObject({
      channel: "direct",
      participantExternalId: "user-dm-1",
    });
    expect(
      (dmThread?.providerMetadata as { x?: { entryType?: string } } | null)?.x?.entryType,
    ).toBe("dm");

    const detail = await req("GET", `/api/inbox/${dmThread?.id}`, seed.editorApiKey);
    expect(detail.status).toBe(200);
    const detailData = detail.body.data as {
      messages: Array<Record<string, unknown>>;
      context: { entryType: string | null };
    };
    expect(detailData.context.entryType).toBe("dm");
    expect(detailData.messages).toEqual([
      expect.objectContaining({
        externalMessageId: "dm-sync-1",
        direction: "inbound",
      }),
      expect.objectContaining({
        externalMessageId: "dm-sync-2",
        direction: "outbound",
      }),
    ]);

    const permissionFailure = await req(
      "POST",
      `/api/inbox/${dmThread?.id}/reply`,
      seed.editorApiKey,
      {
        contentText: "trigger dm permission failure",
      },
    );
    expect(permissionFailure.status).toBe(403);
    expect(permissionFailure.body.error).toMatchObject({
      code: "PROVIDER_PERMISSION_REQUIRED",
      message: expect.stringContaining("X DM permission required"),
      details: {
        provider: "x",
        operation: "dm.send",
        requiredScopes: ["dm.write", "dm.read"],
      },
    });
  });
});

// ───────────────────────────────────────────
// m. X reply send (P2-3)
// ───────────────────────────────────────────
describe("m. x reply send", () => {
  it("editor can send a reply immediately and usage is recorded", async () => {
    const sync = await req("POST", "/api/inbox/sync", seed.editorApiKey, {
      socialAccountId: seed.socialAccountId,
      limit: 10,
    });
    expect(sync.status).toBe(200);

    const inbox = await req("GET", "/api/inbox?platform=x", seed.editorApiKey);
    const thread = (inbox.body.data as Array<Record<string, unknown>>).find(
      (row) => row.externalThreadId === "conv-sync-1",
    );
    expect(thread).toBeDefined();

    const reply = await req("POST", `/api/inbox/${thread?.id}/reply`, seed.editorApiKey, {
      contentText: "了解しました。対応します。",
      contentMedia: [
        {
          type: "image",
          url: "data:image/png;base64,ZmFrZQ==",
          mimeType: "image/png",
        },
      ],
    });
    expect(reply.status).toBe(201);
    const replyData = reply.body.data as {
      externalMessageId: string | null;
      message: { direction: string; contentMedia: Array<{ type: string }> | null };
    };
    expect(replyData.externalMessageId).toBeTruthy();
    expect(replyData.message.direction).toBe("outbound");
    expect(replyData.message.contentMedia).toHaveLength(1);

    const usageRows = ctx.sqlite
      .prepare(
        "SELECT endpoint, success FROM usage_records WHERE workspace_id = ? AND platform = ? ORDER BY created_at DESC",
      )
      .all(seed.workspaceId, "x") as Array<{ endpoint: string; success: number }>;
    expect(usageRows.some((row) => row.endpoint === "inbox.reply" && row.success === 1)).toBe(true);
  });

  it("agent reply becomes pending approval and is sent after admin approval", async () => {
    const sync = await req("POST", "/api/inbox/sync", seed.editorApiKey, {
      socialAccountId: seed.socialAccountId,
      limit: 10,
    });
    expect(sync.status).toBe(200);

    const inbox = await req("GET", "/api/inbox?platform=x", seed.agentApiKey);
    const thread = (inbox.body.data as Array<Record<string, unknown>>).find(
      (row) => row.externalThreadId === "conv-sync-1",
    );
    expect(thread).toBeDefined();

    const pending = await req("POST", `/api/inbox/${thread?.id}/reply`, seed.agentApiKey, {
      contentText: "AI 返信案です。",
      contentMedia: [
        {
          type: "image",
          url: "data:image/png;base64,ZmFrZQ==",
          mimeType: "image/png",
        },
      ],
    });
    expect(pending.status).toBe(202);
    const pendingMeta = pending.body.meta as {
      requiresApproval: boolean;
      approvalId: string;
    };
    expect(pendingMeta.requiresApproval).toBe(true);
    const approvalId = pendingMeta.approvalId;

    const pendingRow = ctx.sqlite
      .prepare("SELECT payload FROM approval_requests WHERE id = ?")
      .get(approvalId) as { payload: string | null };
    expect(pendingRow.payload).toContain("AI 返信案です。");
    expect(pendingRow.payload).toContain("image/png");

    const approvalRes = await req("POST", `/api/approvals/${approvalId}/approve`, seed.adminApiKey);
    expect(approvalRes.status).toBe(200);
    const approvalData = approvalRes.body.data as {
      executorMissing: boolean;
      executionError: string | null;
    };
    expect(approvalData.executorMissing).toBe(false);
    expect(approvalData.executionError).toBeNull();

    const detail = await req("GET", `/api/inbox/${thread?.id}`, seed.editorApiKey);
    expect(detail.status).toBe(200);
    const messages = (detail.body.data as { messages: Array<Record<string, unknown>> }).messages;
    expect(messages.some((message) => message.contentText === "AI 返信案です。")).toBe(true);
    expect(
      messages.some(
        (message) =>
          message.contentText === "AI 返信案です。" &&
          Array.isArray(message.contentMedia) &&
          message.contentMedia.length === 1,
      ),
    ).toBe(true);

    const approvalRow = ctx.sqlite
      .prepare("SELECT status, payload FROM approval_requests WHERE id = ?")
      .get(approvalId) as { status: string; payload: string | null };
    expect(approvalRow.status).toBe("approved");
    expect(approvalRow.payload).toContain("AI 返信案です。");
  });
});

// ───────────────────────────────────────────
// n. X reply engagement actions (XHP-008)
// ───────────────────────────────────────────
describe("n. x reply engagement actions", () => {
  it("likes a reply target idempotently and exposes actions in thread detail", async () => {
    const sync = await req("POST", "/api/inbox/sync", seed.editorApiKey, {
      socialAccountId: seed.socialAccountId,
      limit: 10,
    });
    expect(sync.status).toBe(200);

    const inbox = await req("GET", "/api/inbox?platform=x", seed.editorApiKey);
    const thread = (inbox.body.data as Array<Record<string, unknown>>).find(
      (row) => row.externalThreadId === "conv-sync-1",
    );
    expect(thread).toBeDefined();

    const first = await req("POST", `/api/inbox/${thread?.id}/actions`, seed.editorApiKey, {
      actionType: "like",
    });
    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({
      created: true,
      action: {
        actionType: "like",
        targetPostId: "tweet-sync-2",
        status: "applied",
      },
    });

    const duplicate = await req("POST", `/api/inbox/${thread?.id}/actions`, seed.editorApiKey, {
      actionType: "like",
    });
    expect(duplicate.status).toBe(200);
    expect(duplicate.body.data).toMatchObject({
      created: false,
      action: {
        actionType: "like",
        targetPostId: "tweet-sync-2",
      },
    });

    const rows = ctx.sqlite
      .prepare(
        "SELECT action_type, target_post_id, status FROM engagement_actions WHERE thread_id = ?",
      )
      .all(thread?.id) as Array<{
      action_type: string;
      target_post_id: string;
      status: string;
    }>;
    expect(rows).toEqual([
      {
        action_type: "like",
        target_post_id: "tweet-sync-2",
        status: "applied",
      },
    ]);

    const detail = await req("GET", `/api/inbox/${thread?.id}`, seed.editorApiKey);
    expect(detail.status).toBe(200);
    const detailData = detail.body.data as {
      engagementActions: Array<Record<string, unknown>>;
    };
    expect(detailData.engagementActions).toEqual([
      expect.objectContaining({
        actionType: "like",
        targetPostId: "tweet-sync-2",
        status: "applied",
      }),
    ]);
  });
});
