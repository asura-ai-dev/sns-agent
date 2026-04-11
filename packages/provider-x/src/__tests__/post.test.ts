/**
 * provider-x: validatePost / publishPost / deletePost のテスト
 */
import { describe, it, expect } from "vitest";
import type { FetchLike } from "../http-client.js";
import { XApiClient } from "../http-client.js";
import { validatePost, publishPost, deletePost } from "../post.js";

function buildCredentials(accessToken = "tok-123"): string {
  return JSON.stringify({ accessToken });
}

function mockFetch(
  responses: Array<{ status: number; body?: unknown; headers?: Record<string, string> }>,
): FetchLike {
  let i = 0;
  return async () => {
    const r = responses[i++];
    const headers = new Headers(r.headers);
    // 204/205/304 cannot have a body per the Fetch spec
    const nullBodyStatus = r.status === 204 || r.status === 205 || r.status === 304;
    const body = nullBodyStatus ? null : r.body === undefined ? "" : JSON.stringify(r.body);
    return new Response(body, { status: r.status, headers });
  };
}

describe("validatePost (X)", () => {
  it("accepts simple text within the 280-char limit", () => {
    const result = validatePost({
      platform: "x",
      contentText: "hello world",
      contentMedia: null,
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects text exceeding 280 characters (basic plan)", () => {
    const text = "a".repeat(281);
    const result = validatePost({ platform: "x", contentText: text, contentMedia: null });
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.field).toBe("contentText");
  });

  it("allows up to 25,000 characters for premium plan", () => {
    const text = "a".repeat(25_000);
    const result = validatePost(
      { platform: "x", contentText: text, contentMedia: null },
      { premium: true },
    );
    expect(result.valid).toBe(true);
  });

  it("counts code points (emoji-safe)", () => {
    // surrogate pair の絵文字 140 個 = 140 code points (<= 280)
    const text = "😀".repeat(140);
    const result = validatePost({ platform: "x", contentText: text, contentMedia: null });
    expect(result.valid).toBe(true);
  });

  it("rejects empty post", () => {
    const result = validatePost({ platform: "x", contentText: "", contentMedia: null });
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.field).toBe("content");
  });

  it("rejects more than 4 images", () => {
    const result = validatePost({
      platform: "x",
      contentText: "hi",
      contentMedia: Array.from({ length: 5 }, (_, i) => ({
        type: "image" as const,
        url: `m-${i}`,
        mimeType: "image/png",
      })),
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /Too many images/.test(e.message))).toBe(true);
  });

  it("rejects more than 1 video", () => {
    const result = validatePost({
      platform: "x",
      contentText: "hi",
      contentMedia: [
        { type: "video", url: "v1", mimeType: "video/mp4" },
        { type: "video", url: "v2", mimeType: "video/mp4" },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /Too many videos/.test(e.message))).toBe(true);
  });

  it("rejects mixing images and videos", () => {
    const result = validatePost({
      platform: "x",
      contentText: "hi",
      contentMedia: [
        { type: "image", url: "i1", mimeType: "image/png" },
        { type: "video", url: "v1", mimeType: "video/mp4" },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /Cannot attach both images and videos/.test(e.message))).toBe(
      true,
    );
  });
});

describe("publishPost (X)", () => {
  it("returns platformPostId on success", async () => {
    const fetchImpl = mockFetch([
      {
        status: 201,
        body: { data: { id: "1234567890", text: "hello" } },
      },
    ]);
    const httpClient = new XApiClient({ fetchImpl });

    const result = await publishPost(
      {
        accountCredentials: buildCredentials(),
        contentText: "hello",
        contentMedia: null,
      },
      httpClient,
    );

    expect(result.success).toBe(true);
    expect(result.platformPostId).toBe("1234567890");
    expect(result.publishedAt).toBeInstanceOf(Date);
  });

  it("returns error on X API failure", async () => {
    const fetchImpl = mockFetch([
      {
        status: 403,
        body: { title: "Forbidden", detail: "Unauthorized write", type: "https://..." },
      },
    ]);
    const httpClient = new XApiClient({ fetchImpl });

    const result = await publishPost(
      {
        accountCredentials: buildCredentials(),
        contentText: "hello",
        contentMedia: null,
      },
      httpClient,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Unauthorized write");
  });

  it("rejects empty payload", async () => {
    const httpClient = new XApiClient({ fetchImpl: async () => new Response("", { status: 200 }) });
    const result = await publishPost(
      {
        accountCredentials: buildCredentials(),
        contentText: null,
        contentMedia: null,
      },
      httpClient,
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Empty post/);
  });

  it("throws-mapped ProviderError for malformed credentials", async () => {
    const httpClient = new XApiClient({ fetchImpl: async () => new Response("", { status: 200 }) });
    await expect(
      publishPost(
        { accountCredentials: "not-json", contentText: "hi", contentMedia: null },
        httpClient,
      ),
    ).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
  });
});

describe("deletePost (X)", () => {
  it("returns success on 204 No Content", async () => {
    const fetchImpl = mockFetch([{ status: 204 }]);
    const httpClient = new XApiClient({ fetchImpl });

    const result = await deletePost(
      { accountCredentials: buildCredentials(), platformPostId: "1234567890" },
      httpClient,
    );
    expect(result.success).toBe(true);
  });

  it("returns success on { data: { deleted: true } }", async () => {
    const fetchImpl = mockFetch([{ status: 200, body: { data: { deleted: true } } }]);
    const httpClient = new XApiClient({ fetchImpl });

    const result = await deletePost(
      { accountCredentials: buildCredentials(), platformPostId: "1234567890" },
      httpClient,
    );
    expect(result.success).toBe(true);
  });

  it("surfaces API errors as error field", async () => {
    const fetchImpl = mockFetch([{ status: 404, body: { detail: "Not Found" } }]);
    const httpClient = new XApiClient({ fetchImpl });

    const result = await deletePost(
      { accountCredentials: buildCredentials(), platformPostId: "missing" },
      httpClient,
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("Not Found");
  });
});
