import type {
  CheckEngagementConditionsInput,
  EngagementConditionResult,
  EngagementReply,
  EngagementReplyListResult,
  ListEngagementRepliesInput,
} from "@sns-agent/core";
import { ProviderError } from "@sns-agent/core";
import { requireXAccessTokenCredentials } from "./credentials.js";
import { XApi } from "./x-api.js";
import type { XApiClient } from "./http-client.js";
import type { XListResponse, XTweet, XUser } from "./x-api.js";

function findReplyToPostId(tweet: XTweet): string | null {
  return tweet.referenced_tweets?.find((ref) => ref.type === "replied_to" && ref.id)?.id ?? null;
}

function maxTweetId(ids: string[]): string | null {
  if (ids.length === 0) return null;
  return ids.reduce((max, id) => {
    try {
      return BigInt(id) > BigInt(max) ? id : max;
    } catch {
      return id > max ? id : max;
    }
  });
}

function userMap(users: XUser[] | undefined): Map<string, XUser> {
  return new Map((users ?? []).map((user) => [user.id, user]));
}

export async function listEngagementReplies(
  input: ListEngagementRepliesInput,
  httpClient: XApiClient,
): Promise<EngagementReplyListResult> {
  const creds = requireXAccessTokenCredentials(
    input.accountCredentials,
    "engagementGates.listReplies",
  );
  const userId = creds.xUserId ?? input.accountExternalId;
  if (!userId) {
    throw new ProviderError("X engagement reply listing requires an account user id");
  }

  const api = new XApi(httpClient, creds.accessToken);
  const tweets: XTweet[] = [];
  const users: XUser[] = [];
  let nextPaginationToken: string | undefined;
  let newestId: string | undefined;

  do {
    const res = await api.getMentions(userId, {
      maxResults: input.limit,
      paginationToken: nextPaginationToken,
      sinceId: input.sinceId ?? undefined,
      tweetFields: ["author_id", "conversation_id", "created_at", "referenced_tweets"],
      userFields: ["username", "name"],
      expansions: ["author_id", "referenced_tweets.id"],
    });
    tweets.push(...(res.data.data ?? []));
    users.push(...(res.data.includes?.users ?? []));
    newestId ??= res.data.meta?.newest_id;
    nextPaginationToken = res.data.meta?.next_token;
  } while (nextPaginationToken);

  const usersById = userMap(users);
  const replies: EngagementReply[] = tweets
    .filter((tweet) => {
      if (!tweet.id || !tweet.author_id) return false;
      if (!input.triggerPostId) return true;
      return findReplyToPostId(tweet) === input.triggerPostId;
    })
    .map((tweet) => {
      const user = usersById.get(tweet.author_id!);
      return {
        externalReplyId: tweet.id,
        externalUserId: tweet.author_id!,
        username: user?.username ?? null,
        text: tweet.text ?? null,
        createdAt: tweet.created_at ? new Date(tweet.created_at) : null,
        conversationId: tweet.conversation_id ?? null,
        inReplyToPostId: findReplyToPostId(tweet),
      };
    });

  return {
    replies,
    nextSinceId: newestId ?? maxTweetId(tweets.map((tweet) => tweet.id).filter(Boolean)),
  };
}

function containsUser(users: XUser[] | undefined, externalUserId: string): boolean {
  return (users ?? []).some((user) => user.id === externalUserId);
}

async function paginatedContainsUser(
  externalUserId: string,
  fetchPage: (paginationToken?: string) => Promise<{ data: XListResponse<XUser> }>,
): Promise<boolean> {
  let paginationToken: string | undefined;
  do {
    const res = await fetchPage(paginationToken);
    if (containsUser(res.data.data, externalUserId)) {
      return true;
    }
    paginationToken = res.data.meta?.next_token;
  } while (paginationToken);
  return false;
}

export async function checkEngagementConditions(
  input: CheckEngagementConditionsInput,
  httpClient: XApiClient,
): Promise<EngagementConditionResult> {
  const creds = requireXAccessTokenCredentials(
    input.accountCredentials,
    "engagementGates.checkConditions",
  );
  const accountUserId = creds.xUserId;
  if (!input.triggerPostId) {
    throw new ProviderError("X engagement condition checks require triggerPostId");
  }
  if (!accountUserId && input.conditions.requireFollow) {
    throw new ProviderError("X follow condition checks require account user id");
  }

  const api = new XApi(httpClient, creds.accessToken);
  const triggerPostId = input.triggerPostId;
  const [liked, reposted, followed] = await Promise.all([
    input.conditions.requireLike
      ? paginatedContainsUser(input.externalUserId, (paginationToken) =>
          api.getLikingUsers(triggerPostId, { maxResults: 100, paginationToken }),
        )
      : Promise.resolve(true),
    input.conditions.requireRepost
      ? paginatedContainsUser(input.externalUserId, (paginationToken) =>
          api.getRetweetedBy(triggerPostId, { maxResults: 100, paginationToken }),
        )
      : Promise.resolve(true),
    input.conditions.requireFollow && accountUserId
      ? paginatedContainsUser(input.externalUserId, (paginationToken) =>
          api.getFollowers(accountUserId, { maxResults: 100, paginationToken }),
        )
      : Promise.resolve(true),
  ]);

  return {
    liked,
    reposted,
    followed,
  };
}
