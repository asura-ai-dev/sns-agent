import type { XApiResponse } from "./http-client.js";
import { XApiClient } from "./http-client.js";

export interface XUser {
  id: string;
  name?: string;
  username?: string;
  protected?: boolean;
  verified?: boolean;
  public_metrics?: Record<string, number>;
  [key: string]: unknown;
}

export interface XTweet {
  id: string;
  text?: string;
  author_id?: string;
  conversation_id?: string;
  created_at?: string;
  referenced_tweets?: Array<{ type?: string; id?: string }>;
  [key: string]: unknown;
}

export interface XDmEvent {
  id?: string;
  dm_event_id?: string;
  text?: string;
  event_type?: "MessageCreate" | "ParticipantsJoin" | "ParticipantsLeave" | string;
  created_at?: string;
  dm_conversation_id?: string;
  sender_id?: string;
  participant_ids?: string[];
  attachments?: {
    media_keys?: string[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface XPaginationMeta {
  result_count?: number;
  next_token?: string;
  previous_token?: string;
  newest_id?: string;
  oldest_id?: string;
  [key: string]: unknown;
}

export interface XIncludes {
  users?: XUser[];
  tweets?: XTweet[];
  media?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface XListResponse<T> {
  data?: T[];
  includes?: XIncludes;
  errors?: XProblem[];
  meta?: XPaginationMeta;
}

export interface XDataResponse<T> {
  data?: T;
  errors?: XProblem[];
}

export interface XProblem {
  title?: string;
  type?: string;
  detail?: string;
  status?: number;
  [key: string]: unknown;
}

export interface XTweetQueryOptions {
  tweetFields?: string[];
  userFields?: string[];
  mediaFields?: string[];
  expansions?: string[];
}

export interface XPaginationQueryOptions extends XTweetQueryOptions {
  maxResults?: number;
  paginationToken?: string;
}

export interface XSearchRecentTweetsOptions extends XTweetQueryOptions {
  query: string;
  maxResults?: number;
  nextToken?: string;
  sinceId?: string;
  untilId?: string;
  startTime?: string;
  endTime?: string;
}

export interface XTimelineOptions extends XPaginationQueryOptions {
  sinceId?: string;
  untilId?: string;
  startTime?: string;
  endTime?: string;
}

export interface XCreateTweetInput {
  text?: string;
  media?: {
    mediaIds: string[];
    taggedUserIds?: string[];
  };
  reply?: {
    inReplyToTweetId: string;
    excludeReplyUserIds?: string[];
  };
  quoteTweetId?: string;
  replySettings?: "following" | "mentionedUsers" | "subscribers" | "verified";
}

export interface XDmMessageInput {
  text?: string;
  attachments?: Array<{ mediaId: string }>;
}

export interface XCreateDmConversationInput extends XDmMessageInput {
  conversationType?: "Group";
  participantIds: string[];
}

export interface XDmEventOptions extends XPaginationQueryOptions {
  eventTypes?: string[];
}

export class XApi {
  constructor(
    private readonly httpClient: XApiClient,
    private readonly accessToken: string,
  ) {}

  getMe(): Promise<XApiResponse<XDataResponse<XUser>>> {
    return this.get<XDataResponse<XUser>>("/2/users/me");
  }

  createTweet(input: XCreateTweetInput): Promise<XApiResponse<XDataResponse<XTweet>>> {
    return this.post<XDataResponse<XTweet>>("/2/tweets", buildTweetBody(input));
  }

  deleteTweet(tweetId: string): Promise<XApiResponse<XDataResponse<{ deleted?: boolean }>>> {
    return this.delete<XDataResponse<{ deleted?: boolean }>>(`/2/tweets/${encodeId(tweetId)}`);
  }

  getTweet(
    tweetId: string,
    options: XTweetQueryOptions = {},
  ): Promise<XApiResponse<XDataResponse<XTweet>>> {
    return this.get<XDataResponse<XTweet>>(`/2/tweets/${encodeId(tweetId)}`, fieldQuery(options));
  }

  searchRecentTweets(
    options: XSearchRecentTweetsOptions,
  ): Promise<XApiResponse<XListResponse<XTweet>>> {
    return this.get<XListResponse<XTweet>>("/2/tweets/search/recent", {
      ...fieldQuery(options),
      query: options.query,
      max_results: options.maxResults,
      next_token: options.nextToken,
      since_id: options.sinceId,
      until_id: options.untilId,
      start_time: options.startTime,
      end_time: options.endTime,
    });
  }

  getMentions(
    userId: string,
    options: XTimelineOptions = {},
  ): Promise<XApiResponse<XListResponse<XTweet>>> {
    return this.get<XListResponse<XTweet>>(
      `/2/users/${encodeId(userId)}/mentions`,
      paginationQuery(options),
    );
  }

  getLikingUsers(
    tweetId: string,
    options: XPaginationQueryOptions = {},
  ): Promise<XApiResponse<XListResponse<XUser>>> {
    return this.get<XListResponse<XUser>>(
      `/2/tweets/${encodeId(tweetId)}/liking_users`,
      paginationQuery(options),
    );
  }

  getRetweetedBy(
    tweetId: string,
    options: XPaginationQueryOptions = {},
  ): Promise<XApiResponse<XListResponse<XUser>>> {
    return this.get<XListResponse<XUser>>(
      `/2/tweets/${encodeId(tweetId)}/retweeted_by`,
      paginationQuery(options),
    );
  }

  getQuoteTweets(
    tweetId: string,
    options: XPaginationQueryOptions = {},
  ): Promise<XApiResponse<XListResponse<XTweet>>> {
    return this.get<XListResponse<XTweet>>(
      `/2/tweets/${encodeId(tweetId)}/quote_tweets`,
      paginationQuery(options),
    );
  }

  getFollowers(
    userId: string,
    options: XPaginationQueryOptions = {},
  ): Promise<XApiResponse<XListResponse<XUser>>> {
    return this.get<XListResponse<XUser>>(
      `/2/users/${encodeId(userId)}/followers`,
      paginationQuery(options),
    );
  }

  getFollowing(
    userId: string,
    options: XPaginationQueryOptions = {},
  ): Promise<XApiResponse<XListResponse<XUser>>> {
    return this.get<XListResponse<XUser>>(
      `/2/users/${encodeId(userId)}/following`,
      paginationQuery(options),
    );
  }

  likeTweet(
    userId: string,
    tweetId: string,
  ): Promise<XApiResponse<XDataResponse<{ liked?: boolean }>>> {
    return this.post<XDataResponse<{ liked?: boolean }>>(`/2/users/${encodeId(userId)}/likes`, {
      tweet_id: tweetId,
    });
  }

  unlikeTweet(
    userId: string,
    tweetId: string,
  ): Promise<XApiResponse<XDataResponse<{ liked?: boolean }>>> {
    return this.delete<XDataResponse<{ liked?: boolean }>>(
      `/2/users/${encodeId(userId)}/likes/${encodeId(tweetId)}`,
    );
  }

  repostTweet(
    userId: string,
    tweetId: string,
  ): Promise<XApiResponse<XDataResponse<{ retweeted?: boolean }>>> {
    return this.post<XDataResponse<{ retweeted?: boolean }>>(
      `/2/users/${encodeId(userId)}/retweets`,
      { tweet_id: tweetId },
    );
  }

  undoRepostTweet(
    userId: string,
    tweetId: string,
  ): Promise<XApiResponse<XDataResponse<{ retweeted?: boolean }>>> {
    return this.delete<XDataResponse<{ retweeted?: boolean }>>(
      `/2/users/${encodeId(userId)}/retweets/${encodeId(tweetId)}`,
    );
  }

  followUser(
    sourceUserId: string,
    targetUserId: string,
  ): Promise<XApiResponse<XDataResponse<{ following?: boolean }>>> {
    return this.post<XDataResponse<{ following?: boolean }>>(
      `/2/users/${encodeId(sourceUserId)}/following`,
      { target_user_id: targetUserId },
    );
  }

  unfollowUser(
    sourceUserId: string,
    targetUserId: string,
  ): Promise<XApiResponse<XDataResponse<{ following?: boolean }>>> {
    return this.delete<XDataResponse<{ following?: boolean }>>(
      `/2/users/${encodeId(sourceUserId)}/following/${encodeId(targetUserId)}`,
    );
  }

  getDmEvents(options: XDmEventOptions = {}): Promise<XApiResponse<XListResponse<XDmEvent>>> {
    return this.get<XListResponse<XDmEvent>>("/2/dm_events", dmEventQuery(options));
  }

  getDmConversationEvents(
    participantId: string,
    options: XDmEventOptions = {},
  ): Promise<XApiResponse<XListResponse<XDmEvent>>> {
    return this.get<XListResponse<XDmEvent>>(
      `/2/dm_conversations/with/${encodeId(participantId)}/dm_events`,
      dmEventQuery(options),
    );
  }

  sendDmToParticipant(
    participantId: string,
    input: XDmMessageInput,
  ): Promise<XApiResponse<XDataResponse<XDmEvent>>> {
    return this.post<XDataResponse<XDmEvent>>(
      `/2/dm_conversations/with/${encodeId(participantId)}/messages`,
      buildDmMessageBody(input),
    );
  }

  sendDmToConversation(
    conversationId: string,
    input: XDmMessageInput,
  ): Promise<XApiResponse<XDataResponse<XDmEvent>>> {
    return this.post<XDataResponse<XDmEvent>>(
      `/2/dm_conversations/${encodeId(conversationId)}/messages`,
      buildDmMessageBody(input),
    );
  }

  createDmConversation(
    input: XCreateDmConversationInput,
  ): Promise<XApiResponse<XDataResponse<XDmEvent>>> {
    return this.post<XDataResponse<XDmEvent>>("/2/dm_conversations", {
      conversation_type: input.conversationType,
      participant_ids: input.participantIds,
      message: buildDmMessageBody(input),
    });
  }

  private get<T>(
    path: string,
    query?: Record<string, string | number | boolean | undefined>,
  ): Promise<XApiResponse<T>> {
    return this.httpClient.request<T>({
      method: "GET",
      path,
      accessToken: this.accessToken,
      query,
    });
  }

  private post<T>(path: string, json: unknown): Promise<XApiResponse<T>> {
    return this.httpClient.request<T>({
      method: "POST",
      path,
      accessToken: this.accessToken,
      json,
    });
  }

  private delete<T>(path: string): Promise<XApiResponse<T>> {
    return this.httpClient.request<T>({
      method: "DELETE",
      path,
      accessToken: this.accessToken,
    });
  }
}

function encodeId(id: string): string {
  return encodeURIComponent(id);
}

function csv(value: string[] | undefined): string | undefined {
  return value && value.length > 0 ? value.join(",") : undefined;
}

function fieldQuery(options: XTweetQueryOptions): Record<string, string | undefined> {
  return {
    "tweet.fields": csv(options.tweetFields),
    "user.fields": csv(options.userFields),
    "media.fields": csv(options.mediaFields),
    expansions: csv(options.expansions),
  };
}

function paginationQuery(
  options: XPaginationQueryOptions | XTimelineOptions,
): Record<string, string | number | undefined> {
  return {
    ...fieldQuery(options),
    max_results: options.maxResults,
    pagination_token: options.paginationToken,
    since_id: "sinceId" in options ? options.sinceId : undefined,
    until_id: "untilId" in options ? options.untilId : undefined,
    start_time: "startTime" in options ? options.startTime : undefined,
    end_time: "endTime" in options ? options.endTime : undefined,
  };
}

function dmEventQuery(options: XDmEventOptions): Record<string, string | number | undefined> {
  return {
    ...paginationQuery(options),
    event_types: csv(options.eventTypes),
  };
}

function buildTweetBody(input: XCreateTweetInput): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (input.text !== undefined) body.text = input.text;
  if (input.media) {
    body.media = {
      media_ids: input.media.mediaIds,
      tagged_user_ids: input.media.taggedUserIds,
    };
  }
  if (input.reply) {
    body.reply = {
      in_reply_to_tweet_id: input.reply.inReplyToTweetId,
      exclude_reply_user_ids: input.reply.excludeReplyUserIds,
    };
  }
  if (input.quoteTweetId !== undefined) body.quote_tweet_id = input.quoteTweetId;
  if (input.replySettings !== undefined) body.reply_settings = input.replySettings;
  return stripUndefined(body);
}

function buildDmMessageBody(input: XDmMessageInput): Record<string, unknown> {
  return stripUndefined({
    text: input.text,
    attachments: input.attachments?.map((attachment) => ({ media_id: attachment.mediaId })),
  });
}

function stripUndefined(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => {
        if (value && typeof value === "object" && !Array.isArray(value)) {
          return [key, stripUndefined(value as Record<string, unknown>)];
        }
        return [key, value];
      }),
  );
}
