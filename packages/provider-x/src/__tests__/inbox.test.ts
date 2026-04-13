import { describe, expect, it } from "vitest";
import { XProvider } from "../index.js";
import { XApiClient } from "../http-client.js";

function buildClient(
  responder: (url: string, init?: RequestInit) => { status: number; body?: unknown },
): XApiClient {
  return new XApiClient({
    fetchImpl: async (url: string, init?: RequestInit) => {
      const res = responder(url, init);
      return new Response(JSON.stringify(res.body ?? {}), { status: res.status });
    },
  });
}

describe("XProvider inbox", () => {
  it("groups mentions by conversation and returns a resumable cursor", async () => {
    const httpClient = buildClient((url) => {
      if (url.includes("/2/users/123/mentions")) {
        return {
          status: 200,
          body: {
            data: [
              {
                id: "200",
                text: "@brand 返信です",
                author_id: "42",
                conversation_id: "100",
                created_at: "2026-04-10T10:05:00.000Z",
                referenced_tweets: [{ type: "replied_to", id: "150" }],
              },
              {
                id: "199",
                text: "@brand 最初のメンション",
                author_id: "42",
                conversation_id: "100",
                created_at: "2026-04-10T10:00:00.000Z",
              },
            ],
            includes: {
              users: [{ id: "42", name: "Alice", username: "alice" }],
            },
            meta: { next_token: "next-1" },
          },
        };
      }
      if (url.includes("/2/dm_events")) {
        return {
          status: 200,
          body: {
            data: [],
          },
        };
      }
      throw new Error(`unexpected url: ${url}`);
    });
    const provider = new XProvider({ oauth: { clientId: "cid" }, httpClient });

    const result = await provider.listThreads!({
      accountCredentials: JSON.stringify({ accessToken: "tok", xUserId: "123" }),
      limit: 20,
    });

    expect(result.threads).toHaveLength(1);
    expect(result.threads[0]?.externalThreadId).toBe("100");
    expect(result.threads[0]?.providerMetadata?.x?.entryType).toBe("reply");
    expect(result.nextCursor).toContain("next-1");
    expect(result.nextCursor).toContain("200");
  });

  it("fetches thread messages and marks self tweets as outbound", async () => {
    const httpClient = buildClient((url) => {
      if (url.includes("/2/tweets/search/recent")) {
        return {
          status: 200,
          body: {
            data: [
              {
                id: "199",
                text: "@brand 最初のメンション",
                author_id: "42",
                conversation_id: "100",
                created_at: "2026-04-10T10:00:00.000Z",
              },
              {
                id: "200",
                text: "ありがとう！",
                author_id: "123",
                conversation_id: "100",
                created_at: "2026-04-10T10:05:00.000Z",
                referenced_tweets: [{ type: "replied_to", id: "199" }],
              },
            ],
            includes: {
              users: [
                { id: "42", name: "Alice", username: "alice" },
                { id: "123", name: "Brand", username: "brand" },
              ],
            },
          },
        };
      }
      throw new Error(`unexpected url: ${url}`);
    });
    const provider = new XProvider({ oauth: { clientId: "cid" }, httpClient });

    const result = await provider.getMessages!({
      accountCredentials: JSON.stringify({ accessToken: "tok", xUserId: "123" }),
      externalThreadId: "100",
      limit: 20,
    });

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]?.direction).toBe("inbound");
    expect(result.messages[1]?.direction).toBe("outbound");
    expect(result.messages[1]?.providerMetadata?.x?.replyToPostId).toBe("199");
  });

  it("lists DM conversations alongside mentions", async () => {
    const httpClient = buildClient((url) => {
      if (url.includes("/2/users/123/mentions")) {
        return { status: 200, body: { data: [] } };
      }
      if (url.includes("/2/dm_events")) {
        return {
          status: 200,
          body: {
            data: [
              {
                id: "dm-2",
                text: "商品の相談です",
                sender_id: "42",
                dm_conversation_id: "123-42",
                created_at: "2026-04-10T11:05:00.000Z",
              },
            ],
            includes: {
              users: [{ id: "42", name: "Alice", username: "alice" }],
            },
            meta: { next_token: "dm-next-1" },
          },
        };
      }
      throw new Error(`unexpected url: ${url}`);
    });
    const provider = new XProvider({ oauth: { clientId: "cid" }, httpClient });

    const result = await provider.listThreads!({
      accountCredentials: JSON.stringify({ accessToken: "tok", xUserId: "123" }),
      limit: 20,
    });

    expect(result.threads).toHaveLength(1);
    expect(result.threads[0]?.externalThreadId).toBe("dm:42");
    expect(result.threads[0]?.channel).toBe("direct");
    expect(result.threads[0]?.providerMetadata?.x?.entryType).toBe("dm");
    expect(result.nextCursor).toContain("dm-next-1");
  });

  it("fetches DM messages with media attachments", async () => {
    const httpClient = buildClient((url) => {
      if (url.includes("/2/dm_conversations/with/42/dm_events")) {
        return {
          status: 200,
          body: {
            data: [
              {
                id: "dm-1",
                text: "写真を送ります",
                sender_id: "42",
                dm_conversation_id: "123-42",
                created_at: "2026-04-10T10:00:00.000Z",
                attachments: { media_keys: ["3_1"] },
              },
              {
                id: "dm-2",
                text: "受け取りました",
                sender_id: "123",
                dm_conversation_id: "123-42",
                created_at: "2026-04-10T10:05:00.000Z",
              },
            ],
            includes: {
              users: [
                { id: "42", name: "Alice", username: "alice" },
                { id: "123", name: "Brand", username: "brand" },
              ],
              media: [
                {
                  media_key: "3_1",
                  type: "photo",
                  url: "https://example.com/image.jpg",
                },
              ],
            },
          },
        };
      }
      throw new Error(`unexpected url: ${url}`);
    });
    const provider = new XProvider({ oauth: { clientId: "cid" }, httpClient });

    const result = await provider.getMessages!({
      accountCredentials: JSON.stringify({ accessToken: "tok", xUserId: "123" }),
      externalThreadId: "dm:42",
      limit: 20,
    });

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]?.direction).toBe("inbound");
    expect(result.messages[0]?.contentMedia).toEqual([
      {
        type: "image",
        url: "https://example.com/image.jpg",
        mimeType: "image/jpeg",
      },
    ]);
    expect(result.messages[1]?.direction).toBe("outbound");
  });

  it("sends a reply tweet using in_reply_to_tweet_id", async () => {
    let capturedBody: unknown;
    const httpClient = new XApiClient({
      fetchImpl: async (_url: string, init?: RequestInit) => {
        capturedBody = init?.body ? JSON.parse(String(init.body)) : null;
        return new Response(JSON.stringify({ data: { id: "201" } }), { status: 201 });
      },
    });
    const provider = new XProvider({ oauth: { clientId: "cid" }, httpClient });

    const result = await provider.sendReply!({
      accountCredentials: JSON.stringify({ accessToken: "tok", xUserId: "123" }),
      externalThreadId: "100",
      replyToMessageId: "200",
      contentText: "了解しました",
    });

    expect(result.success).toBe(true);
    expect(result.externalMessageId).toBe("201");
    expect(capturedBody).toEqual({
      text: "了解しました",
      reply: {
        in_reply_to_tweet_id: "200",
      },
    });
  });

  it("sends a DM reply using participant endpoint", async () => {
    let capturedBody: unknown;
    const httpClient = new XApiClient({
      fetchImpl: async (_url: string, init?: RequestInit) => {
        capturedBody = init?.body ? JSON.parse(String(init.body)) : null;
        return new Response(JSON.stringify({ data: { dm_event_id: "dm-201" } }), { status: 201 });
      },
    });
    const provider = new XProvider({ oauth: { clientId: "cid" }, httpClient });

    const result = await provider.sendReply!({
      accountCredentials: JSON.stringify({ accessToken: "tok", xUserId: "123" }),
      externalThreadId: "dm:42",
      contentText: "お問い合わせありがとうございます",
    });

    expect(result.success).toBe(true);
    expect(result.externalMessageId).toBe("dm-201");
    expect(capturedBody).toEqual({
      text: "お問い合わせありがとうございます",
    });
  });

  it("sends a media-only DM reply without an empty text field", async () => {
    let capturedBody: unknown;
    const httpClient = new XApiClient({
      fetchImpl: async (_url: string, init?: RequestInit) => {
        capturedBody = init?.body ? JSON.parse(String(init.body)) : null;
        return new Response(JSON.stringify({ data: { dm_event_id: "dm-202" } }), { status: 201 });
      },
    });
    const provider = new XProvider({ oauth: { clientId: "cid" }, httpClient });

    const result = await provider.sendReply!({
      accountCredentials: JSON.stringify({ accessToken: "tok", xUserId: "123" }),
      externalThreadId: "dm:42",
      contentText: "   ",
      contentMedia: [
        {
          type: "image",
          url: "media-1",
          mimeType: "image/png",
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.externalMessageId).toBe("dm-202");
    expect(capturedBody).toEqual({
      attachments: [{ media_id: "media-1" }],
    });
  });
});
