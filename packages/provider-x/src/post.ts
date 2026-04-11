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
} from "@sns-agent/core";
import { ProviderError } from "@sns-agent/core";
import { XApiClient } from "./http-client.js";
import {
  X_MAX_IMAGES,
  X_MAX_VIDEOS,
  X_TEXT_LIMIT_BASIC,
  X_TEXT_LIMIT_PREMIUM,
} from "./capabilities.js";

export interface XValidateOptions {
  /** Premium プランの場合 true。デフォルトは Basic (280 文字) */
  premium?: boolean;
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
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  const text = input.contentText ?? "";
  const media = input.contentMedia ?? [];
  const images = media.filter((m) => m.type === "image");
  const videos = media.filter((m) => m.type === "video");

  const textLimit = options.premium ? X_TEXT_LIMIT_PREMIUM : X_TEXT_LIMIT_BASIC;

  // 少なくとも 1 つのコンテンツ
  if (text.length === 0 && media.length === 0) {
    errors.push({
      field: "content",
      message: "Post must contain text or media",
    });
  }

  // テキスト長 (コードポイント単位で数える)
  const textLength = Array.from(text).length;
  if (textLength > textLimit) {
    errors.push({
      field: "contentText",
      message: `Text exceeds the ${textLimit}-character limit (current: ${textLength})`,
      constraint: { limit: textLimit, current: textLength },
    });
  }

  // 画像枚数
  if (images.length > X_MAX_IMAGES) {
    errors.push({
      field: "contentMedia",
      message: `Too many images (max ${X_MAX_IMAGES}, got ${images.length})`,
      constraint: { maxImages: X_MAX_IMAGES },
    });
  }

  // 動画本数
  if (videos.length > X_MAX_VIDEOS) {
    errors.push({
      field: "contentMedia",
      message: `Too many videos (max ${X_MAX_VIDEOS}, got ${videos.length})`,
      constraint: { maxVideos: X_MAX_VIDEOS },
    });
  }

  // 画像と動画の同時添付は X では不可
  if (images.length > 0 && videos.length > 0) {
    errors.push({
      field: "contentMedia",
      message: "Cannot attach both images and videos in the same post",
    });
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

/**
 * accountCredentials から access_token を抽出する。
 * credentials は JSON 文字列 { accessToken, refreshToken, expiresAt } を想定。
 * 呼び出し元 (usecase) が復号した状態で渡す。
 */
interface AccessCredentials {
  accessToken: string;
  /** 既にアップロード済みの media_id のリスト (v1 は外部アップロード済みのみ対応) */
  mediaIds?: string[];
}

function parseCredentials(raw: string): AccessCredentials {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    if (typeof obj.accessToken !== "string" || obj.accessToken.length === 0) {
      throw new Error("accessToken missing");
    }
    const mediaIds =
      Array.isArray(obj.mediaIds) && obj.mediaIds.every((id) => typeof id === "string")
        ? (obj.mediaIds as string[])
        : undefined;
    return { accessToken: obj.accessToken, mediaIds };
  } catch (err) {
    throw new ProviderError(`Invalid X credentials: ${(err as Error).message}`, {
      cause: String(err),
    });
  }
}

export async function publishPost(
  input: PublishPostInput,
  httpClient: XApiClient,
): Promise<PublishResult> {
  const creds = parseCredentials(input.accountCredentials);

  const body: Record<string, unknown> = {};
  if (input.contentText && input.contentText.length > 0) {
    body.text = input.contentText;
  }

  // メディア添付: 呼び出し側で事前に media upload を済ませて credentials.mediaIds
  // もしくは input.contentMedia[].url に media_id を入れておく運用を v1 は取る
  const media = input.contentMedia ?? [];
  const mediaIdsFromInput = media
    .map((m) => m.url)
    .filter((u) => typeof u === "string" && u.length > 0 && !u.startsWith("http"));
  const mediaIds = creds.mediaIds ?? (mediaIdsFromInput.length > 0 ? mediaIdsFromInput : undefined);
  if (mediaIds && mediaIds.length > 0) {
    body.media = { media_ids: mediaIds };
  }

  if (Object.keys(body).length === 0) {
    return {
      success: false,
      platformPostId: null,
      publishedAt: null,
      error: "Empty post: neither text nor media_ids provided",
    };
  }

  try {
    const res = await httpClient.request<{ data?: { id?: string; text?: string } }>({
      method: "POST",
      path: "/2/tweets",
      accessToken: creds.accessToken,
      json: body,
    });
    const id = res.data?.data?.id;
    if (!id) {
      return {
        success: false,
        platformPostId: null,
        publishedAt: null,
        error: "X API response missing tweet id",
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

// ───────────────────────────────────────────
// deletePost
// ───────────────────────────────────────────

export async function deletePost(
  input: DeletePostInput,
  httpClient: XApiClient,
): Promise<DeleteResult> {
  const creds = parseCredentials(input.accountCredentials);

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
