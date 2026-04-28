import { describe, expect, it, vi } from "vitest";
import { SnsAgentClient } from "./client.js";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("SnsAgentClient engagement gates resource", () => {
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
