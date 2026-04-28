import { ProviderError } from "@sns-agent/core";
import type { TokenResult } from "./auth.js";

export const X_CREDENTIAL_VERSION = 1;

export const X_OAUTH_1A_OPERATIONS = [
  "media.upload",
  "dm.send",
  "dm.read",
  "follow.create",
  "like.create",
  "repost.create",
  "search.full-archive",
] as const;

export type XOAuth1aOperation = (typeof X_OAUTH_1A_OPERATIONS)[number] | string;
export type XCredentialType = "x-oauth2" | "x-oauth1a";

export interface XOAuth2Credentials {
  version: 1;
  credentialType: "x-oauth2";
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  tokenType: string;
  scope: string | null;
  xUserId: string | null;
  mediaIds?: string[];
}

export interface XOAuth1aCredentials {
  version: 1;
  credentialType: "x-oauth1a";
  accessToken: string;
  accessTokenSecret: string;
  consumerKey: string | null;
  consumerSecret: string | null;
  xUserId: string | null;
  screenName: string | null;
}

export type XCredentials = XOAuth2Credentials | XOAuth1aCredentials;

export interface XAccessTokenCredentials {
  credentialType: XCredentialType;
  accessToken: string;
  xUserId: string | null;
  mediaIds?: string[];
}

export function serializeXOAuth2Credentials(token: TokenResult, xUserId: string | null): string {
  const credentials: XOAuth2Credentials = {
    version: X_CREDENTIAL_VERSION,
    credentialType: "x-oauth2",
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
    expiresAt: token.expiresAt ? token.expiresAt.toISOString() : null,
    tokenType: token.tokenType,
    scope: token.scope,
    xUserId,
  };

  return JSON.stringify(credentials);
}

export function parseXCredentials(raw: string): XCredentials {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ProviderError(`Invalid X credentials: ${(err as Error).message}`, {
      cause: String(err),
    });
  }

  if (!parsed || typeof parsed !== "object") {
    throw new ProviderError("Invalid X credentials: expected JSON object");
  }

  const obj = parsed as Record<string, unknown>;
  const credentialType = obj.credentialType;

  if (credentialType === "x-oauth1a") {
    return parseOAuth1aCredentials(obj);
  }

  if (credentialType === undefined || credentialType === "x-oauth2") {
    return parseOAuth2Credentials(obj);
  }

  throw new ProviderError(
    `Invalid X credentials: unsupported credentialType ${String(credentialType)}`,
  );
}

export function requireXAccessTokenCredentials(
  raw: string,
  operation: string,
): XAccessTokenCredentials {
  const credentials = parseXCredentials(raw);
  return {
    credentialType: credentials.credentialType,
    accessToken: credentials.accessToken,
    xUserId: credentials.xUserId,
    mediaIds: credentials.credentialType === "x-oauth2" ? credentials.mediaIds : undefined,
  };
}

export function requireXOAuth1aCredentials(
  raw: string,
  operation: XOAuth1aOperation,
): XOAuth1aCredentials {
  const credentials = parseXCredentials(raw);
  if (credentials.credentialType !== "x-oauth1a") {
    throw new ProviderError(`${operation} requires X OAuth 1.0a credentials`, {
      operation,
      credentialType: credentials.credentialType,
      requiredCredentialType: "x-oauth1a",
    });
  }
  return credentials;
}

export function extractXRefreshToken(raw: string): {
  refreshToken: string | null;
  xUserId: string | null;
} {
  try {
    const credentials = parseXCredentials(raw);
    if (credentials.credentialType === "x-oauth2") {
      return { refreshToken: credentials.refreshToken, xUserId: credentials.xUserId };
    }
    return { refreshToken: null, xUserId: credentials.xUserId };
  } catch {
    const legacy = parseLegacyRefreshTokenJson(raw);
    if (legacy) return legacy;

    if (raw.length > 0 && !raw.includes(" ")) {
      return { refreshToken: raw, xUserId: null };
    }
    return { refreshToken: null, xUserId: null };
  }
}

function parseLegacyRefreshTokenJson(raw: string): {
  refreshToken: string | null;
  xUserId: string | null;
} | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  const refreshToken = readNullableString(obj, "refreshToken");
  if (!refreshToken) return null;
  return {
    refreshToken,
    xUserId: readNullableString(obj, "xUserId"),
  };
}

function parseOAuth2Credentials(obj: Record<string, unknown>): XOAuth2Credentials {
  const accessToken = readRequiredString(obj, "accessToken", "OAuth 2.0 access token");
  const refreshToken = readNullableString(obj, "refreshToken");
  const expiresAt = readNullableString(obj, "expiresAt");
  const tokenType = readString(obj, "tokenType") ?? "bearer";
  const scope = readNullableString(obj, "scope");
  const xUserId = readNullableString(obj, "xUserId");
  const mediaIds = readStringArray(obj, "mediaIds");

  return {
    version: X_CREDENTIAL_VERSION,
    credentialType: "x-oauth2",
    accessToken,
    refreshToken,
    expiresAt,
    tokenType,
    scope,
    xUserId,
    ...(mediaIds ? { mediaIds } : {}),
  };
}

function parseOAuth1aCredentials(obj: Record<string, unknown>): XOAuth1aCredentials {
  return {
    version: X_CREDENTIAL_VERSION,
    credentialType: "x-oauth1a",
    accessToken: readRequiredString(obj, "accessToken", "OAuth 1.0a access token"),
    accessTokenSecret: readRequiredString(
      obj,
      "accessTokenSecret",
      "OAuth 1.0a access token secret",
    ),
    consumerKey: readNullableString(obj, "consumerKey"),
    consumerSecret: readNullableString(obj, "consumerSecret"),
    xUserId: readNullableString(obj, "xUserId"),
    screenName: readNullableString(obj, "screenName"),
  };
}

function readRequiredString(obj: Record<string, unknown>, key: string, label: string): string {
  const value = readString(obj, key);
  if (!value) {
    throw new ProviderError(`Invalid X credentials: ${label} missing`);
  }
  return value;
}

function readString(obj: Record<string, unknown>, key: string): string | null {
  const value = obj[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNullableString(obj: Record<string, unknown>, key: string): string | null {
  const value = obj[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readStringArray(obj: Record<string, unknown>, key: string): string[] | undefined {
  const value = obj[key];
  if (!Array.isArray(value)) return undefined;
  return value.every((item) => typeof item === "string") ? value : undefined;
}
