import { promises as fs } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import type { MediaAttachment } from "@sns-agent/core";
import { ProviderError } from "@sns-agent/core";
import { X_MAX_IMAGE_BYTES, X_MAX_VIDEO_BYTES } from "./capabilities.js";
import { XApiClient } from "./http-client.js";

const CHUNK_SIZE_BYTES = 4 * 1024 * 1024;
const MAX_PROCESSING_POLLS = 10;
const DEFAULT_PROCESSING_DELAY_MS = 1000;

type UploadEntity = "tweet" | "dm";
type MediaCategory =
  | "tweet_image"
  | "tweet_gif"
  | "tweet_video"
  | "dm_image"
  | "dm_gif"
  | "dm_video";

interface UploadMediaInput {
  accessToken: string;
  contentMedia: MediaAttachment[] | null | undefined;
  credentialMediaIds?: string[] | undefined;
  entity: UploadEntity;
  httpClient: XApiClient;
}

interface ResolvedMediaAttachment {
  bytes: Uint8Array;
  filename: string;
  mimeType: string;
  type: MediaAttachment["type"];
}

interface MediaUploadResponse {
  data?: {
    id?: string;
    processing_info?: {
      state?: "pending" | "in_progress" | "succeeded" | "failed";
      check_after_secs?: number;
      error?: {
        code?: number;
        name?: string;
        message?: string;
      };
    };
  };
}

function isPreUploadedMediaId(value: string): boolean {
  const trimmed = value.trim();
  return (
    trimmed.length > 0 &&
    !trimmed.startsWith("http://") &&
    !trimmed.startsWith("https://") &&
    !trimmed.startsWith("file://") &&
    !trimmed.startsWith("data:") &&
    !trimmed.startsWith("blob:")
  );
}

function getMediaCategory(
  entity: UploadEntity,
  attachment: ResolvedMediaAttachment,
): MediaCategory {
  if (attachment.type === "video") {
    return entity === "dm" ? "dm_video" : "tweet_video";
  }
  if (attachment.mimeType === "image/gif") {
    return entity === "dm" ? "dm_gif" : "tweet_gif";
  }
  return entity === "dm" ? "dm_image" : "tweet_image";
}

function ensureXMediaSizeLimit(attachment: ResolvedMediaAttachment): void {
  const bytes = attachment.bytes.byteLength;
  if (attachment.type === "image" && bytes > X_MAX_IMAGE_BYTES) {
    throw new ProviderError(
      `X image upload exceeds ${X_MAX_IMAGE_BYTES} bytes (received ${bytes} bytes)`,
    );
  }
  if (attachment.type === "video" && bytes > X_MAX_VIDEO_BYTES) {
    throw new ProviderError(
      `X video upload exceeds ${X_MAX_VIDEO_BYTES} bytes (received ${bytes} bytes)`,
    );
  }
}

function parseDataUrl(url: string): { mimeType: string; bytes: Uint8Array } {
  const match = /^data:([^;,]+)?(;base64)?,([\s\S]+)$/u.exec(url);
  if (!match) {
    throw new ProviderError("Invalid media data URL");
  }

  const mimeType = match[1] ?? "application/octet-stream";
  const encoded = match[3] ?? "";
  if (!match[2]) {
    throw new ProviderError("Media data URL must be base64 encoded");
  }

  return {
    mimeType,
    bytes: new Uint8Array(Buffer.from(encoded, "base64")),
  };
}

async function resolveAttachment(
  attachment: MediaAttachment,
  index: number,
): Promise<ResolvedMediaAttachment> {
  const fallbackName = `${attachment.type}-${index + 1}`;
  const declaredMimeType =
    typeof attachment.mimeType === "string" && attachment.mimeType.length > 0
      ? attachment.mimeType
      : attachment.type === "video"
        ? "video/mp4"
        : "image/png";

  if (attachment.url.startsWith("data:")) {
    const parsed = parseDataUrl(attachment.url);
    return {
      bytes: parsed.bytes,
      filename: `${fallbackName}.${attachment.type === "video" ? "mp4" : "png"}`,
      mimeType: parsed.mimeType || declaredMimeType,
      type: attachment.type,
    };
  }

  if (attachment.url.startsWith("file://")) {
    const filePath = fileURLToPath(attachment.url);
    const bytes = new Uint8Array(await fs.readFile(filePath));
    return {
      bytes,
      filename: basename(filePath) || fallbackName,
      mimeType: declaredMimeType,
      type: attachment.type,
    };
  }

  throw new ProviderError(
    "X media upload supports only pre-uploaded media IDs, data URLs, or file:// URLs",
  );
}

