/**
 * X (Twitter) 投稿操作
 *
 * - validatePost: テキスト文字数 / 画像枚数 / 動画本数チェック
 * - publishPost:  X API v2 POST /2/tweets
 * - deletePost:   X API v2 DELETE /2/tweets/:id
 *
 * design.md セクション 11 (投稿バリデーション) / Task 2003 の仕様に準拠。
 */
import type {
  ValidatePostInput,
  ValidationResult,
  ValidationIssue,
  PublishPostInput,
  PublishResult,
  DeletePostInput,
  DeleteResult,
  MediaAttachment,
  PostProviderMetadata,
  XThreadPostSegment,
} from "@sns-agent/core";
import { ProviderError } from "@sns-agent/core";
import { XApiClient } from "./http-client.js";
import {
  X_MAX_IMAGES,
  X_MAX_VIDEOS,
  X_TEXT_LIMIT_BASIC,
  X_TEXT_LIMIT_PREMIUM,
} from "./capabilities.js";
import { uploadMediaAttachments } from "./media.js";
import { requireXAccessTokenCredentials } from "./credentials.js";

export interface XValidateOptions {
  /** Premium プランの場合 true。デフォルトは Basic (280 文字) */
  premium?: boolean;
}

function validateTweetPayload(
  args: {
    contentText: string | null;
    contentMedia: MediaAttachment[] | null;
    quotePostId?: string | null;
  },
  options: XValidateOptions,
): ValidationIssue[] {
  const errors: ValidationIssue[] = [];
  const text = args.contentText ?? "";
  const media = args.contentMedia ?? [];
  const images = media.filter((m) => m.type === "image");
  const videos = media.filter((m) => m.type === "video");
  const hasQuoteTarget = typeof args.quotePostId === "string" && args.quotePostId.trim().length > 0;

  const textLimit = options.premium ? X_TEXT_LIMIT_PREMIUM : X_TEXT_LIMIT_BASIC;

  if (text.length === 0 && media.length === 0 && !hasQuoteTarget) {
    errors.push({
      field: "content",
      message: "Post must contain text, media, or quote target",
    });
  }

  const textLength = Array.from(text).length;
  if (textLength > textLimit) {
    errors.push({
      field: "contentText",
      message: `Text exceeds the ${textLimit}-character limit (current: ${textLength})`,
      constraint: { limit: textLimit, current: textLength },
    });
  }

  if (images.length > X_MAX_IMAGES) {
    errors.push({
      field: "contentMedia",
      message: `Too many images (max ${X_MAX_IMAGES}, got ${images.length})`,
      constraint: { maxImages: X_MAX_IMAGES },
    });
  }

  if (videos.length > X_MAX_VIDEOS) {
    errors.push({
      field: "contentMedia",
      message: `Too many videos (max ${X_MAX_VIDEOS}, got ${videos.length})`,
      constraint: { maxVideos: X_MAX_VIDEOS },
    });
  }

  if (images.length > 0 && videos.length > 0) {
    errors.push({
      field: "contentMedia",
      message: "Cannot attach both images and videos in the same post",
    });
  }

  return errors;
}

function getXMetadata(
  metadata: PostProviderMetadata | null | undefined,
): PostProviderMetadata["x"] {
  return metadata?.x;
}

/**
 * 投稿バリデーション
 *
 * チェック項目:
 * - テキストまたは画像/動画が最低 1 つ存在する
 * - テキスト長が上限内 (280 or 25,000)
 * - 画像枚数が 4 枚以内
 * - 動画本数が 1 本以内
 * - 画像と動画の同時添付はしない (X の制約)
 */
