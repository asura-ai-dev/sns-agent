import type {
  GetMessagesInput,
  ListThreadsInput,
  MessageListResult,
  MessageProviderMetadata,
  SendReplyInput,
  SendReplyResult,
  ThreadListResult,
  ThreadProviderMetadata,
  MediaAttachment,
} from "@sns-agent/core";
import { ProviderError } from "@sns-agent/core";
import { XApiClient } from "./http-client.js";
import { uploadMediaAttachments } from "./media.js";

interface XInboxCredentials {
  accessToken: string;
  xUserId: string | null;
  mediaIds?: string[];
}

interface XCursorState {
  mentionsPaginationToken: string | null;
  mentionsSinceId: string | null;
  dmPaginationToken: string | null;
  paginationToken: string | null;
  sinceId: string | null;
}

interface XTweet {
  id: string;
  text?: string;
  author_id?: string;
  conversation_id?: string;
  created_at?: string;
  referenced_tweets?: Array<{ type?: string; id?: string }>;
  entities?: {
    mentions?: Array<{ id?: string; username?: string }>;
  };
}

interface XDmEvent {
  id?: string;
  text?: string;
  created_at?: string;
  dm_conversation_id?: string;
  sender_id?: string;
  participant_ids?: string[];
  attachments?: {
    media_keys?: string[];
  };
}

interface XMediaVariant {
  bit_rate?: number;
  content_type?: string;
  url?: string;
}

interface XMedia {
  media_key?: string;
  type?: string;
  url?: string;
  preview_image_url?: string;
  variants?: XMediaVariant[];
}

interface XUser {
  id: string;
  name?: string;
  username?: string;
}

interface XTweetListResponse {
  data?: XTweet[];
  includes?: { users?: XUser[] };
  meta?: { next_token?: string };
}

interface XDmEventListResponse {
  data?: XDmEvent[];
  includes?: {
    users?: XUser[];
    media?: XMedia[];
  };
  meta?: { next_token?: string };
}

function parseCredentials(raw: string): XInboxCredentials {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    if (typeof obj.accessToken !== "string" || obj.accessToken.length === 0) {
      throw new Error("accessToken missing");
    }
    const xUserId = typeof obj.xUserId === "string" ? obj.xUserId : null;
    const mediaIds =
      Array.isArray(obj.mediaIds) && obj.mediaIds.every((id) => typeof id === "string")
        ? (obj.mediaIds as string[])
        : undefined;
    return {
      accessToken: obj.accessToken,
      xUserId,
      mediaIds,
    };
  } catch (err) {
    throw new ProviderError(`Invalid X inbox credentials: ${(err as Error).message}`, {
      cause: String(err),
    });
  }
}

async function resolveXUserId(creds: XInboxCredentials, httpClient: XApiClient): Promise<string> {
  if (creds.xUserId) return creds.xUserId;

  const res = await httpClient.request<{ data?: { id?: string } }>({
    method: "GET",
    path: "/2/users/me",
    accessToken: creds.accessToken,
  });
  const userId = res.data?.data?.id;
  if (!userId) {
    throw new ProviderError("X inbox lookup failed: /2/users/me response missing id");
  }
  return userId;
}

function parseCursor(raw: string | undefined): XCursorState {
  if (!raw) {
    return {
      mentionsPaginationToken: null,
      mentionsSinceId: null,
      dmPaginationToken: null,
      paginationToken: null,
      sinceId: null,
    };
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const mentionsPaginationToken =
      typeof parsed.mentionsPaginationToken === "string"
        ? parsed.mentionsPaginationToken
        : typeof parsed.paginationToken === "string"
          ? parsed.paginationToken
          : null;
    const mentionsSinceId =
      typeof parsed.mentionsSinceId === "string"
        ? parsed.mentionsSinceId
        : typeof parsed.sinceId === "string"
          ? parsed.sinceId
          : null;
    return {
      mentionsPaginationToken,
      mentionsSinceId,
      dmPaginationToken:
        typeof parsed.dmPaginationToken === "string" ? parsed.dmPaginationToken : null,
      paginationToken:
        typeof parsed.paginationToken === "string"
          ? parsed.paginationToken
          : mentionsPaginationToken,
      sinceId: typeof parsed.sinceId === "string" ? parsed.sinceId : mentionsSinceId,
    };
  } catch {
    return {
      mentionsPaginationToken: raw,
      mentionsSinceId: null,
      dmPaginationToken: null,
      paginationToken: raw,
      sinceId: null,
    };
  }
}

