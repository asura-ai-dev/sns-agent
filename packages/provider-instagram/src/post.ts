/**
 * Instagram 投稿操作
 *
 * - validatePost: キャプション 2,200 文字チェック、フィード投稿は画像必須
 * - publishPost:  Container 作成 -> 公開 の 2 ステップ API
 *     1) POST /{ig-user-id}/media          (Container 作成)
 *     2) POST /{ig-user-id}/media_publish  (公開)
 *     カルーセルの場合は子メディア Container を先に作って children に渡す
 * - deletePost:   DELETE /{ig-media-id}
 *
 * design.md セクション 11 (投稿バリデーション) / Task 4002 の仕様に準拠。
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
} from "@sns-agent/core";
import { ProviderError } from "@sns-agent/core";
import { InstagramApiClient } from "./http-client.js";
import {
  INSTAGRAM_TEXT_LIMIT,
  INSTAGRAM_MAX_IMAGES,
  INSTAGRAM_MAX_VIDEOS,
} from "./capabilities.js";

/**
 * 投稿バリデーション
 *
 * チェック項目:
 * - 画像 / 動画が最低 1 つ存在する（フィード投稿は画像必須）
 * - キャプション長が 2,200 文字以内
 * - 画像枚数が 10 枚以内 (カルーセル)
 * - 動画本数が 1 本以内 (単一メディア投稿)
 * - メディア URL は HTTPS で公開アクセス可能である必要がある (Graph API の仕様)
 */
