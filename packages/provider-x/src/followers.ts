import type {
  FollowerListResult,
  FollowerProviderProfile,
  ListFollowersInput,
} from "@sns-agent/core";
import { ProviderError } from "@sns-agent/core";
import { requireXAccessTokenCredentials } from "./credentials.js";
import type { XApiClient } from "./http-client.js";
import { XApi, type XUser } from "./x-api.js";

type XFollowerCredentials = ReturnType<typeof requireXAccessTokenCredentials>;

const USER_FIELDS = ["id", "name", "username", "protected", "verified", "public_metrics"];

async function resolveXUserId(creds: XFollowerCredentials, api: XApi): Promise<string> {
  if (creds.xUserId) return creds.xUserId;

  const res = await api.getMe();
  const userId = res.data?.data?.id;
  if (!userId) {
    throw new ProviderError("X follower lookup failed: /2/users/me response missing id");
  }
  return userId;
}

function mapUser(user: XUser): FollowerProviderProfile {
  return {
    externalUserId: user.id,
    displayName: user.name ?? null,
    username: user.username ?? null,
    metadata: {
      protected: user.protected ?? null,
      verified: user.verified ?? null,
      publicMetrics: user.public_metrics ?? null,
    },
  };
}

function limitForX(input: ListFollowersInput): number | undefined {
  if (input.limit === undefined) return undefined;
  return Math.min(Math.max(input.limit, 1), 1000);
}

export async function listFollowers(
  input: ListFollowersInput,
  httpClient: XApiClient,
): Promise<FollowerListResult> {
  const creds = requireXAccessTokenCredentials(input.accountCredentials, "followers.list");
  const api = new XApi(httpClient, creds.accessToken);
  const userId = await resolveXUserId(creds, api);
  const res = await api.getFollowers(userId, {
    maxResults: limitForX(input),
    paginationToken: input.cursor ?? undefined,
    userFields: USER_FIELDS,
  });

  return {
    profiles: (res.data?.data ?? []).map(mapUser),
    nextCursor: res.data?.meta?.next_token ?? null,
  };
}

export async function listFollowing(
  input: ListFollowersInput,
  httpClient: XApiClient,
): Promise<FollowerListResult> {
  const creds = requireXAccessTokenCredentials(input.accountCredentials, "following.list");
  const api = new XApi(httpClient, creds.accessToken);
  const userId = await resolveXUserId(creds, api);
  const res = await api.getFollowing(userId, {
    maxResults: limitForX(input),
    paginationToken: input.cursor ?? undefined,
    userFields: USER_FIELDS,
  });

  return {
    profiles: (res.data?.data ?? []).map(mapUser),
    nextCursor: res.data?.meta?.next_token ?? null,
  };
}