function serializeCursor(state: XCursorState): string | null {
  if (!state.mentionsPaginationToken && !state.mentionsSinceId && !state.dmPaginationToken) {
    return null;
  }

  return JSON.stringify({
    mentionsPaginationToken: state.mentionsPaginationToken,
    mentionsSinceId: state.mentionsSinceId,
    dmPaginationToken: state.dmPaginationToken,
    paginationToken: state.mentionsPaginationToken,
    sinceId: state.mentionsSinceId,
  });
}

function pickMaxId(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;

  if (/^\d+$/.test(a) && /^\d+$/.test(b)) {
    return BigInt(a) >= BigInt(b) ? a : b;
  }
  return a >= b ? a : b;
}

function inferEntryType(tweet: XTweet): "mention" | "reply" {
  const replyToPost = tweet.referenced_tweets?.some((row) => row.type === "replied_to");
  return replyToPost ? "reply" : "mention";
}

function buildThreadMetadata(
  tweet: XTweet,
  author: XUser | undefined,
): ThreadProviderMetadata | null {
  const replyToPostId =
    tweet.referenced_tweets?.find((row) => row.type === "replied_to")?.id ?? null;

  return {
    x: {
      entryType: inferEntryType(tweet),
      conversationId: tweet.conversation_id ?? tweet.id,
      rootPostId: tweet.conversation_id ?? tweet.id,
      focusPostId: tweet.id,
      replyToPostId,
      authorXUserId: tweet.author_id ?? null,
      authorUsername: author?.username ?? null,
    },
  };
}

function buildMessageMetadata(
  tweet: XTweet,
  author: XUser | undefined,
): MessageProviderMetadata | null {
  const replyToPostId =
    tweet.referenced_tweets?.find((row) => row.type === "replied_to")?.id ?? null;

  return {
    x: {
      entryType: inferEntryType(tweet),
      conversationId: tweet.conversation_id ?? tweet.id,
      postId: tweet.id,
      replyToPostId,
      authorUsername: author?.username ?? null,
      mentionedXUserIds:
        tweet.entities?.mentions
          ?.map((mention) => mention.id ?? mention.username ?? null)
          .filter((value): value is string => Boolean(value)) ?? [],
    },
  };
}

function buildDmThreadMetadata(
  event: XDmEvent,
  participantId: string,
  participant: XUser | undefined,
): ThreadProviderMetadata | null {
  return {
    x: {
      entryType: "dm",
      conversationId: event.dm_conversation_id ?? null,
      rootPostId: null,
      focusPostId: event.id ?? null,
      replyToPostId: null,
      authorXUserId: participantId,
      authorUsername: participant?.username ?? null,
    },
  };
}

function buildDmMessageMetadata(
  event: XDmEvent,
  sender: XUser | undefined,
): MessageProviderMetadata | null {
  return {
    x: {
      entryType: "dm",
      conversationId: event.dm_conversation_id ?? null,
      postId: event.id ?? null,
      replyToPostId: null,
      authorUsername: sender?.username ?? null,
      mentionedXUserIds: [],
    },
  };
}