function createMultipartForm(values: Array<[string, string | Blob, string?]>): FormData {
  const form = new FormData();
  for (const [key, value, filename] of values) {
    if (value instanceof Blob) {
      form.append(key, value, filename);
    } else {
      form.append(key, value);
    }
  }
  return form;
}

async function waitForProcessing(
  httpClient: XApiClient,
  accessToken: string,
  mediaId: string,
): Promise<void> {
  for (let attempt = 0; attempt < MAX_PROCESSING_POLLS; attempt += 1) {
    const status = await httpClient.request<MediaUploadResponse>({
      method: "GET",
      path: "/2/media/upload",
      accessToken,
      query: {
        command: "STATUS",
        media_id: mediaId,
      },
    });

    const processingInfo = status.data?.data?.processing_info;
    if (!processingInfo || processingInfo.state === "succeeded") {
      return;
    }

    if (processingInfo.state === "failed") {
      const reason =
        processingInfo.error?.message ??
        processingInfo.error?.name ??
        "unknown media processing error";
      throw new ProviderError(`X media processing failed: ${reason}`);
    }

    const waitMs = Math.max(
      (processingInfo.check_after_secs ?? 0) * 1000,
      DEFAULT_PROCESSING_DELAY_MS,
    );
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  throw new ProviderError(`X media processing timed out for media_id ${mediaId}`);
}

async function uploadChunkedMedia(
  httpClient: XApiClient,
  accessToken: string,
  attachment: ResolvedMediaAttachment,
  entity: UploadEntity,
): Promise<string> {
  ensureXMediaSizeLimit(attachment);

  const initRes = await httpClient.request<MediaUploadResponse>({
    method: "POST",
    path: "/2/media/upload",
    accessToken,
    formData: createMultipartForm([
      ["command", "INIT"],
      ["media_type", attachment.mimeType],
      ["total_bytes", String(attachment.bytes.byteLength)],
      ["media_category", getMediaCategory(entity, attachment)],
    ]),
  });

  const mediaId = initRes.data?.data?.id;
  if (!mediaId) {
    throw new ProviderError("X media upload INIT response missing media id");
  }

  for (
    let offset = 0, segmentIndex = 0;
    offset < attachment.bytes.byteLength;
    offset += CHUNK_SIZE_BYTES, segmentIndex += 1
  ) {
    const chunk = attachment.bytes.slice(offset, offset + CHUNK_SIZE_BYTES);
    await httpClient.request<MediaUploadResponse>({
      method: "POST",
      path: "/2/media/upload",
      accessToken,
      formData: createMultipartForm([
        ["command", "APPEND"],
        ["media_id", mediaId],
        ["segment_index", String(segmentIndex)],
        ["media", new Blob([chunk], { type: attachment.mimeType }), attachment.filename],
      ]),
    });
  }

  const finalizeRes = await httpClient.request<MediaUploadResponse>({
    method: "POST",
    path: "/2/media/upload",
    accessToken,
    formData: createMultipartForm([
      ["command", "FINALIZE"],
      ["media_id", mediaId],
    ]),
  });

  if (!finalizeRes.data?.data?.id) {
    throw new ProviderError("X media upload FINALIZE response missing media id");
  }

  if (finalizeRes.data.data.processing_info) {
    await waitForProcessing(httpClient, accessToken, mediaId);
  }

  return mediaId;
}

export async function uploadMediaAttachments(
  input: UploadMediaInput,
): Promise<string[] | undefined> {
  const attachments = input.contentMedia ?? [];
  const mediaIds: string[] = [];

  if (input.credentialMediaIds && input.credentialMediaIds.length > 0) {
    mediaIds.push(...input.credentialMediaIds);
  }

  for (let index = 0; index < attachments.length; index += 1) {
    const attachment = attachments[index];
    if (isPreUploadedMediaId(attachment.url)) {
      mediaIds.push(attachment.url.trim());
      continue;
    }

    const resolved = await resolveAttachment(attachment, index);
    const uploadedId = await uploadChunkedMedia(
      input.httpClient,
      input.accessToken,
      resolved,
      input.entity,
    );
    mediaIds.push(uploadedId);
  }

  return mediaIds.length > 0 ? mediaIds : undefined;
}
