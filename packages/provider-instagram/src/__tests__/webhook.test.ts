/**
 * provider-instagram: webhook 署名検証 + イベント解析のテスト
 */
import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { handleWebhook, verifySignature } from "../webhook.js";

const APP_SECRET = "app-secret-xyz";

function sign(body: string): string {
  return "sha256=" + createHmac("sha256", APP_SECRET).update(body, "utf8").digest("hex");
}

describe("verifySignature", () => {
  it("accepts a correct HMAC-SHA256 signature", () => {
    const body = '{"object":"instagram","entry":[]}';
    expect(verifySignature(body, sign(body), APP_SECRET)).toBe(true);
  });

  it("rejects an incorrect signature", () => {
    expect(verifySignature("payload", "sha256=deadbeef", APP_SECRET)).toBe(false);
  });

  it("rejects a missing signature header", () => {
    expect(verifySignature("payload", undefined, APP_SECRET)).toBe(false);
  });

  it("rejects a signature without sha256= prefix", () => {
    expect(verifySignature("payload", "abcdef", APP_SECRET)).toBe(false);
  });
});

describe("handleWebhook", () => {
  it("returns verified=false and no events for bad signature", () => {
    const body = JSON.stringify({ object: "instagram", entry: [] });
    const result = handleWebhook(
      {
        headers: { "x-hub-signature-256": "sha256=wrong" },
        body,
      },
      { appSecret: APP_SECRET },
    );
    expect(result.verified).toBe(false);
    expect(result.events).toHaveLength(0);
  });

  it("parses DM messaging events into WebhookEvent[]", () => {
    const body = JSON.stringify({
      object: "instagram",
      entry: [
        {
          id: "ig-user-1",
          time: 1700000000,
          messaging: [
            {
              sender: { id: "user-A" },
              recipient: { id: "ig-user-1" },
              timestamp: 1700000000,
              message: { mid: "mid-1", text: "hello" },
            },
          ],
        },
      ],
    });
    const result = handleWebhook(
      {
        headers: { "x-hub-signature-256": sign(body) },
        body,
      },
      { appSecret: APP_SECRET },
    );
    expect(result.verified).toBe(true);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].type).toBe("message");
    expect(result.events[0].externalMessageId).toBe("mid-1");
  });

  it("parses comment change events", () => {
    const body = JSON.stringify({
      object: "instagram",
      entry: [
        {
          id: "ig-user-1",
          time: 1700000000,
          changes: [
            {
              field: "comments",
              value: {
                id: "comment-1",
                text: "nice",
                from: { id: "user-B", username: "bob" },
                media: { id: "media-1" },
              },
            },
          ],
        },
      ],
    });
    const result = handleWebhook(
      {
        headers: { "X-Hub-Signature-256": sign(body) },
        body,
      },
      { appSecret: APP_SECRET },
    );
    expect(result.verified).toBe(true);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].type).toBe("postback");
    expect(result.events[0].externalMessageId).toBe("comment-1");
    expect(result.events[0].externalThreadId).toBe("media-1");
  });
});
