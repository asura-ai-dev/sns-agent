/**
 * provider-x: OAuth 2.0 PKCE テスト
 */
import { describe, it, expect } from "vitest";
import { XApiClient } from "../http-client.js";
import {
  generatePkcePair,
  getAuthUrl,
  exchangeCode,
  refreshToken,
  X_DEFAULT_SCOPES,
} from "../auth.js";

describe("generatePkcePair", () => {
  it("generates a verifier and S256 challenge", () => {
    const p = generatePkcePair();
    expect(p.codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(p.codeVerifier.length).toBeLessThanOrEqual(128);
    expect(p.codeChallengeMethod).toBe("S256");
    expect(p.codeChallenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("generates distinct verifiers on each call", () => {
    const a = generatePkcePair();
    const b = generatePkcePair();
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
  });
});

describe("getAuthUrl", () => {
  it("builds an authorize URL with required params", () => {
    const url = getAuthUrl(
      { clientId: "cid" },
      {
        redirectUri: "https://example.com/cb",
        state: "state-1",
        codeChallenge: "challenge-1",
      },
    );
    expect(url).toContain("response_type=code");
    expect(url).toContain("client_id=cid");
    expect(url).toContain("redirect_uri=https%3A%2F%2Fexample.com%2Fcb");
    expect(url).toContain("state=state-1");
    expect(url).toContain("code_challenge=challenge-1");
    expect(url).toContain("code_challenge_method=S256");
    // default scopes encoded with space -> '+'
    for (const scope of X_DEFAULT_SCOPES) {
      expect(url).toContain(encodeURIComponent(scope).replace(/%20/g, "+"));
    }
  });
});

describe("exchangeCode", () => {
  it("posts form-encoded params and parses token response", async () => {
    let capturedBody = "";
    let capturedUrl = "";
    const fetchImpl = async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedBody = String(init.body);
      return new Response(
        JSON.stringify({
          access_token: "acc-1",
          refresh_token: "ref-1",
          expires_in: 7200,
          token_type: "bearer",
          scope: "tweet.read tweet.write",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const httpClient = new XApiClient({ fetchImpl });

    const token = await exchangeCode(
      { clientId: "cid" },
      {
        code: "auth-code",
        codeVerifier: "verifier-abc",
        redirectUri: "https://example.com/cb",
      },
      httpClient,
    );

    expect(capturedUrl).toBe("https://api.twitter.com/2/oauth2/token");
    expect(capturedBody).toContain("grant_type=authorization_code");
    expect(capturedBody).toContain("code=auth-code");
    expect(capturedBody).toContain("code_verifier=verifier-abc");
    expect(token.accessToken).toBe("acc-1");
    expect(token.refreshToken).toBe("ref-1");
    expect(token.expiresAt).toBeInstanceOf(Date);
  });

  it("throws ProviderError when access_token is missing", async () => {
    const httpClient = new XApiClient({
      fetchImpl: async () =>
        new Response(JSON.stringify({ error: "invalid_grant" }), { status: 200 }),
    });
    await expect(
      exchangeCode(
        { clientId: "cid" },
        { code: "c", codeVerifier: "v", redirectUri: "https://example.com/cb" },
        httpClient,
      ),
    ).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
  });
});

describe("refreshToken", () => {
  it("posts refresh_token grant type", async () => {
    let capturedBody = "";
    const fetchImpl = async (_url: string, init: RequestInit) => {
      capturedBody = String(init.body);
      return new Response(
        JSON.stringify({
          access_token: "acc-2",
          refresh_token: "ref-2",
          expires_in: 3600,
          token_type: "bearer",
        }),
        { status: 200 },
      );
    };
    const httpClient = new XApiClient({ fetchImpl });

    const token = await refreshToken({ clientId: "cid" }, "ref-old", httpClient);
    expect(capturedBody).toContain("grant_type=refresh_token");
    expect(capturedBody).toContain("refresh_token=ref-old");
    expect(token.accessToken).toBe("acc-2");
    expect(token.refreshToken).toBe("ref-2");
  });
});
