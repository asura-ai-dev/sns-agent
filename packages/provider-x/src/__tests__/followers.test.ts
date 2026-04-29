import { describe, expect, it } from "vitest";
import { XProvider } from "../index.js";
import { XApiClient } from "../http-client.js";

describe("XProvider followers", () => {
  it("lists followers through the typed X API client", async () => {
    const requests: string[] = [];
    const httpClient = new XApiClient({
      fetchImpl: async (url) => {
        requests.push(url);
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "42",
                name: "Alice",
                username: "alice",
                verified: true,
                public_metrics: { followers_count: 10 },
              },
            ],
            meta: { next_token: "next-1" },
          }),
          { status: 200 },
        );
      },
    });
    const provider = new XProvider({ oauth: { clientId: "cid" }, httpClient });

    const result = await provider.listFollowers!({
      accountCredentials: JSON.stringify({ accessToken: "tok", xUserId: "123" }),
      limit: 50,
      cursor: "cursor-1",
    });

    expect(requests).toHaveLength(1);
    const url = new URL(requests[0]!);
    expect(url.pathname).toBe("/2/users/123/followers");
    expect(url.searchParams.get("max_results")).toBe("50");
    expect(url.searchParams.get("pagination_token")).toBe("cursor-1");
    expect(result.nextCursor).toBe("next-1");
    expect(result.profiles[0]).toMatchObject({
      externalUserId: "42",
      displayName: "Alice",
      username: "alice",
      metadata: {
        verified: true,
        publicMetrics: { followers_count: 10 },
      },
    });
  });

  it("lists following through the typed X API client", async () => {
    const requests: string[] = [];
    const httpClient = new XApiClient({
      fetchImpl: async (url) => {
        requests.push(url);
        return new Response(
          JSON.stringify({
            data: [{ id: "84", name: "Bob", username: "bob" }],
          }),
          { status: 200 },
        );
      },
    });
    const provider = new XProvider({ oauth: { clientId: "cid" }, httpClient });

    const result = await provider.listFollowing!({
      accountCredentials: JSON.stringify({ accessToken: "tok", xUserId: "123" }),
      limit: 25,
    });

    expect(new URL(requests[0]!).pathname).toBe("/2/users/123/following");
    expect(result.nextCursor).toBeNull();
    expect(result.profiles[0]?.externalUserId).toBe("84");
  });
});
