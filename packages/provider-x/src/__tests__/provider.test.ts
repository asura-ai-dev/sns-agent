/**
 * XProvider のテスト
 * - SocialProvider インターフェースを満たすこと
 * - capability が仕様どおりであること
 * - connectAccount が OAuth 開始 / コールバック両方を処理できること
 */
import { describe, it, expect } from "vitest";
import { XProvider, X_CAPABILITIES } from "../index.js";
import { XApiClient } from "../http-client.js";

function buildClient(responses: Array<{ status: number; body?: unknown }>) {
  let i = 0;
  return new XApiClient({
    fetchImpl: async () => {
      const r = responses[i++];
      const nullBodyStatus = r.status === 204 || r.status === 205 || r.status === 304;
      const body = nullBodyStatus ? null : r.body === undefined ? "" : JSON.stringify(r.body);
      return new Response(body, { status: r.status });
    },
  });
}

describe("XProvider", () => {
  it("reports the expected capabilities", () => {
    const provider = new XProvider({ oauth: { clientId: "cid" } });
    expect(provider.getCapabilities()).toEqual({
      textPost: true,
      imagePost: true,
      videoPost: true,
      threadPost: true,
      directMessage: true,
      commentReply: true,
      broadcast: false,
      nativeSchedule: false,
      usageApi: false,
    });
    expect(X_CAPABILITIES.textPost).toBe(true);
  });

  it("connectAccount returns authorizationUrl when no code is present", async () => {
    const provider = new XProvider({ oauth: { clientId: "cid" } });
    const result = await provider.connectAccount({
      workspaceId: "ws-1",
      platform: "x",
      redirectUrl: "https://example.com/cb",
      state: "st-1",
    });
    expect(result.authorizationUrl).toContain("state=st-1");
    expect(result.authorizationUrl).toContain("code_challenge=");
  });

  it("connectAccount completes OAuth and returns account info on callback", async () => {
    const httpClient = buildClient([
      // exchangeCode
      {
        status: 200,
        body: {
          access_token: "acc-1",
          refresh_token: "ref-1",
          expires_in: 7200,
          token_type: "bearer",
          scope: "tweet.read tweet.write",
        },
      },
      // /2/users/me
      {
        status: 200,
        body: { data: { id: "user-123", name: "Alice", username: "alice" } },
      },
    ]);
    const provider = new XProvider({ oauth: { clientId: "cid" }, httpClient });

    // 1) initiate
    await provider.connectAccount({
      workspaceId: "ws-1",
      platform: "x",
      redirectUrl: "https://example.com/cb",
      state: "st-1",
    });

    // 2) callback
    const result = await provider.connectAccount({
      workspaceId: "ws-1",
      platform: "x",
      redirectUrl: "https://example.com/cb",
      state: "st-1",
      authorizationCode: "code-xyz",
    });

    expect(result.account).toBeDefined();
    expect(result.account?.externalAccountId).toBe("user-123");
    expect(result.account?.displayName).toBe("alice");
    expect(result.account?.tokenExpiresAt).toBeInstanceOf(Date);
    const creds = JSON.parse(result.account!.credentialsEncrypted) as {
      accessToken: string;
      refreshToken: string;
    };
    expect(creds.accessToken).toBe("acc-1");
    expect(creds.refreshToken).toBe("ref-1");
  });

  it("refreshToken returns new credentials when refresh_token is provided via JSON", async () => {
    let capturedBody = "";
    const httpClient = new XApiClient({
      fetchImpl: async (_url, init) => {
        capturedBody = String(init.body ?? "");
        return new Response(
          JSON.stringify({
            access_token: "acc-new",
            refresh_token: "ref-new",
            expires_in: 3600,
            token_type: "bearer",
          }),
          { status: 200 },
        );
      },
    });
    const provider = new XProvider({ oauth: { clientId: "cid" }, httpClient });

    const result = await provider.refreshToken(JSON.stringify({ refreshToken: "ref-old" }));
    expect(result.success).toBe(true);
    expect(new URLSearchParams(capturedBody).get("refresh_token")).toBe("ref-old");
    const creds = JSON.parse(result.credentialsEncrypted ?? "{}") as { accessToken: string };
    expect(creds.accessToken).toBe("acc-new");
  });

  it("refreshToken fails gracefully when refresh_token is missing", async () => {
    const provider = new XProvider({ oauth: { clientId: "cid" } });
    const result = await provider.refreshToken("some id with spaces");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/refresh_token/);
  });

  it("implements validatePost / publishPost / deletePost", async () => {
    const httpClient = buildClient([
      { status: 201, body: { data: { id: "1" } } },
      { status: 204 },
      { status: 201, body: { data: { id: "2" } } },
    ]);
    const provider = new XProvider({ oauth: { clientId: "cid" }, httpClient });

    const v = await provider.validatePost({
      platform: "x",
      contentText: "hi",
      contentMedia: null,
    });
    expect(v.valid).toBe(true);

    const p = await provider.publishPost({
      accountCredentials: JSON.stringify({ accessToken: "tok" }),
      contentText: "hi",
      contentMedia: null,
      providerMetadata: {
        x: {
          quotePostId: "tweet-42",
        },
      },
    });
    expect(p.success).toBe(true);
    expect(p.platformPostId).toBe("1");
    expect(p.providerMetadata?.x?.publishedThreadIds).toEqual(["1"]);

    const d = await provider.deletePost({
      accountCredentials: JSON.stringify({ accessToken: "tok" }),
      platformPostId: "1",
    });
    expect(d.success).toBe(true);

    const r = await provider.sendReply({
      accountCredentials: JSON.stringify({ accessToken: "tok" }),
      externalThreadId: "conv-1",
      replyToMessageId: "tweet-1",
      contentText: "thanks",
    });
    expect(r.success).toBe(true);
    expect(r.externalMessageId).toBe("2");
  });
});
