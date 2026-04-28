import { describe, expect, it } from "vitest";
import {
  X_OAUTH_1A_OPERATIONS,
  parseXCredentials,
  requireXAccessTokenCredentials,
  requireXOAuth1aCredentials,
  serializeXOAuth2Credentials,
} from "../credentials.js";

describe("X credentials", () => {
  it("serializes OAuth 2.0 credentials with an explicit credential type", () => {
    const serialized = serializeXOAuth2Credentials(
      {
        accessToken: "access-1",
        refreshToken: "refresh-1",
        expiresAt: new Date("2026-04-28T12:00:00.000Z"),
        tokenType: "bearer",
        scope: "tweet.read tweet.write",
      },
      "user-1",
    );

    expect(JSON.parse(serialized)).toEqual({
      version: 1,
      credentialType: "x-oauth2",
      accessToken: "access-1",
      refreshToken: "refresh-1",
      expiresAt: "2026-04-28T12:00:00.000Z",
      tokenType: "bearer",
      scope: "tweet.read tweet.write",
      xUserId: "user-1",
    });
  });

  it("parses legacy OAuth 2.0 credentials for existing connected accounts", () => {
    const credentials = parseXCredentials(
      JSON.stringify({
        accessToken: "legacy-access",
        refreshToken: "legacy-refresh",
        xUserId: "legacy-user",
      }),
    );

    expect(credentials.credentialType).toBe("x-oauth2");
    expect(credentials.accessToken).toBe("legacy-access");
    expect(credentials.refreshToken).toBe("legacy-refresh");
    expect(credentials.xUserId).toBe("legacy-user");
  });

  it("parses OAuth 1.0a credentials for downstream X-only operations", () => {
    const credentials = parseXCredentials(
      JSON.stringify({
        version: 1,
        credentialType: "x-oauth1a",
        accessToken: "oauth1-access",
        accessTokenSecret: "oauth1-secret",
        consumerKey: "consumer-key",
        consumerSecret: "consumer-secret",
        xUserId: "user-2",
        screenName: "alice",
      }),
    );

    expect(credentials).toMatchObject({
      credentialType: "x-oauth1a",
      accessToken: "oauth1-access",
      accessTokenSecret: "oauth1-secret",
      consumerKey: "consumer-key",
      consumerSecret: "consumer-secret",
      xUserId: "user-2",
      screenName: "alice",
    });
  });

  it("returns access token credentials for OAuth 2.0 API calls", () => {
    const access = requireXAccessTokenCredentials(
      JSON.stringify({
        version: 1,
        credentialType: "x-oauth2",
        accessToken: "access-2",
        refreshToken: null,
        xUserId: "user-3",
        mediaIds: ["media-1"],
      }),
      "post.create",
    );

    expect(access).toEqual({
      accessToken: "access-2",
      xUserId: "user-3",
      mediaIds: ["media-1"],
      credentialType: "x-oauth2",
    });
  });

  it("rejects OAuth 2.0 credentials when an OAuth 1.0a-only operation is requested", () => {
    expect(() =>
      requireXOAuth1aCredentials(
        JSON.stringify({
          version: 1,
          credentialType: "x-oauth2",
          accessToken: "access-3",
        }),
        "media.upload",
      ),
    ).toThrow(/media\.upload requires X OAuth 1\.0a credentials/);
    expect(X_OAUTH_1A_OPERATIONS).toContain("media.upload");
  });
});