function extractDmParticipantId(event: XDmEvent, selfUserId: string): string | null {
  const participantIds = Array.isArray(event.participant_ids)
    ? event.participant_ids.filter((value): value is string => typeof value === "string")
    : [];
  const otherParticipant = participantIds.find((value) => value !== selfUserId);
  if (otherParticipant) return otherParticipant;

  const conversationId = event.dm_conversation_id ?? "";
  const conversationParts = conversationId.split("-").filter(Boolean);
  const otherFromConversation = conversationParts.find((value) => value !== selfUserId);
  if (otherFromConversation) return otherFromConversation;

  if (event.sender_id && event.sender_id !== selfUserId) {
    return event.sender_id;
  }
  return null;
}

function resolveDmMediaUrl(media: XMedia): { url: string; mimeType: string } | null {
  if (typeof media.url === "string" && media.url.length > 0) {
    return {
      url: media.url,
      mimeType: media.type === "photo" ? "image/jpeg" : "application/octet-stream",
    };
  }

  if (Array.isArray(media.variants) && media.variants.length > 0) {
    const variant = [...media.variants]
      .filter((item): item is XMediaVariant & { url: string } => typeof item.url === "string")
      .sort((a, b) => (b.bit_rate ?? 0) - (a.bit_rate ?? 0))[0];
    if (variant) {
      return {
        url: variant.url,
        mimeType: variant.content_type ?? "video/mp4",
      };
    }
  }

  if (typeof media.preview_image_url === "string" && media.preview_image_url.length > 0) {
    return {
      url: media.preview_image_url,
      mimeType: "image/jpeg",
    };
  }

  return null;
}

function mapDmMediaAttachments(
  event: XDmEvent,
  mediaMap: Map<string, XMedia>,
): MediaAttachment[] | null {
  const mediaKeys = event.attachments?.media_keys ?? [];
  const attachments = mediaKeys
    .map((mediaKey) => mediaMap.get(mediaKey))
    .filter((media): media is XMedia => Boolean(media))
    .map((media) => {
      const resolved = resolveDmMediaUrl(media);
      if (!resolved) return null;
      return {
        type: media.type === "video" || media.type === "animated_gif" ? "video" : "image",
        url: resolved.url,
        mimeType: resolved.mimeType,
      } satisfies MediaAttachment;
    })
    .filter((media): media is MediaAttachment => media !== null);

  return attachments.length > 0 ? attachments : null;
}

async function fetchMentionThreads(
  httpClient: XApiClient,
  creds: XInboxCredentials,
  userId: string,
  cursor: XCursorState,
  limit: number,
): Promise<{
  threads: ThreadListResult["threads"];
  nextPaginationToken: string | null;
  nextSinceId: string | null;
}> {
  const res = await httpClient.request<XTweetListResponse>({
    method: "GET",
    path: `/2/users/${encodeURIComponent(userId)}/mentions`,
    accessToken: creds.accessToken,
    query: {
      max_results: limit,
      pagination_token: cursor.mentionsPaginationToken ?? undefined,
      since_id: cursor.mentionsSinceId ?? undefined,
      expansions: "author_id",
      "tweet.fields": "author_id,conversation_id,created_at,entities,referenced_tweets,text",
      "user.fields": "id,name,username",
    },
  });

  const tweets = res.data?.data ?? [];
  const users = new Map((res.data?.includes?.users ?? []).map((user) => [user.id, user]));
  const grouped = new Map<string, XTweet[]>();
  let maxSeenId = cursor.mentionsSinceId;

  for (const tweet of tweets) {
    maxSeenId = pickMaxId(maxSeenId, tweet.id);
    const conversationId = tweet.conversation_id ?? tweet.id;
    const bucket = grouped.get(conversationId) ?? [];
    bucket.push(tweet);
    grouped.set(conversationId, bucket);
  }

  const threads = [...grouped.entries()].map(([conversationId, bucket]) => {
    bucket.sort((a, b) => {
      const at = a.created_at ? Date.parse(a.created_at) : 0;
      const bt = b.created_at ? Date.parse(b.created_at) : 0;
      return bt - at;
    });

    const latest = bucket[0];
    const author = latest.author_id ? users.get(latest.author_id) : undefined;
    return {
      externalThreadId: conversationId,
      participantName: author?.name ?? author?.username ?? null,
      participantExternalId: latest.author_id ?? null,
      channel: "public" as const,
      initiatedBy: "external" as const,
      lastMessageAt: latest.created_at ? new Date(latest.created_at) : null,
      providerMetadata: buildThreadMetadata(latest, author),
    };
  });

  return {
    threads,
    nextPaginationToken: res.data?.meta?.next_token ?? null,
    nextSinceId: maxSeenId,
  };
}

