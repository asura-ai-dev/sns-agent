import type { ListQuoteTweetsInput, QuoteTweetListResult } from "@sns-agent/core";
import { requireXAccessTokenCredentials } from "./credentials.js";
import { XApi } from "./x-api.js";
import type { XApiClient } from "./http-client.js";
import type { XTweet, XUser } from "./x-api.js";

function userMap(users: XUser[] | undefined): Map<string, XUser> {
  return new Map((users ?? []).map((user) => [user.id, user]));
}

function profileImageUrl(user: XUser | undefined): string | null {
  const value = user?.profile_image_url;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function publicMetrics(tweet: XTweet): Record<string, unknown> | null {
  const value = tweet.public_metrics;
  return value && typeof value === "object" ? value : null;
}

export async function listQuoteTweets(
  input: ListQuoteTweetsInput,
  httpClient: XApiClient,
): Promise<QuoteTweetListResult> {
  const creds = requireXAccessTokenCredentials(input.accountCredentials, "quoteTweets.list");
  const api = new XApi(httpClient, creds.accessToken);
  const res = await api.getQuoteTweets(input.sourceTweetId, {
    maxResults: input.limit,
    paginationToken: input.cursor ?? undefined,
    tweetFields: ["author_id", "created_at", "public_metrics", "referenced_tweets", "text"],
    userFields: ["id", "name", "username", "profile_image_url", "verified"],
    expansions: ["author_id"],
  });

  const users = userMap(res.data.includes?.users);
  return {
    quotes: (res.data.data ?? [])
      .filter((tweet) => Boolean(tweet.id && tweet.author_id))
      .map((tweet) => {
        const author = users.get(tweet.author_id!);
        return {
          sourceTweetId: input.sourceTweetId,
          quoteTweetId: tweet.id,
          authorExternalId: tweet.author_id!,
          authorUsername: author?.username ?? null,
          authorDisplayName: author?.name ?? author?.username ?? null,
          authorProfileImageUrl: profileImageUrl(author),
          authorVerified: author?.verified === true,
          contentText: tweet.text ?? null,
          contentMedia: null,
          quotedAt: tweet.created_at ? new Date(tweet.created_at) : null,
          metrics: publicMetrics(tweet),
          providerMetadata: {
            referencedTweets: tweet.referenced_tweets ?? [],
          },
        };
      }),
    nextCursor: res.data.meta?.next_token ?? null,
  };
}
