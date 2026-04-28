/**
 * XApiClient のテスト: レート制限ヘッダ解析と ProviderError / RateLimitError 変換
 */
import { describe, it, expect } from "vitest";
import { XApiClient } from "../http-client.js";
import { XApi } from "../x-api.js";

describe("XApiClient", () => {
  it("parses rate limit headers", async () => {
    const httpClient = new XApiClient({
      fetchImpl: async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            "x-rate-limit-remaining": "42",
            "x-rate-limit-limit": "100",
            "x-rate-limit-reset": "1700000000",
            "content-type": "application/json",
          },
        }),
    });

    const res = await httpClient.request<{ ok: boolean }>({ method: "GET", path: "/2/ping" });
    expect(res.data.ok).toBe(true);
    expect(res.rateLimit.remaining).toBe(42);
    expect(res.rateLimit.limit).toBe(100);
    expect(res.rateLimit.resetAt).toBe(1700000000);
  });

  it("throws RateLimitError on 429", async () => {
    const httpClient = new XApiClient({
      fetchImpl: async () =>
        new Response(JSON.stringify({ detail: "Too Many Requests" }), {
          status: 429,
          headers: { "x-rate-limit-remaining": "0", "retry-after": "60" },
        }),
    });

    await expect(httpClient.request({ method: "GET", path: "/2/ping" })).rejects.toMatchObject({
      code: "PROVIDER_RATE_LIMIT",
      details: {
        retryAfterSeconds: 60,
        rateLimit: {
          remaining: 0,
        },
      },
    });
  });

  it("throws ProviderError on other non-2xx responses", async () => {
    const httpClient = new XApiClient({
      fetchImpl: async () =>
        new Response(JSON.stringify({ title: "Bad Request", detail: "bad" }), { status: 400 }),
    });

    await expect(httpClient.request({ method: "GET", path: "/2/ping" })).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
    });
  });

  it("converts fetch exceptions to ProviderError", async () => {
    const httpClient = new XApiClient({
      fetchImpl: async () => {
        throw new Error("network down");
      },
    });

    await expect(httpClient.request({ method: "GET", path: "/2/ping" })).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
    });
  });

  it("sends Authorization header when accessToken is provided", async () => {
    let captured: Record<string, string> = {};
    const httpClient = new XApiClient({
      fetchImpl: async (_url, init) => {
        captured = init.headers as Record<string, string>;
        return new Response("{}", { status: 200 });
      },
    });

    await httpClient.request({ method: "GET", path: "/2/me", accessToken: "tok-abc" });
    expect(captured["Authorization"]).toBe("Bearer tok-abc");
  });
});

