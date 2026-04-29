import { describe, expect, it, vi } from "vitest";
import { SnsAgentClient } from "./client.js";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("SnsAgentClient engagement gates resource", () => {
  it("sends arbitrary SDK-backed requests for adapters such as MCP", async () => {
    const fetch = vi.fn(async () => jsonResponse({ data: { success: true } }));
    const client = new SnsAgentClient({
      baseUrl: "http://api.test",
      apiKey: "sdk-key",
      fetch: fetch as unknown as typeof globalThis.fetch,
    });

    const result = await client.request("DELETE", "/api/followers/follower-1/tags/tag-1", {
      body: { socialAccountId: "acct-1" },
    });

    expect(result).toEqual({ data: { success: true } });
    expect(fetch).toHaveBeenCalledWith(
      "http://api.test/api/followers/follower-1/tags/tag-1",
      expect.objectContaining({
        method: "DELETE",
        body: JSON.stringify({ socialAccountId: "acct-1" }),
        headers: expect.objectContaining({
          Authorization: "Bearer sdk-key",
          "X-Idempotency-Key": expect.any(String),
        }),
      }),
    );
  });

  it("verifies gate eligibility with username query parameters", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({
        data: {
          gateId: "gate-1",
          username: "alice",
          eligible: true,
          conditions: { liked: true, reposted: true, followed: true },
          delivery: { id: "delivery-1", token: "egt-token", consumedAt: null },
          lineHarness: {
            url: "https://line-harness.example/campaigns/gate",
            apiKeyRef: "line-harness-prod",
            tag: "launch",
            scenario: "reward-a",
          },
        },
      }),
    );
    const client = new SnsAgentClient({
      baseUrl: "http://api.test/",
      apiKey: "sdk-key",
      fetch: fetch as unknown as typeof globalThis.fetch,
    });

    const result = await client.engagementGates.verify("gate-1", { username: "@alice" });

    expect(result.data.eligible).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      "http://api.test/api/engagement-gates/gate-1/verify?username=%40alice",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ Authorization: "Bearer sdk-key" }),
      }),
    );
  });

  it("consumes delivery tokens through the idempotent redemption endpoint", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({
        data: {
          consumed: true,
          delivery: {
            id: "delivery-1",
            deliveryToken: "egt-token",
            consumedAt: "2026-04-28T00:00:00.000Z",
          },
        },
      }),
    );
    const client = new SnsAgentClient({
      baseUrl: "http://api.test",
      apiKey: "sdk-key",
      fetch: fetch as unknown as typeof globalThis.fetch,
    });

    const result = await client.engagementGates.consumeDeliveryToken("gate-1", {
      deliveryToken: "egt-token",
    });

    expect(result.data.consumed).toBe(true);
    const [, init] = fetch.mock.calls[0] ?? [];
    expect(fetch.mock.calls[0]?.[0]).toBe(
      "http://api.test/api/engagement-gates/gate-1/deliveries/consume",
    );
    expect(init).toMatchObject({
      method: "POST",
      headers: expect.objectContaining({
        Authorization: "Bearer sdk-key",
        "X-Idempotency-Key": expect.any(String),
      }),
      body: JSON.stringify({ deliveryToken: "egt-token" }),
    });
  });
});

