import { describe, expect, it } from "vitest";
import { XProvider } from "../index.js";
import { XApiClient } from "../http-client.js";

function buildClient(
  responder: (url: string, init?: RequestInit) => { status: number; body?: unknown },
): { client: XApiClient; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    client: new XApiClient({
      fetchImpl: async (url: string, init?: RequestInit) => {
        calls.push(`${init?.method ?? "GET"} ${url}`);
        const res = responder(url, init);
        return new Response(JSON.stringify(res.body ?? {}), { status: res.status });
      },
    }),
  };
}

describe("XProvider engagement gates", () => {
  it("lists reply-trigger mentions with since_id and maps authors", async () => {
    const { client, calls } = buildClient((url) => {
      if (url.includes("/2/users/brand-x/mentions")) {
        return {
          status: 200,
          body: {
            data: [
              {
                id: "tweet-10",
                text: "@brand secret",
                author_id: "user-1",
                conversation_id: "tweet-root-1",
                created_at: "2026-04-28T00:10:00.000Z",
                referenced_tweets: [{ type: "replied_to", id: "tweet-root-1" }],
              },
              {
                id: "tweet-9",
                text: "@brand unrelated",
                author_id: "user-2",
                conversation_id: "other-root",
                created_at: "2026-04-28T00:09:00.000Z",
              },
            ],
            includes: {
              users: [{ id: "user-1", name: "Alice", username: "alice" }],
            },
            meta: { newest_id: "tweet-10" },
          },
        };
      }
      throw new Error(`unexpected url: ${url}`);
    });
    const provider = new XProvider({ oauth: { clientId: "cid" }, httpClient: client });

    const result = await provider.listEngagementReplies!({
      accountCredentials: JSON.stringify({ accessToken: "tok", xUserId: "brand-x" }),
      accountExternalId: "brand-x",
      triggerPostId: "tweet-root-1",
      sinceId: "tweet-8",
      limit: 10,
    });

    expect(result).toEqual({
      replies: [
        {
          externalReplyId: "tweet-10",
          externalUserId: "user-1",
          username: "alice",
          text: "@brand secret",
          createdAt: new Date("2026-04-28T00:10:00.000Z"),
          conversationId: "tweet-root-1",
          inReplyToPostId: "tweet-root-1",
        },
      ],
      nextSinceId: "tweet-10",
    });
    expect(calls[0]).toContain("since_id=tweet-8");
  });

  it("lists reply-trigger mentions across all mention pages before advancing since_id", async () => {
    const { client, calls } = buildClient((url) => {
      if (url.includes("/2/users/brand-x/mentions")) {
        const requestUrl = new URL(url);
        if (!requestUrl.searchParams.has("pagination_token")) {
          return {
            status: 200,
            body: {
              data: [
                {
                  id: "tweet-12",
                  text: "@brand unrelated",
                  author_id: "user-2",
                  conversation_id: "other-root",
                  created_at: "2026-04-28T00:12:00.000Z",
                },
              ],
              meta: { newest_id: "tweet-12", next_token: "mentions-page-2" },
            },
          };
        }
        expect(requestUrl.searchParams.get("pagination_token")).toBe("mentions-page-2");
        return {
          status: 200,
          body: {
            data: [
              {
                id: "tweet-11",
                text: "@brand secret",
                author_id: "user-1",
                conversation_id: "tweet-root-1",
                created_at: "2026-04-28T00:11:00.000Z",
                referenced_tweets: [{ type: "replied_to", id: "tweet-root-1" }],
              },
            ],
            includes: {
              users: [{ id: "user-1", name: "Alice", username: "alice" }],
            },
            meta: { oldest_id: "tweet-11" },
          },
        };
      }
      throw new Error(`unexpected url: ${url}`);
    });
    const provider = new XProvider({ oauth: { clientId: "cid" }, httpClient: client });

    const result = await provider.listEngagementReplies!({
      accountCredentials: JSON.stringify({ accessToken: "tok", xUserId: "brand-x" }),
      accountExternalId: "brand-x",
      triggerPostId: "tweet-root-1",
      sinceId: "tweet-10",
      limit: 10,
    });

    expect(result).toEqual({
      replies: [
        {
          externalReplyId: "tweet-11",
          externalUserId: "user-1",
          username: "alice",
          text: "@brand secret",
          createdAt: new Date("2026-04-28T00:11:00.000Z"),
          conversationId: "tweet-root-1",
          inReplyToPostId: "tweet-root-1",
        },
      ],
      nextSinceId: "tweet-12",
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("since_id=tweet-10");
    expect(calls[1]).toContain("pagination_token=mentions-page-2");
  });

  it("checks like repost and follow conditions through typed X endpoints", async () => {
    const { client, calls } = buildClient((url) => {
      if (url.includes("/2/tweets/tweet-root-1/liking_users")) {
        return { status: 200, body: { data: [{ id: "user-1" }] } };
      }
      if (url.includes("/2/tweets/tweet-root-1/retweeted_by")) {
        return { status: 200, body: { data: [{ id: "user-1" }] } };
      }
      if (url.includes("/2/users/brand-x/followers")) {
        return { status: 200, body: { data: [{ id: "user-1" }] } };
      }
      throw new Error(`unexpected url: ${url}`);
    });
    const provider = new XProvider({ oauth: { clientId: "cid" }, httpClient: client });

    const result = await provider.checkEngagementConditions!({
      accountCredentials: JSON.stringify({ accessToken: "tok", xUserId: "brand-x" }),
      triggerPostId: "tweet-root-1",
      externalUserId: "user-1",
      conditions: {
        requireLike: true,
        requireRepost: true,
        requireFollow: true,
      },
    });

    expect(result).toEqual({ liked: true, reposted: true, followed: true });
    expect(calls.map((call) => new URL(call.split(" ")[1]!).pathname)).toEqual([
      "/2/tweets/tweet-root-1/liking_users",
      "/2/tweets/tweet-root-1/retweeted_by",
      "/2/users/brand-x/followers",
    ]);
  });

  it("finds eligible users on second pages of like repost and follow condition checks", async () => {
    const { client, calls } = buildClient((url) => {
      const requestUrl = new URL(url);
      const token = requestUrl.searchParams.get("pagination_token");
      if (url.includes("/2/tweets/tweet-root-1/liking_users")) {
        return token === "likes-page-2"
          ? { status: 200, body: { data: [{ id: "user-1" }] } }
          : {
              status: 200,
              body: { data: [{ id: "user-other-like" }], meta: { next_token: "likes-page-2" } },
            };
      }
      if (url.includes("/2/tweets/tweet-root-1/retweeted_by")) {
        return token === "reposts-page-2"
          ? { status: 200, body: { data: [{ id: "user-1" }] } }
          : {
              status: 200,
              body: {
                data: [{ id: "user-other-repost" }],
                meta: { next_token: "reposts-page-2" },
              },
            };
      }
      if (url.includes("/2/users/brand-x/followers")) {
        return token === "followers-page-2"
          ? { status: 200, body: { data: [{ id: "user-1" }] } }
          : {
              status: 200,
              body: {
                data: [{ id: "user-other-follower" }],
                meta: { next_token: "followers-page-2" },
              },
            };
      }
      throw new Error(`unexpected url: ${url}`);
    });
    const provider = new XProvider({ oauth: { clientId: "cid" }, httpClient: client });

    const result = await provider.checkEngagementConditions!({
      accountCredentials: JSON.stringify({ accessToken: "tok", xUserId: "brand-x" }),
      triggerPostId: "tweet-root-1",
      externalUserId: "user-1",
      conditions: {
        requireLike: true,
        requireRepost: true,
        requireFollow: true,
      },
    });

    expect(result).toEqual({ liked: true, reposted: true, followed: true });
    expect(calls.some((call) => call.includes("pagination_token=likes-page-2"))).toBe(true);
    expect(calls.some((call) => call.includes("pagination_token=reposts-page-2"))).toBe(true);
    expect(calls.some((call) => call.includes("pagination_token=followers-page-2"))).toBe(true);
  });
});