export function validatePost(
  input: ValidatePostInput,
  options: XValidateOptions = {},
): ValidationResult {
  const errors = validateTweetPayload(
    {
      contentText: input.contentText,
      contentMedia: input.contentMedia,
      quotePostId: getXMetadata(input.providerMetadata)?.quotePostId ?? null,
    },
    options,
  );
  const warnings: ValidationIssue[] = [];
  const threadPosts = getXMetadata(input.providerMetadata)?.threadPosts ?? [];

  if (getXMetadata(input.providerMetadata)?.quotePostId === "") {
    errors.push({
      field: "providerMetadata.x.quotePostId",
      message: "quotePostId must not be empty",
    });
  }

  threadPosts.forEach((segment, index) => {
    const trimmedText = segment.contentText.trim();
    if (trimmedText.length === 0) {
      errors.push({
        field: `providerMetadata.x.threadPosts[${index}].contentText`,
        message: "Thread segment must contain text",
      });
      return;
    }

    for (const issue of validateTweetPayload(
      { contentText: trimmedText, contentMedia: null, quotePostId: null },
      options,
    )) {
      errors.push({
        ...issue,
        field: `providerMetadata.x.threadPosts[${index}].${issue.field}`,
      });
    }
  });

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ───────────────────────────────────────────
// publishPost
// ───────────────────────────────────────────

function buildTweetBody(args: {
  contentText: string | null;
  mediaIds?: string[] | undefined;
  quotePostId?: string | null;
  replyToTweetId?: string | null;
}): Record<string, unknown> | null {
  const body: Record<string, unknown> = {};
  const text = args.contentText ?? "";
  if (text.length > 0) {
    body.text = text;
  }

  const mediaIds = args.mediaIds;
  if (mediaIds && mediaIds.length > 0) {
    body.media = { media_ids: mediaIds };
  }

  if (args.quotePostId && args.quotePostId.trim().length > 0) {
    body.quote_tweet_id = args.quotePostId.trim();
  }

  if (args.replyToTweetId && args.replyToTweetId.trim().length > 0) {
    body.reply = {
      in_reply_to_tweet_id: args.replyToTweetId.trim(),
    };
  }

  const hasTextOrMedia = typeof body.text === "string" || body.media !== undefined;
  if (body.reply && !hasTextOrMedia) {
    return null;
  }

  return Object.keys(body).length > 0 ? body : null;
}

async function createTweet(
  httpClient: XApiClient,
  accessToken: string,
  body: Record<string, unknown>,
): Promise<string> {
  const res = await httpClient.request<{ data?: { id?: string } }>({
    method: "POST",
    path: "/2/tweets",
    accessToken,
    json: body,
  });
  const id = res.data?.data?.id;
  if (!id) {
    throw new ProviderError("X API response missing tweet id");
  }
  return id;
}

async function rollbackPublishedTweets(
  creds: { accessToken: string },
  publishedIds: string[],
  httpClient: XApiClient,
): Promise<string | null> {
  const failures: string[] = [];
  for (const platformPostId of [...publishedIds].reverse()) {
    const result = await deletePost(
      {
        accountCredentials: JSON.stringify({ accessToken: creds.accessToken }),
        platformPostId,
      },
      httpClient,
    );
    if (!result.success) {
      failures.push(`${platformPostId}: ${result.error ?? "unknown error"}`);
    }
  }
  return failures.length > 0 ? failures.join("; ") : null;
}

export async function publishPost(
  input: PublishPostInput,
  httpClient: XApiClient,
): Promise<PublishResult> {
  const creds = requireXAccessTokenCredentials(input.accountCredentials, "post.create");
  const xMetadata = getXMetadata(input.providerMetadata);
  const mediaIds = await uploadMediaAttachments({
    accessToken: creds.accessToken,
    contentMedia: input.contentMedia,
    credentialMediaIds: creds.mediaIds,
    entity: "tweet",
    httpClient,
  });
  const rootBody = buildTweetBody({
    contentText: input.contentText,
    mediaIds,
    quotePostId: xMetadata?.quotePostId ?? null,
  });
  if (!rootBody) {
    return {
      success: false,
      platformPostId: null,
      publishedAt: null,
      error: "Empty post: neither text, media_ids, nor quote target provided",
    };
  }

  const publishedThreadIds: string[] = [];
  try {
    const rootId = await createTweet(httpClient, creds.accessToken, rootBody);
    publishedThreadIds.push(rootId);

    let previousTweetId = rootId;
    const threadPosts: XThreadPostSegment[] = xMetadata?.threadPosts ?? [];
    for (const segment of threadPosts) {
      const body = buildTweetBody({
        contentText: segment.contentText,
        replyToTweetId: previousTweetId,
      });
      if (!body) {
        throw new ProviderError("Thread segment is empty");
      }
      const threadTweetId = await createTweet(httpClient, creds.accessToken, body);
      publishedThreadIds.push(threadTweetId);
      previousTweetId = threadTweetId;
    }

    return {
      success: true,
      platformPostId: rootId,
      publishedAt: new Date(),
      providerMetadata: {
        x: {
          quotePostId: xMetadata?.quotePostId ?? null,
          threadPosts: xMetadata?.threadPosts ?? null,
          publishedThreadIds,
        },
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const rollbackError =
      publishedThreadIds.length > 0
        ? await rollbackPublishedTweets(creds, publishedThreadIds, httpClient)
        : null;
    return {
      success: false,
      platformPostId: null,
      publishedAt: null,
      error: rollbackError ? `${message} (rollback failed: ${rollbackError})` : message,
    };
  }
}

// ───────────────────────────────────────────
// deletePost
// ───────────────────────────────────────────

export async function deletePost(
  input: DeletePostInput,
  httpClient: XApiClient,
): Promise<DeleteResult> {
  const creds = requireXAccessTokenCredentials(input.accountCredentials, "post.delete");

  try {
    const res = await httpClient.request<{ data?: { deleted?: boolean } }>({
      method: "DELETE",
      path: `/2/tweets/${encodeURIComponent(input.platformPostId)}`,
      accessToken: creds.accessToken,
    });
    // 204 No Content or { data: { deleted: true } }
    if (res.status === 204 || res.data?.data?.deleted === true) {
      return { success: true };
    }
    return {
      success: false,
      error: "X API did not confirm deletion",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