describe("XApi", () => {
  function buildApi(
    responder: (url: string, init: RequestInit) => { status?: number; body?: unknown },
  ): {
    api: XApi;
    calls: Array<{ url: string; init: RequestInit }>;
  } {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const httpClient = new XApiClient({
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        const response = responder(url, init);
        return new Response(JSON.stringify(response.body ?? {}), {
          status: response.status ?? 200,
          headers: {
            "x-rate-limit-remaining": "12",
            "x-rate-limit-limit": "15",
            "x-rate-limit-reset": "1700000000",
          },
        });
      },
    });
    return { api: new XApi(httpClient, "tok-abc"), calls };
  }

  it("calls users/me with typed response and rate metadata", async () => {
    const { api, calls } = buildApi(() => ({
      body: { data: { id: "u-1", name: "Alice", username: "alice" } },
    }));

    const res = await api.getMe();

    expect(res.data.data?.username).toBe("alice");
    expect(res.rateLimit.remaining).toBe(12);
    expect(calls[0]?.url).toBe("https://api.twitter.com/2/users/me");
    expect(calls[0]?.init.method).toBe("GET");
  });

  it("creates replies and quotes through /2/tweets", async () => {
    const { api, calls } = buildApi(() => ({
      status: 201,
      body: { data: { id: "tweet-1", text: "hello" } },
    }));

    const res = await api.createTweet({
      text: "hello",
      reply: { inReplyToTweetId: "parent-1" },
      quoteTweetId: "quote-1",
    });

    expect(res.data.data?.id).toBe("tweet-1");
    expect(calls[0]?.url).toBe("https://api.twitter.com/2/tweets");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      text: "hello",
      reply: { in_reply_to_tweet_id: "parent-1" },
      quote_tweet_id: "quote-1",
    });
  });

  it("covers tweet lookup search mentions and delete endpoints", async () => {
    const { api, calls } = buildApi(() => ({ body: { data: [] } }));

    await api.getTweet("tweet/1", { tweetFields: ["created_at", "author_id"] });
    await api.searchRecentTweets({ query: "from:alice", maxResults: 10, nextToken: "next-1" });
    await api.getMentions("u/1", { sinceId: "since-1", maxResults: 25 });
    await api.deleteTweet("tweet/1");

    expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
      "/2/tweets/tweet%2F1",
      "/2/tweets/search/recent",
      "/2/users/u%2F1/mentions",
      "/2/tweets/tweet%2F1",
    ]);
    expect(new URL(calls[0]!.url).searchParams.get("tweet.fields")).toBe("created_at,author_id");
    expect(new URL(calls[1]!.url).searchParams.get("query")).toBe("from:alice");
    expect(new URL(calls[2]!.url).searchParams.get("since_id")).toBe("since-1");
    expect(calls[3]?.init.method).toBe("DELETE");
  });

  it("covers liking users retweeted by followers and following lookups", async () => {
    const { api, calls } = buildApi(() => ({ body: { data: [] } }));

    await api.getLikingUsers("tweet-1", { userFields: ["username"] });
    await api.getRetweetedBy("tweet-1", { userFields: ["username"] });
    await api.getFollowers("u-1", { maxResults: 100 });
    await api.getFollowing("u-1", { maxResults: 100 });

    expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
      "/2/tweets/tweet-1/liking_users",
      "/2/tweets/tweet-1/retweeted_by",
      "/2/users/u-1/followers",
      "/2/users/u-1/following",
    ]);
    expect(new URL(calls[0]!.url).searchParams.get("user.fields")).toBe("username");
  });

  it("covers like repost and follow mutations", async () => {
    const { api, calls } = buildApi(() => ({ body: { data: { liked: true } } }));

    await api.likeTweet("u-1", "tweet-1");
    await api.unlikeTweet("u-1", "tweet-1");
    await api.repostTweet("u-1", "tweet-1");
    await api.undoRepostTweet("u-1", "tweet-1");
    await api.followUser("u-1", "target-1");
    await api.unfollowUser("u-1", "target-1");

    expect(calls.map((call) => `${call.init.method} ${new URL(call.url).pathname}`)).toEqual([
      "POST /2/users/u-1/likes",
      "DELETE /2/users/u-1/likes/tweet-1",
      "POST /2/users/u-1/retweets",
      "DELETE /2/users/u-1/retweets/tweet-1",
      "POST /2/users/u-1/following",
      "DELETE /2/users/u-1/following/target-1",
    ]);
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ tweet_id: "tweet-1" });
    expect(JSON.parse(String(calls[2]?.init.body))).toEqual({ tweet_id: "tweet-1" });
    expect(JSON.parse(String(calls[4]?.init.body))).toEqual({ target_user_id: "target-1" });
  });

  it("covers DM event lookup conversation messages and quote lookup", async () => {
    const { api, calls } = buildApi(() => ({ body: { data: [] } }));

    await api.getDmEvents({ maxResults: 20 });
    await api.getDmConversationEvents("participant/1", { maxResults: 20 });
    await api.sendDmToParticipant("participant/1", { text: "hello" });
    await api.sendDmToConversation("conversation/1", { text: "hello" });
    await api.createDmConversation({ conversationType: "Group", participantIds: ["u-2"] });
    await api.getQuoteTweets("tweet/1", { maxResults: 10 });

    expect(calls.map((call) => `${call.init.method} ${new URL(call.url).pathname}`)).toEqual([
      "GET /2/dm_events",
      "GET /2/dm_conversations/with/participant%2F1/dm_events",
      "POST /2/dm_conversations/with/participant%2F1/messages",
      "POST /2/dm_conversations/conversation%2F1/messages",
      "POST /2/dm_conversations",
      "GET /2/tweets/tweet%2F1/quote_tweets",
    ]);
    expect(JSON.parse(String(calls[2]?.init.body))).toEqual({ text: "hello" });
  });
});
