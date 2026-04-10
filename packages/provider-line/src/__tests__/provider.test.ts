/**
 * LineProvider のテスト
 * - capabilities が仕様どおり
 * - validatePost の 5,000 文字制限
 * - publishPost (push) が正常に呼ばれる
 * - deletePost が ProviderError を投げる
 * - Webhook 署名検証
 */
import { describe, it, expect } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import {
  LineProvider,
  LINE_CAPABILITIES,
  verifyLineSignature,
  signAssertionJwt,
} from "../index.js";
import { LineApiClient } from "../http-client.js";
import { ProviderError } from "@sns-agent/core";
import { createHmac } from "node:crypto";

function buildClient(responses: Array<{ status: number; body?: unknown }>) {
  let i = 0;
  return new LineApiClient({
    fetchImpl: async () => {
      const r = responses[i++];
      const nullBodyStatus = r.status === 204 || r.status === 205 || r.status === 304;
      const body = nullBodyStatus ? null : r.body === undefined ? "" : JSON.stringify(r.body);
      return new Response(body, { status: r.status });
    },
  });
}

function makeRsaPem(): { privateKey: string; kid: string } {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { privateKey, kid: "test-kid" };
}

describe("LineProvider", () => {
  const { privateKey, kid } = makeRsaPem();
  const oauth = {
    channelId: "1234567890",
    assertionKid: kid,
    assertionPrivateKeyPem: privateKey,
    channelSecret: "secret-abc",
  };

  it("reports the expected capabilities", () => {
    const provider = new LineProvider({ oauth });
    expect(provider.getCapabilities()).toEqual({
      textPost: true,
      imagePost: true,
      videoPost: true,
      threadPost: false,
      directMessage: true,
      commentReply: false,
      broadcast: true,
      nativeSchedule: false,
      usageApi: false,
    });
    expect(LINE_CAPABILITIES.broadcast).toBe(true);
  });

  it("validatePost rejects text exceeding 5,000 characters", async () => {
    const provider = new LineProvider({ oauth });
    const tooLong = "a".repeat(5001);
    const result = await provider.validatePost({
      platform: "line",
      contentText: tooLong,
      contentMedia: null,
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.field).toBe("contentText");
  });

  it("validatePost accepts text within 5,000 characters", async () => {
    const provider = new LineProvider({ oauth });
    const result = await provider.validatePost({
      platform: "line",
      contentText: "hello",
      contentMedia: null,
    });
    expect(result.valid).toBe(true);
  });

  it("validatePost rejects empty content", async () => {
    const provider = new LineProvider({ oauth });
    const result = await provider.validatePost({
      platform: "line",
      contentText: null,
      contentMedia: null,
    });
    expect(result.valid).toBe(false);
  });

  it("publishPost (push) sends to /v2/bot/message/push and returns platformPostId", async () => {
    const httpClient = buildClient([{ status: 200, body: { sentMessages: [{ id: "msg-1" }] } }]);
    const provider = new LineProvider({ oauth, httpClient });

    const result = await provider.publishPost({
      accountCredentials: JSON.stringify({
        accessToken: "tok",
        defaultTargetId: "U1234",
      }),
      contentText: "hello",
      contentMedia: null,
    });
    expect(result.success).toBe(true);
    expect(result.platformPostId).toBe("msg-1");
  });

  it("publishPost (push) fails when targetId is missing", async () => {
    const httpClient = buildClient([]);
    const provider = new LineProvider({ oauth, httpClient });

    const result = await provider.publishPost({
      accountCredentials: JSON.stringify({ accessToken: "tok" }),
      contentText: "hello",
      contentMedia: null,
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/targetId/);
  });

  it("publishPost (broadcast) via extras works without targetId", async () => {
    const httpClient = buildClient([{ status: 200, body: {} }]);
    const provider = new LineProvider({ oauth, httpClient });

    const input = {
      accountCredentials: JSON.stringify({ accessToken: "tok" }),
      contentText: "hello world",
      contentMedia: null,
      extra: { mode: "broadcast" as const },
    };
    const result = await provider.publishPost(input as never);
    expect(result.success).toBe(true);
    expect(result.platformPostId).toMatch(/^line-broadcast-/);
  });

  it("deletePost throws ProviderError (unsupported)", async () => {
    const provider = new LineProvider({ oauth });
    await expect(
      provider.deletePost({ accountCredentials: "{}", platformPostId: "1" }),
    ).rejects.toBeInstanceOf(ProviderError);
  });

  it("handleWebhook verifies signature and normalizes events", async () => {
    const provider = new LineProvider({ oauth });
    const payload = {
      destination: "U-bot",
      events: [
        {
          type: "message",
          timestamp: 1_700_000_000_000,
          source: { type: "user", userId: "U-alice" },
          message: { id: "m-1", type: "text", text: "hi" },
          replyToken: "rt-1",
        },
        {
          type: "follow",
          source: { type: "user", userId: "U-bob" },
        },
      ],
    };
    const raw = JSON.stringify(payload);
    const signature = createHmac("sha256", oauth.channelSecret).update(raw).digest("base64");

    const result = await provider.handleWebhook({
      headers: { "x-line-signature": signature },
      body: raw,
    });
    expect(result.verified).toBe(true);
    expect(result.events).toHaveLength(2);
    expect(result.events[0]?.type).toBe("message");
    expect(result.events[0]?.externalThreadId).toBe("U-alice");
    expect(result.events[0]?.externalMessageId).toBe("m-1");
    expect(result.events[1]?.type).toBe("follow");
  });

  it("handleWebhook rejects tampered signature", async () => {
    const provider = new LineProvider({ oauth });
    const raw = JSON.stringify({ events: [] });
    const result = await provider.handleWebhook({
      headers: { "x-line-signature": "ZGVmaW5pdGVseS1ub3QtdmFsaWQ=" },
      body: raw,
    });
    expect(result.verified).toBe(false);
  });

  it("listThreads / getMessages return empty results with default store", async () => {
    const provider = new LineProvider({ oauth });
    const threads = await provider.listThreads({ accountCredentials: "{}" });
    expect(threads.threads).toEqual([]);
    const messages = await provider.getMessages({
      accountCredentials: "{}",
      externalThreadId: "U-x",
    });
    expect(messages.messages).toEqual([]);
  });

  it("connectAccount issues a channel access token via JWT", async () => {
    const httpClient = buildClient([
      {
        status: 200,
        body: {
          access_token: "line-token-xyz",
          expires_in: 2592000,
          token_type: "Bearer",
          key_id: "kid-xyz",
        },
      },
    ]);
    const provider = new LineProvider({ oauth, httpClient });

    const result = await provider.connectAccount({
      workspaceId: "ws-1",
      platform: "line",
      redirectUrl: "unused",
    });
    expect(result.account).toBeDefined();
    expect(result.account?.externalAccountId).toBe(oauth.channelId);
    expect(result.account?.tokenExpiresAt).toBeInstanceOf(Date);
    const creds = JSON.parse(result.account!.credentialsEncrypted) as { accessToken: string };
    expect(creds.accessToken).toBe("line-token-xyz");
  });

  it("refreshToken re-issues the channel access token", async () => {
    const httpClient = buildClient([
      {
        status: 200,
        body: {
          access_token: "line-token-new",
          expires_in: 2592000,
          token_type: "Bearer",
        },
      },
    ]);
    const provider = new LineProvider({ oauth, httpClient });
    const result = await provider.refreshToken("any-account-id");
    expect(result.success).toBe(true);
    const creds = JSON.parse(result.credentialsEncrypted ?? "{}") as { accessToken: string };
    expect(creds.accessToken).toBe("line-token-new");
  });
});

describe("verifyLineSignature / signAssertionJwt", () => {
  it("verifyLineSignature returns true on matching HMAC", () => {
    const secret = "s3cret";
    const body = "{}";
    const sig = createHmac("sha256", secret).update(body).digest("base64");
    expect(verifyLineSignature(body, sig, secret)).toBe(true);
  });

  it("verifyLineSignature returns false on mismatch", () => {
    expect(verifyLineSignature("{}", "abc", "secret")).toBe(false);
  });

  it("signAssertionJwt produces a JWT with three dot-separated segments", () => {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const jwt = signAssertionJwt(
      {
        iss: "cid",
        sub: "cid",
        aud: "https://api.line.me/",
        exp: Math.floor(Date.now() / 1000) + 600,
        token_exp: 60 * 60,
      },
      { kid: "k1", privateKeyPem: privateKey },
    );
    const parts = jwt.split(".");
    expect(parts).toHaveLength(3);
    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    expect(header.alg).toBe("RS256");
    expect(header.kid).toBe("k1");
  });
});
