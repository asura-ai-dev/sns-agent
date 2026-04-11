/**
 * XApiClient のテスト: レート制限ヘッダ解析と ProviderError / RateLimitError 変換
 */
import { describe, it, expect } from "vitest";
import { XApiClient } from "../http-client.js";

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
          headers: { "x-rate-limit-remaining": "0" },
        }),
    });

    await expect(httpClient.request({ method: "GET", path: "/2/ping" })).rejects.toMatchObject({
      code: "PROVIDER_RATE_LIMIT",
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