async function fetchDmThreads(
  httpClient: XApiClient,
  creds: XInboxCredentials,
  userId: string,
  cursor: XCursorState,
  limit: number,
): Promise<{ threads: ThreadListResult["threads"]; nextPaginationToken: string | null }> {
  const res = await httpClient.request<XDmEventListResponse>({
    method: "GET",
    path: "/2/dm_events",
    accessToken: creds.accessToken,
    query: {
      max_results: limit,
      pagination_token: cursor.dmPaginationToken ?? undefined,
      event_types: "MessageCreate",
      expansions: "attachments.media_keys,participant_ids,sender_id",
      "dm_event.fields":
        "attachments,created_at,dm_conversation_id,id,participant_ids,sender_id,text",
      "user.fields": "id,name,username",
      "media.fields": "media_key,preview_image_url,type,url,variants",
    },
  });

  const events = res.data?.data ?? [];
  const users = new Map((res.data?.includes?.users ?? []).map((user) => [user.id, user]));
  const grouped = new Map<string, XDmEvent[]>();

  for (const event of events) {
    const participantId = extractDmParticipantId(event, userId);
    if (!participantId) continue;
    const bucket = grouped.get(participantId) ?? [];
    bucket.push(event);
    grouped.set(participantId, bucket);
  }

  const threads = [...grouped.entries()].map(([participantId, bucket]) => {
    bucket.sort((a, b) => {
      const at = a.created_at ? Date.parse(a.created_at) : 0;
      const bt = b.created_at ? Date.parse(b.created_at) : 0;
      return bt - at;
    });

    const latest = bucket[0];
    const participant = users.get(participantId);
    return {
      externalThreadId: `dm:${participantId}`,
      participantName: participant?.name ?? participant?.username ?? null,
      participantExternalId: participantId,
      channel: "direct" as const,
      initiatedBy: latest.sender_id === userId ? ("self" as const) : ("external" as const),
      lastMessageAt: latest.created_at ? new Date(latest.created_at) : null,
      providerMetadata: buildDmThreadMetadata(latest, participantId, participant),
    };
  });

  return {
    threads,
    nextPaginationToken: res.data?.meta?.next_token ?? null,
  };
}

export async function listThreads(
  input: ListThreadsInput,
  httpClient: XApiClient,
): Promise<ThreadListResult> {
  const creds = parseCredentials(input.accountCredentials);
  const userId = await resolveXUserId(creds, httpClient);
  const cursor = parseCursor(input.cursor);
  const limit = Math.min(input.limit ?? 25, 100);

  const [mentions, dms] = await Promise.all([
    fetchMentionThreads(httpClient, creds, userId, cursor, limit),
    fetchDmThreads(httpClient, creds, userId, cursor, limit),
  ]);

  const threads = [...mentions.threads, ...dms.threads].sort((a, b) => {
    const at = a.lastMessageAt?.getTime() ?? 0;
    const bt = b.lastMessageAt?.getTime() ?? 0;
    return bt - at;
  });

  return {
    threads,
    nextCursor: serializeCursor({
      mentionsPaginationToken: mentions.nextPaginationToken,
      mentionsSinceId: mentions.nextSinceId,
      dmPaginationToken: dms.nextPaginationToken,
      paginationToken: mentions.nextPaginationToken,
      sinceId: mentions.nextSinceId,
    }),
  };
}

