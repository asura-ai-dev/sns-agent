/**
 * provider-instagram: validatePost / publishPost / deletePost のテスト
 */
import { describe, it, expect } from "vitest";
import type { FetchLike } from "../http-client.js";
import { InstagramApiClient } from "../http-client.js";
import { validatePost, publishPost, deletePost } from "../post.js";

function buildCredentials(accessToken = "tok-123", igUserId = "ig-1"): string {
  return JSON.stringify({ accessToken, igUserId });
}

function mockFetch(
  responses: Array<{ status: number; body?: unknown; headers?: Record<string, string> }>,
): FetchLike {
  let i = 0;
  return async () => {
    const r = responses[i++];
    const headers = new Headers(r.headers);
    const nullBodyStatus = r.status === 204 || r.status === 205 || r.status === 304;
    const body = nullBodyStatus ? null : r.body === undefined ? "" : JSON.stringify(r.body);
    return new Response(body, { status: r.status, headers });
  };
}

describe("validatePost (Instagram)", () => {
  it("rejects text-only posts (feed requires media)", () => {
    const result = validatePost({
      platform: "instagram",
      contentText: "hello world",
      contentMedia: null,
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.field).toBe("contentMedia");
    expect(result.errors[0]?.message).toMatch(/image or video/);
  });

  it("accepts single image with caption", () => {
    const result = validatePost({
      platform: "instagram",
      contentText: "caption",
      contentMedia: [
        { type: "image", url: "https://cdn.example.com/a.jpg", mimeType: "image/jpeg" },
      ],
    });
    expect(result.valid).toBe(true);
  });

  it("rejects caption exceeding 2,200 characters", () => {
    const text = "a".repeat(2201);
    const result = validatePost({
      platform: "instagram",
      contentText: text,
      contentMedia: [
        { type: "image", url: "https://cdn.example.com/a.jpg", mimeType: "image/jpeg" },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "contentText")).toBe(true);
  });

  it("counts code points for captions (emoji-safe)", () => {
    const text = "😀".repeat(2200);
    const result = validatePost({
      platform: "instagram",
      contentText: text,
      contentMedia: [
        { type: "image", url: "https://cdn.example.com/a.jpg", mimeType: "image/jpeg" },
      ],
    });
    expect(result.valid).toBe(true);
  });

  it("rejects more than 10 images in carousel", () => {
    const result = validatePost({
      platform: "instagram",
      contentText: "hi",
      contentMedia: Array.from({ length: 11 }, (_, i) => ({
        type: "image" as const,
        url: `https://cdn.example.com/${i}.jpg`,
        mimeType: "image/jpeg",
      })),
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /Too many images/.test(e.message))).toBe(true);
  });

  it("rejects more than 1 single-media video", () => {
    const result = validatePost({
      platform: "instagram",
      contentText: "reel",
      contentMedia: [
        { type: "video", url: "https://cdn.example.com/a.mp4", mimeType: "video/mp4" },
        { type: "video", url: "https://cdn.example.com/b.mp4", mimeType: "video/mp4" },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /Too many videos/.test(e.message))).toBe(true);
  });

  it("warns on non-https media URLs", () => {
    const result = validatePost({
      platform: "instagram",
      contentText: "hi",
      contentMedia: [{ type: "image", url: "ftp://bad", mimeType: "image/jpeg" }],
    });
    expect(result.warnings.some((w) => /HTTPS URLs/.test(w.message))).toBe(true);
  });
});

describe("publishPost (Instagram)", () => {
  it("publishes a single image via container -> media_publish", async () => {
    const fetchImpl = mockFetch([
      // container creation
      { status: 200, body: { id: "creation-1" } },
      // media_publish
      { status: 200, body: { id: "media-999" } },
    ]);
    const httpClient = new InstagramApiClient({ fetchImpl });

    const result = await publishPost(
      {
        accountCredentials: buildCredentials(),
        contentText: "hello",
        contentMedia: [
          { type: "image", url: "https://cdn.example.com/a.jpg", mimeType: "image/jpeg" },
        ],
      },
      httpClient,
    );

    expect(result.success).toBe(true);
    expect(result.platformPostId).toBe("media-999");
    expect(result.publishedAt).toBeInstanceOf(Date);
  });

  it("publishes a carousel (children containers -> parent -> publish)", async () => {
    const fetchImpl = mockFetch([
      // child 1
      { status: 200, body: { id: "child-1" } },
      // child 2
      { status: 200, body: { id: "child-2" } },
      // parent
      { status: 200, body: { id: "parent-1" } },
      // publish
      { status: 200, body: { id: "media-carousel" } },
    ]);
    const httpClient = new InstagramApiClient({ fetchImpl });

    const result = await publishPost(
      {
        accountCredentials: buildCredentials(),
        contentText: "carousel",
        contentMedia: [
          { type: "image", url: "https://cdn.example.com/a.jpg", mimeType: "image/jpeg" },
          { type: "image", url: "https://cdn.example.com/b.jpg", mimeType: "image/jpeg" },
        ],
      },
      httpClient,
    );

    expect(result.success).toBe(true);
    expect(result.platformPostId).toBe("media-carousel");
  });

  it("publishes a reel (single video, media_type=REELS)", async () => {
    const fetchImpl = mockFetch([
      { status: 200, body: { id: "reel-container" } },
      { status: 200, body: { id: "reel-media" } },
    ]);
    const httpClient = new InstagramApiClient({ fetchImpl });

    const result = await publishPost(
      {
        accountCredentials: buildCredentials(),
        contentText: "my reel",
        contentMedia: [
          { type: "video", url: "https://cdn.example.com/r.mp4", mimeType: "video/mp4" },
        ],
      },
      httpClient,
    );
    expect(result.success).toBe(true);
    expect(result.platformPostId).toBe("reel-media");
  });

  it("returns error when no media is attached", async () => {
    const httpClient = new InstagramApiClient({
      fetchImpl: async () => new Response("", { status: 200 }),
    });
    const result = await publishPost(
      {
        accountCredentials: buildCredentials(),
        contentText: "text only",
        contentMedia: null,
      },
      httpClient,
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/at least one media/);
  });

  it("returns error on Instagram API failure", async () => {
    const fetchImpl = mockFetch([
      {
        status: 400,
        body: {
          error: {
            message: "Invalid parameter",
            type: "OAuthException",
            code: 100,
          },
        },
      },
    ]);
    const httpClient = new InstagramApiClient({ fetchImpl });

    const result = await publishPost(
      {
        accountCredentials: buildCredentials(),
        contentText: "hi",
        contentMedia: [
          { type: "image", url: "https://cdn.example.com/a.jpg", mimeType: "image/jpeg" },
        ],
      },
      httpClient,
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid parameter");
  });

  it("throws ProviderError for malformed credentials", async () => {
    const httpClient = new InstagramApiClient({
      fetchImpl: async () => new Response("", { status: 200 }),
    });
    await expect(
      publishPost(
        {
          accountCredentials: "not-json",
          contentText: "hi",
          contentMedia: [
            { type: "image", url: "https://cdn.example.com/a.jpg", mimeType: "image/jpeg" },
          ],
        },
        httpClient,
      ),
    ).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
  });
});

describe("deletePost (Instagram)", () => {
  it("returns success on 204 No Content", async () => {
    const fetchImpl = mockFetch([{ status: 204 }]);
    const httpClient = new InstagramApiClient({ fetchImpl });

    const result = await deletePost(
      { accountCredentials: buildCredentials(), platformPostId: "media-999" },
      httpClient,
    );
    expect(result.success).toBe(true);
  });

  it("returns success on { success: true }", async () => {
    const fetchImpl = mockFetch([{ status: 200, body: { success: true } }]);
    const httpClient = new InstagramApiClient({ fetchImpl });

    const result = await deletePost(
      { accountCredentials: buildCredentials(), platformPostId: "media-999" },
      httpClient,
    );
    expect(result.success).toBe(true);
  });

  it("surfaces API errors as error field", async () => {
    const fetchImpl = mockFetch([
      { status: 404, body: { error: { message: "Not Found", code: 100 } } },
    ]);
    const httpClient = new InstagramApiClient({ fetchImpl });

    const result = await deletePost(
      { accountCredentials: buildCredentials(), platformPostId: "missing" },
      httpClient,
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("Not Found");
  });
});