describe("SnsAgentClient X parity resources", () => {
  it("lists and syncs followers with typed filters and cursor payloads", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: "follower-1",
              workspaceId: "workspace-1",
              socialAccountId: "acct-1",
              platform: "x",
              externalUserId: "x-user-1",
              displayName: "Alice",
              username: "alice",
              isFollowing: true,
              isFollowed: true,
              unfollowedAt: null,
              metadata: null,
              lastSeenAt: "2026-04-29T00:00:00.000Z",
              createdAt: "2026-04-29T00:00:00.000Z",
              updatedAt: "2026-04-29T00:00:00.000Z",
            },
          ],
          meta: { limit: 50, offset: 10, total: 1 },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            followerCount: 1,
            followingCount: 1,
            nextFollowersCursor: "next-followers",
            nextFollowingCursor: null,
            markedUnfollowedCount: 0,
            markedUnfollowingCount: 0,
          },
        }),
      );
    const client = new SnsAgentClient({
      baseUrl: "http://api.test",
      apiKey: "sdk-key",
      fetch: fetch as unknown as typeof globalThis.fetch,
    });

    const listed = await client.followers.list({
      socialAccountId: "acct-1",
      tagId: "tag-1",
      isFollowed: true,
      isFollowing: false,
      limit: 50,
      offset: 10,
    });
    const synced = await client.followers.sync({
      socialAccountId: "acct-1",
      limit: 100,
      followersCursor: "cursor-a",
      followingCursor: null,
    });

    expect(listed.data[0]?.username).toBe("alice");
    expect(synced.data.nextFollowersCursor).toBe("next-followers");
    expect(fetch.mock.calls[0]?.[0]).toBe(
      "http://api.test/api/followers?socialAccountId=acct-1&tagId=tag-1&isFollowed=true&isFollowing=false&limit=50&offset=10",
    );
    expect(fetch.mock.calls[1]?.[0]).toBe("http://api.test/api/followers/sync");
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({
        socialAccountId: "acct-1",
        limit: 100,
        followersCursor: "cursor-a",
        followingCursor: null,
      }),
    });
  });

  it("manages follower tags without falling back to raw request calls", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: "tag-1",
              workspaceId: "workspace-1",
              socialAccountId: "acct-1",
              name: "VIP",
              color: "#123456",
              createdAt: "2026-04-29T00:00:00.000Z",
              updatedAt: "2026-04-29T00:00:00.000Z",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            id: "tag-2",
            workspaceId: "workspace-1",
            socialAccountId: "acct-1",
            name: "New",
            color: null,
            createdAt: "2026-04-29T00:00:00.000Z",
            updatedAt: "2026-04-29T00:00:00.000Z",
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: { success: true } }))
      .mockResolvedValueOnce(jsonResponse({ data: { success: true } }));
    const client = new SnsAgentClient({
      baseUrl: "http://api.test",
      apiKey: "sdk-key",
      fetch: fetch as unknown as typeof globalThis.fetch,
    });

    await client.tags.list({ socialAccountId: "acct-1" });
    await client.tags.create({ socialAccountId: "acct-1", name: "New", color: null });
    await client.followers.attachTag("follower-1", "tag-2", { socialAccountId: "acct-1" });
    await client.followers.detachTag("follower-1", "tag-2", { socialAccountId: "acct-1" });

    expect(fetch.mock.calls.map((call) => call[0])).toEqual([
      "http://api.test/api/tags?socialAccountId=acct-1",
      "http://api.test/api/tags",
      "http://api.test/api/followers/follower-1/tags/tag-2",
      "http://api.test/api/followers/follower-1/tags/tag-2",
    ]);
    expect(fetch.mock.calls[3]?.[1]).toMatchObject({
      method: "DELETE",
      body: JSON.stringify({ socialAccountId: "acct-1" }),
    });
  });

  it("reads follower analytics and captures snapshots", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            currentCount: 20,
            delta7Days: 3,
            delta30Days: null,
            series: [{ date: "2026-04-29", followerCount: 20, followingCount: 9 }],
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            snapshot: {
              id: "snapshot-1",
              workspaceId: "workspace-1",
              socialAccountId: "acct-1",
              platform: "x",
              snapshotDate: "2026-04-29",
              followerCount: 20,
              followingCount: 9,
              capturedAt: "2026-04-29T00:00:00.000Z",
              createdAt: "2026-04-29T00:00:00.000Z",
              updatedAt: "2026-04-29T00:00:00.000Z",
            },
            created: true,
          },
        }),
      );
    const client = new SnsAgentClient({
      baseUrl: "http://api.test",
      apiKey: "sdk-key",
      fetch: fetch as unknown as typeof globalThis.fetch,
    });

    const analytics = await client.followerAnalytics.get({
      socialAccountId: "acct-1",
      asOfDate: "2026-04-29",
    });
    const captured = await client.followerAnalytics.captureSnapshot({
      socialAccountId: "acct-1",
      capturedAt: "2026-04-29T00:00:00.000Z",
    });

    expect(analytics.data.series[0]?.followerCount).toBe(20);
    expect(captured.data.created).toBe(true);
    expect(fetch.mock.calls[0]?.[0]).toBe(
      "http://api.test/api/analytics/followers?socialAccountId=acct-1&asOfDate=2026-04-29",
    );
    expect(fetch.mock.calls[1]?.[0]).toBe("http://api.test/api/analytics/followers/snapshot");
  });

  it("covers engagement gate list update delete and processing endpoints", async () => {
    const gate = {
      id: "gate-1",
      workspaceId: "workspace-1",
      socialAccountId: "acct-1",
      platform: "x",
      name: "Launch",
      status: "active",
      triggerType: "reply",
      triggerPostId: "tweet-1",
      conditions: { requireLike: true },
      actionType: "dm",
      actionText: "Thanks",
      lineHarnessUrl: null,
      lineHarnessApiKeyRef: null,
      lineHarnessTag: null,
      lineHarnessScenario: null,
      stealthConfig: { jitterMinSeconds: 1, jitterMaxSeconds: 5 },
      deliveryBackoffUntil: null,
      lastReplySinceId: null,
      createdBy: "user-1",
      createdAt: "2026-04-29T00:00:00.000Z",
      updatedAt: "2026-04-29T00:00:00.000Z",
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: [gate] }))
      .mockResolvedValueOnce(jsonResponse({ data: gate }))
      .mockResolvedValueOnce(
        jsonResponse({ data: { processed: 1, delivered: 1, skipped: 0, failed: 0 } }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: { success: true } }));
    const client = new SnsAgentClient({
      baseUrl: "http://api.test",
      apiKey: "sdk-key",
      fetch: fetch as unknown as typeof globalThis.fetch,
    });

    await client.engagementGates.list({ socialAccountId: "acct-1", status: "active", limit: 20 });
    await client.engagementGates.update("gate-1", {
      status: "paused",
      stealthConfig: { jitterMinSeconds: 2, jitterMaxSeconds: 8 },
    });
    await client.engagementGates.process({ limit: 5 });
    await client.engagementGates.delete("gate-1");

    expect(fetch.mock.calls.map((call) => call[0])).toEqual([
      "http://api.test/api/engagement-gates?socialAccountId=acct-1&status=active&limit=20",
      "http://api.test/api/engagement-gates/gate-1",
      "http://api.test/api/engagement-gates/process",
      "http://api.test/api/engagement-gates/gate-1",
    ]);
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({
      method: "PATCH",
      body: JSON.stringify({
        status: "paused",
        stealthConfig: { jitterMinSeconds: 2, jitterMaxSeconds: 8 },
      }),
    });
  });

  it("creates campaigns and acts on quote tweets with typed SDK resources", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            id: "gate-1",
            mode: "draft",
            post: { id: "post-1" },
            gate: { id: "gate-1" },
            schedule: null,
            verifyUrl: "/api/engagement-gates/gate-1/verify",
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: "quote-1", quoteTweetId: "tweet-quote-1", authorExternalId: "author-1" }],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: { quote: { id: "quote-1", lastActionType: "reply" }, externalActionId: "reply-1" },
        }),
      );
    const client = new SnsAgentClient({
      baseUrl: "http://api.test",
      apiKey: "sdk-key",
      fetch: fetch as unknown as typeof globalThis.fetch,
    });

    const campaign = await client.campaigns.create({
      socialAccountId: "acct-1",
      name: "Launch",
      mode: "draft",
      post: { contentText: "hello x" },
      conditions: { requireLike: true },
      actionType: "verify_only",
      lineHarnessUrl: "https://line.example/launch",
    });
    const quotes = await client.quoteTweets.list({ socialAccountId: "acct-1", limit: 25 });
    const action = await client.quoteTweets.action("quote-1", {
      actionType: "reply",
      contentText: "thank you",
    });

    expect(campaign.data.verifyUrl).toBe("/api/engagement-gates/gate-1/verify");
    expect(quotes.data[0]?.quoteTweetId).toBe("tweet-quote-1");
    expect(action.data.externalActionId).toBe("reply-1");
    expect(fetch.mock.calls.map((call) => call[0])).toEqual([
      "http://api.test/api/campaigns",
      "http://api.test/api/quote-tweets?socialAccountId=acct-1&limit=25",
      "http://api.test/api/quote-tweets/quote-1/actions",
    ]);
  });

  it("exposes planned step sequence resources for MCP and agent callers", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      .mockResolvedValueOnce(jsonResponse({ data: { id: "sequence-1", name: "Warmup" } }))
      .mockResolvedValueOnce(
        jsonResponse({ data: { id: "enrollment-1", sequenceId: "sequence-1" } }),
      );
    const client = new SnsAgentClient({
      baseUrl: "http://api.test",
      apiKey: "sdk-key",
      fetch: fetch as unknown as typeof globalThis.fetch,
    });

    await client.stepSequences.list({ socialAccountId: "acct-1", status: "active", limit: 10 });
    await client.stepSequences.create({
      socialAccountId: "acct-1",
      name: "Warmup",
      messages: [{ delaySeconds: 60, actionType: "dm", contentText: "hello" }],
    });
    await client.stepSequences.enroll("sequence-1", {
      externalUserId: "x-user-1",
      username: "alice",
    });

    expect(fetch.mock.calls.map((call) => call[0])).toEqual([
      "http://api.test/api/step-sequences?socialAccountId=acct-1&status=active&limit=10",
      "http://api.test/api/step-sequences",
      "http://api.test/api/step-sequences/sequence-1/enrollments",
    ]);
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({
        socialAccountId: "acct-1",
        name: "Warmup",
        messages: [{ delaySeconds: 60, actionType: "dm", contentText: "hello" }],
      }),
    });
  });
});