export async function getMessages(
  input: GetMessagesInput,
  httpClient: XApiClient,
): Promise<MessageListResult> {
  const creds = parseCredentials(input.accountCredentials);
  const userId = await resolveXUserId(creds, httpClient);
  const cursor = parseCursor(input.cursor);

  if (input.externalThreadId.startsWith("dm:")) {
    const participantId = input.externalThreadId.slice(3).trim();
    if (!participantId) {
      throw new ProviderError("X DM thread id is invalid");
    }

    const res = await httpClient.request<XDmEventListResponse>({
      method: "GET",
      path: `/2/dm_conversations/with/${encodeURIComponent(participantId)}/dm_events`,
      accessToken: creds.accessToken,
      query: {
        max_results: Math.min(input.limit ?? 50, 100),
        pagination_token: cursor.dmPaginationToken ?? cursor.paginationToken ?? undefined,
        event_types: "MessageCreate",
        expansions: "attachments.media_keys,sender_id",
        "dm_event.fields": "attachments,created_at,dm_conversation_id,id,sender_id,text",
        "user.fields": "id,name,username",
        "media.fields": "media_key,preview_image_url,type,url,variants",
      },
    });

    const users = new Map((res.data?.includes?.users ?? []).map((user) => [user.id, user]));
    const mediaMap = new Map(
      (res.data?.includes?.media ?? [])
        .filter(
          (media): media is XMedia & { media_key: string } => typeof media.media_key === "string",
        )
        .map((media) => [media.media_key, media]),
    );
    const events = (res.data?.data ?? []).slice().sort((a, b) => {
      const at = a.created_at ? Date.parse(a.created_at) : 0;
      const bt = b.created_at ? Date.parse(b.created_at) : 0;
      return at - bt;
    });

    const messages = events.map((event) => {
      const sender = event.sender_id ? users.get(event.sender_id) : undefined;
      return {
        externalMessageId: event.id ?? "",
        direction: event.sender_id === userId ? ("outbound" as const) : ("inbound" as const),
        contentText: event.text ?? null,
        contentMedia: mapDmMediaAttachments(event, mediaMap),
        authorExternalId: event.sender_id ?? null,
        authorDisplayName: sender?.name ?? sender?.username ?? null,
        sentAt: event.created_at ? new Date(event.created_at) : null,
        providerMetadata: buildDmMessageMetadata(event, sender),
      };
    });

    return {
      messages,
      nextCursor: serializeCursor({
        mentionsPaginationToken: null,
        mentionsSinceId: null,
        dmPaginationToken: res.data?.meta?.next_token ?? null,
        paginationToken: null,
        sinceId: null,
      }),
    };
  }

  const res = await httpClient.request<XTweetListResponse>({
    method: "GET",
    path: "/2/tweets/search/recent",
    accessToken: creds.accessToken,
    query: {
      query: `conversation_id:${input.externalThreadId}`,
      max_results: Math.min(input.limit ?? 50, 100),
      next_token: cursor.mentionsPaginationToken ?? cursor.paginationToken ?? undefined,
      since_id: cursor.mentionsSinceId ?? cursor.sinceId ?? undefined,
      expansions: "author_id",
      "tweet.fields": "author_id,conversation_id,created_at,entities,referenced_tweets,text",
      "user.fields": "id,name,username",
    },
  });

  const users = new Map((res.data?.includes?.users ?? []).map((user) => [user.id, user]));
  const tweets = (res.data?.data ?? []).slice().sort((a, b) => {
    const at = a.created_at ? Date.parse(a.created_at) : 0;
    const bt = b.created_at ? Date.parse(b.created_at) : 0;
    return at - bt;
  });

  let maxSeenId = cursor.mentionsSinceId ?? cursor.sinceId;
  const messages = tweets.map((tweet) => {
    maxSeenId = pickMaxId(maxSeenId, tweet.id);
    const author = tweet.author_id ? users.get(tweet.author_id) : undefined;
    return {
      externalMessageId: tweet.id,
      direction: tweet.author_id === userId ? ("outbound" as const) : ("inbound" as const),
      contentText: tweet.text ?? null,
      contentMedia: null,
      authorExternalId: tweet.author_id ?? null,
      authorDisplayName: author?.name ?? author?.username ?? null,
      sentAt: tweet.created_at ? new Date(tweet.created_at) : null,
      providerMetadata: buildMessageMetadata(tweet, author),
    };
  });

  return {
    messages,
    nextCursor: serializeCursor({
      mentionsPaginationToken: res.data?.meta?.next_token ?? null,
      mentionsSinceId: maxSeenId,
      dmPaginationToken: null,
      paginationToken: res.data?.meta?.next_token ?? null,
      sinceId: maxSeenId,
    }),
  };
}