export function validatePost(input: ValidatePostInput): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  const text = input.contentText ?? "";
  const media = input.contentMedia ?? [];
  const images = media.filter((m) => m.type === "image");
  const videos = media.filter((m) => m.type === "video");

  // フィード投稿は画像/動画必須 (Instagram はテキストのみの投稿不可)
  if (media.length === 0) {
    errors.push({
      field: "contentMedia",
      message: "Instagram posts require at least one image or video",
    });
  }

  // キャプション長 (コードポイント単位)
  const textLength = Array.from(text).length;
  if (textLength > INSTAGRAM_TEXT_LIMIT) {
    errors.push({
      field: "contentText",
      message: `Caption exceeds the ${INSTAGRAM_TEXT_LIMIT}-character limit (current: ${textLength})`,
      constraint: { limit: INSTAGRAM_TEXT_LIMIT, current: textLength },
    });
  }

  // 画像枚数
  if (images.length > INSTAGRAM_MAX_IMAGES) {
    errors.push({
      field: "contentMedia",
      message: `Too many images (max ${INSTAGRAM_MAX_IMAGES}, got ${images.length})`,
      constraint: { maxImages: INSTAGRAM_MAX_IMAGES },
    });
  }

  // 動画本数 (単一メディアとしての上限)
  if (videos.length > INSTAGRAM_MAX_VIDEOS) {
    errors.push({
      field: "contentMedia",
      message: `Too many videos (max ${INSTAGRAM_MAX_VIDEOS}, got ${videos.length})`,
      constraint: { maxVideos: INSTAGRAM_MAX_VIDEOS },
    });
  }

  // メディア URL が HTTPS かチェック (Instagram Graph API の要件)
  for (let i = 0; i < media.length; i++) {
    const m = media[i];
    if (!m.url) continue;
    if (!m.url.startsWith("https://") && !m.url.startsWith("http://")) {
      warnings.push({
        field: `contentMedia[${i}].url`,
        message: "Instagram requires publicly accessible HTTPS URLs for media",
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ───────────────────────────────────────────
// publishPost
// ───────────────────────────────────────────

interface AccessCredentials {
  /** IG Business Account ID (ig-user-id) */
  igUserId: string;
  /** Facebook Page Access Token または IG User Access Token */
  accessToken: string;
}

function parseCredentials(raw: string): AccessCredentials {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    if (typeof obj.accessToken !== "string" || obj.accessToken.length === 0) {
      throw new Error("accessToken missing");
    }
    if (typeof obj.igUserId !== "string" || obj.igUserId.length === 0) {
      throw new Error("igUserId missing");
    }
    return { accessToken: obj.accessToken, igUserId: obj.igUserId };
  } catch (err) {
    throw new ProviderError(`Invalid Instagram credentials: ${(err as Error).message}`, {
      cause: String(err),
    });
  }
}

/**
 * Instagram Graph API は Container 作成 → 公開の 2 ステップ。
 * - 単一画像: POST /{ig-user-id}/media?image_url=...&caption=...
 * - 単一動画/リール: POST /{ig-user-id}/media?media_type=REELS&video_url=...
 * - カルーセル: 子 Container を作り、親 Container で is_carousel_item=true の id を children に渡す
 * 最後に POST /{ig-user-id}/media_publish?creation_id=...
 */
export async function publishPost(
  input: PublishPostInput,
  httpClient: InstagramApiClient,
): Promise<PublishResult> {
  const creds = parseCredentials(input.accountCredentials);
  const caption = input.contentText ?? "";
  const media = input.contentMedia ?? [];

  if (media.length === 0) {
    return {
      success: false,
      platformPostId: null,
      publishedAt: null,
      error: "Instagram requires at least one media attachment",
    };
  }

  try {
    const creationId = await createContainer(
      creds.igUserId,
      creds.accessToken,
      caption,
      media,
      httpClient,
    );

    const publishRes = await httpClient.request<{ id?: string }>({
      method: "POST",
      path: `/${encodeURIComponent(creds.igUserId)}/media_publish`,
      accessToken: creds.accessToken,
      query: { creation_id: creationId },
    });

    const id = publishRes.data?.id;
    if (!id) {
      return {
        success: false,
        platformPostId: null,
        publishedAt: null,
        error: "Instagram API response missing media id",
      };
    }
    return {
      success: true,
      platformPostId: id,
      publishedAt: new Date(),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      platformPostId: null,
      publishedAt: null,
      error: message,
    };
  }
}

/**
 * Container 作成。single / carousel / reel を判別する。
 * 戻り値は creation_id (= container id)。
 */
async function createContainer(
  igUserId: string,
  accessToken: string,
  caption: string,
  media: MediaAttachment[],
  httpClient: InstagramApiClient,
): Promise<string> {
  if (media.length === 1) {
    const m = media[0];
    const query: Record<string, string | number | undefined> = {
      caption: caption.length > 0 ? caption : undefined,
    };
    if (m.type === "video") {
      query.media_type = "REELS";
      query.video_url = m.url;
    } else {
      query.image_url = m.url;
    }
    const res = await httpClient.request<{ id?: string }>({
      method: "POST",
      path: `/${encodeURIComponent(igUserId)}/media`,
      accessToken,
      query,
    });
    const id = res.data?.id;
    if (!id) {
      throw new ProviderError("Instagram: container creation did not return id", {
        body: res.data,
      });
    }
    return id;
  }

  // Carousel: 子 Container を先に全て作成
  const childIds: string[] = [];
  for (const m of media) {
    const query: Record<string, string | number | undefined> = {
      is_carousel_item: "true",
    };
    if (m.type === "video") {
      query.media_type = "VIDEO";
      query.video_url = m.url;
    } else {
      query.image_url = m.url;
    }
    const res = await httpClient.request<{ id?: string }>({
      method: "POST",
      path: `/${encodeURIComponent(igUserId)}/media`,
      accessToken,
      query,
    });
    const id = res.data?.id;
    if (!id) {
      throw new ProviderError("Instagram: carousel child container creation did not return id", {
        body: res.data,
      });
    }
    childIds.push(id);
  }

  // 親 Carousel Container を作成
  const parentRes = await httpClient.request<{ id?: string }>({
    method: "POST",
    path: `/${encodeURIComponent(igUserId)}/media`,
    accessToken,
    query: {
      media_type: "CAROUSEL",
      children: childIds.join(","),
      caption: caption.length > 0 ? caption : undefined,
    },
  });
  const parentId = parentRes.data?.id;
  if (!parentId) {
    throw new ProviderError("Instagram: carousel parent container creation did not return id", {
      body: parentRes.data,
    });
  }
  return parentId;
}

// ───────────────────────────────────────────
// deletePost
// ───────────────────────────────────────────

export async function deletePost(
  input: DeletePostInput,
  httpClient: InstagramApiClient,
): Promise<DeleteResult> {
  const creds = parseCredentials(input.accountCredentials);

  try {
    const res = await httpClient.request<{ success?: boolean }>({
      method: "DELETE",
      path: `/${encodeURIComponent(input.platformPostId)}`,
      accessToken: creds.accessToken,
    });
    // 204 No Content or { success: true }
    if (res.status === 204 || res.data?.success === true) {
      return { success: true };
    }
    return {
      success: false,
      error: "Instagram API did not confirm deletion",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
