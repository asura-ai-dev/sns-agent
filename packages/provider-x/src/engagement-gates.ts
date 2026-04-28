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
import type { XTweet, XUser } from "./x-api.js";

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
  const res = await api.getMentions(userId, {
    maxResults: input.limit,
    sinceId: input.sinceId ?? undefined,
    tweetFields: ["author_id", "conversation_id", "created_at", "referenced_tweets"],
    userFields: ["username", "name"],
    expansions: ["author_id", "referenced_tweets.id"],
  });

  const users = userMap(res.data.includes?.users);
  const replies: EngagementReply[] = (res.data.data ?? [])
    .filter((tweet) => {
      if (!tweet.id || !tweet.author_id) return false;
      if (!input.triggerPostId) return true;
      return findReplyToPostId(tweet) === input.triggerPostId;
    })
    .map((tweet) => {
      const user = users.get(tweet.author_id!);
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
    nextSinceId:
      res.data.meta?.newest_id ?? maxTweetId(replies.map((reply) => reply.externalReplyId)),
  };
}

function containsUser(users: XUser[] | undefined, externalUserId: string): boolean {
  return (users ?? []).some((user) => user.id === externalUserId);
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
  const [likingUsers, retweetedBy, followers] = await Promise.all([
    input.conditions.requireLike
      ? api.getLikingUsers(input.triggerPostId, { maxResults: 100 })
      : Promise.resolve(null),
    input.conditions.requireRepost
      ? api.getRetweetedBy(input.triggerPostId, { maxResults: 100 })
      : Promise.resolve(null),
    input.conditions.requireFollow && accountUserId
      ? api.getFollowers(accountUserId, { maxResults: 100 })
      : Promise.resolve(null),
  ]);

  return {
    liked: input.conditions.requireLike
      ? containsUser(likingUsers?.data.data, input.externalUserId)
      : true,
    reposted: input.conditions.requireRepost
      ? containsUser(retweetedBy?.data.data, input.externalUserId)
      : true,
    followed: input.conditions.requireFollow
      ? containsUser(followers?.data.data, input.externalUserId)
      : true,
  };
}
