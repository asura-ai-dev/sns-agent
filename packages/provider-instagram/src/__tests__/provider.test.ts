/**
 * InstagramProvider のテスト
 * - SocialProvider インターフェースを満たすこと
 * - capability が仕様どおりであること
 * - connectAccount が OAuth 開始 / コールバック両方を処理できること
 */
import { describe, it, expect } from "vitest";
import { InstagramProvider, INSTAGRAM_CAPABILITIES } from "../index.js";
import { InstagramApiClient } from "../http-client.js";

function buildClient(responses: Array<{ status: number; body?: unknown }>): InstagramApiClient {
  let i = 0;
  return new InstagramApiClient({
    fetchImpl: async () => {
      const r = responses[i++];
      const nullBodyStatus = r.status === 204 || r.status === 205 || r.status === 304;
      const body = nullBodyStatus ? null : r.body === undefined ? "" : JSON.stringify(r.body);
      return new Response(body, { status: r.status });
    },
  });
}

describe("InstagramProvider", () => {
  it("reports the expected capabilities (textPost false)", () => {
    const provider = new InstagramProvider({
      oauth: { clientId: "app-id", clientSecret: "app-secret" },
    });
    expect(provider.getCapabilities()).toEqual({
      textPost: false,
      imagePost: true,
      videoPost: true,
      threadPost: false,
      directMessage: true,
      commentReply: true,
      broadcast: false,
      nativeSchedule: false,
      usageApi: false,
    });
    expect(INSTAGRAM_CAPABILITIES.textPost).toBe(false);
    expect(provider.platform).toBe("instagram");
  });

  it("connectAccount returns authorizationUrl when no code is present", async () => {
    const provider = new InstagramProvider({
      oauth: { clientId: "app-id", clientSecret: "app-secret" },
    });
    const result = await provider.connectAccount({
      workspaceId: "ws-1",
      platform: "instagram",
      redirectUrl: "https://example.com/cb",
      state: "st-1",
    });
    expect(result.authorizationUrl).toContain("state=st-1");
    expect(result.authorizationUrl).toContain("client_id=app-id");
    expect(result.authorizationUrl).toContain("facebook.com");
  });

  it("connectAccount completes OAuth and returns account info on callback", async () => {
    const httpClient = buildClient([
      // exchangeCode (short-lived)
      {
        status: 200,
        body: { access_token: "short-1", expires_in: 3600, token_type: "bearer" },
      },
      // exchangeForLongLivedToken
      {
        status: 200,
        body: { access_token: "long-1", expires_in: 5184000, token_type: "bearer" },
      },
      // /me/accounts
      {
        status: 200,
        body: {
          data: [
            {
              id: "page-1",
              name: "My Page",
              access_token: "page-token-1",
              instagram_business_account: { id: "ig-user-1" },
            },
          ],
        },
      },
      // GET /{ig-user-id}?fields=id,username
      {
        status: 200,
        body: { id: "ig-user-1", username: "alice_ig" },
      },
    ]);
    const provider = new InstagramProvider({
      oauth: { clientId: "app-id", clientSecret: "app-secret" },
      httpClient,
    });

    const result = await provider.connectAccount({
      workspaceId: "ws-1",
      platform: "instagram",
      redirectUrl: "https://example.com/cb",
      state: "st-1",
      authorizationCode: "code-xyz",
    });

    expect(result.account).toBeDefined();
    expect(result.account?.externalAccountId).toBe("ig-user-1");
    expect(result.account?.displayName).toBe("alice_ig");
    expect(result.account?.tokenExpiresAt).toBeInstanceOf(Date);

    const creds = JSON.parse(result.account!.credentialsEncrypted) as {
      accessToken: string;
      igUserId: string;
      pageAccessToken: string;
    };
    expect(creds.accessToken).toBe("long-1");
    expect(creds.igUserId).toBe("ig-user-1");
    expect(creds.pageAccessToken).toBe("page-token-1");
  });

  it("refreshToken extends long-lived token when credentials JSON is provided", async () => {
    const httpClient = buildClient([
      {
        status: 200,
        body: { access_token: "long-2", expires_in: 5184000, token_type: "bearer" },
      },
    ]);
    const provider = new InstagramProvider({
      oauth: { clientId: "app-id", clientSecret: "app-secret" },
      httpClient,
    });

    const result = await provider.refreshToken(
      JSON.stringify({ accessToken: "long-1", igUserId: "ig-user-1", pageAccessToken: null }),
    );
    expect(result.success).toBe(true);
    const creds = JSON.parse(result.credentialsEncrypted ?? "{}") as {
      accessToken: string;
      igUserId: string;
    };
    expect(creds.accessToken).toBe("long-2");
    expect(creds.igUserId).toBe("ig-user-1");
  });

  it("refreshToken fails gracefully when access_token is missing", async () => {
    const provider = new InstagramProvider({
      oauth: { clientId: "app-id", clientSecret: "app-secret" },
    });
    const result = await provider.refreshToken("some id with spaces");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/access_token/);
  });
});