export async function sendReply(
  input: SendReplyInput,
  httpClient: XApiClient,
): Promise<SendReplyResult> {
  const creds = parseCredentials(input.accountCredentials);
  const trimmedText = input.contentText.trim();
  const isDirectMessage = input.externalThreadId.startsWith("dm:");

  try {
    const mediaIds = await uploadMediaAttachments({
      accessToken: creds.accessToken,
      contentMedia: input.contentMedia,
      credentialMediaIds: creds.mediaIds,
      entity: isDirectMessage ? "dm" : "tweet",
      httpClient,
    });

    if (isDirectMessage) {
      const participantId = input.externalThreadId.slice(3).trim();
      if (!participantId) {
        return {
          success: false,
          externalMessageId: null,
          error: "X DM sendReply requires participant id",
        };
      }

      const body: Record<string, unknown> = {};
      if (trimmedText.length > 0) {
        body.text = trimmedText;
      }
      if (mediaIds && mediaIds.length > 0) {
        body.attachments = mediaIds.map((mediaId) => ({ media_id: mediaId }));
      }
      if (!body.text && !body.attachments) {
        return {
          success: false,
          externalMessageId: null,
          error: "Empty X DM reply: neither text nor media provided",
        };
      }

      const res = await httpClient.request<{ data?: { dm_event_id?: string; id?: string } }>({
        method: "POST",
        path: `/2/dm_conversations/with/${encodeURIComponent(participantId)}/messages`,
        accessToken: creds.accessToken,
        json: body,
      });

      const id = res.data?.data?.dm_event_id ?? res.data?.data?.id ?? null;
      if (!id) {
        return {
          success: false,
          externalMessageId: null,
          error: "X API response missing DM event id",
        };
      }

      return {
        success: true,
        externalMessageId: id,
      };
    }

    const replyToMessageId = input.replyToMessageId;
    if (!replyToMessageId) {
      return {
        success: false,
        externalMessageId: null,
        error: "X sendReply requires replyToMessageId",
      };
    }

    const body: Record<string, unknown> = {
      reply: {
        in_reply_to_tweet_id: replyToMessageId,
      },
    };

    if (trimmedText.length > 0) {
      body.text = trimmedText;
    }
    if (mediaIds && mediaIds.length > 0) {
      body.media = { media_ids: mediaIds };
    }

    if (!body.text && !body.media) {
      return {
        success: false,
        externalMessageId: null,
        error: "Empty X reply: neither text nor media provided",
      };
    }

    const res = await httpClient.request<{ data?: { id?: string } }>({
      method: "POST",
      path: "/2/tweets",
      accessToken: creds.accessToken,
      json: body,
    });

    const id = res.data?.data?.id;
    if (!id) {
      return {
        success: false,
        externalMessageId: null,
        error: "X API response missing reply tweet id",
      };
    }

    return {
      success: true,
      externalMessageId: id,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      externalMessageId: null,
      error: message,
    };
  }
}
