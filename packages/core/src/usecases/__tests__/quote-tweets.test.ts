import { describe, expect, it } from "vitest";
import type {
  AccountRepository,
  PostRepository,
  QuoteTweet,
  QuoteTweetRepository,
  QuoteTweetUpsertInput,
  SocialAccount,
  SocialProvider,
} from "../..";
import { encrypt } from "../../domain/crypto.js";
import {
  discoverQuoteTweetsForTrackedSources,
  listQuoteTweets,
  performQuoteTweetAction,
  type QuoteTweetUsecaseDeps,
} from "../quote-tweets.js";

const TEST_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const PLAINTEXT_CREDS = '{"accessToken":"tok","xUserId":"brand-x"}';

function mockAccount(): SocialAccount {
  return {
    id: "acc-1",
    workspaceId: "ws-1",
    platform: "x",
    displayName: "Brand",
    externalAccountId: "brand-x",
    credentialsEncrypted: encrypt(PLAINTEXT_CREDS, TEST_ENCRYPTION_KEY),
    tokenExpiresAt: null,
    status: "active",
    capabilities: null,
    createdAt: new Date("2026-04-29T00:00:00Z"),
    updatedAt: new Date("2026-04-29T00:00:00Z"),
  };
}

function mockAccountRepo(account: SocialAccount): AccountRepository {
  return {
    findById: async (id) => (id === account.id ? account : null),
    findByWorkspace: async () => [account],
    create: async () => {
      throw new Error("not used");
    },
    update: async () => {
      throw new Error("not used");
    },
    delete: async () => {
      throw new Error("not used");
    },
  };
}

function mockPostRepo(): PostRepository {
  return {
    findById: async () => null,
    findByWorkspace: async () => [
      {
        id: "post-1",
        workspaceId: "ws-1",
        socialAccountId: "acc-1",
        platform: "x",
        status: "published",
        contentText: "launch",
        contentMedia: null,
        providerMetadata: null,
        platformPostId: "source-1",
        validationResult: null,
        idempotencyKey: null,
        createdBy: "user-1",
        createdAt: new Date("2026-04-29T00:00:00Z"),
        updatedAt: new Date("2026-04-29T00:00:00Z"),
        publishedAt: new Date("2026-04-29T00:00:00Z"),
      },
    ],
    countByWorkspace: async () => 1,
    create: async () => {
      throw new Error("not used");
    },
    update: async () => {
      throw new Error("not used");
    },
    delete: async () => {
      throw new Error("not used");
    },
    findByIdempotencyKey: async () => null,
  };
}

function mockQuoteRepo(): QuoteTweetRepository & { rows: Map<string, QuoteTweet> } {
  const rows = new Map<string, QuoteTweet>();
  let seq = 0;
  return {
    rows,
    findById: async (id) => rows.get(id) ?? null,
    findBySourceAndQuote: async (workspaceId, socialAccountId, sourceTweetId, quoteTweetId) =>
      [...rows.values()].find(
        (row) =>
          row.workspaceId === workspaceId &&
          row.socialAccountId === socialAccountId &&
          row.sourceTweetId === sourceTweetId &&
          row.quoteTweetId === quoteTweetId,
      ) ?? null,
    findByWorkspace: async (workspaceId, filters) =>
      [...rows.values()].filter(
        (row) =>
          row.workspaceId === workspaceId &&
          (!filters?.socialAccountId || row.socialAccountId === filters.socialAccountId) &&
          (!filters?.sourceTweetId || row.sourceTweetId === filters.sourceTweetId),
      ),
    upsert: async (input: QuoteTweetUpsertInput) => {
      const key = `${input.workspaceId}:${input.socialAccountId}:${input.sourceTweetId}:${input.quoteTweetId}`;
      const existing = [...rows.values()].find(
        (row) =>
          `${row.workspaceId}:${row.socialAccountId}:${row.sourceTweetId}:${row.quoteTweetId}` ===
          key,
      );
      const row: QuoteTweet = {
        ...input,
        id: existing?.id ?? `quote-${++seq}`,
        lastActionType: existing?.lastActionType ?? null,
        lastActionExternalId: existing?.lastActionExternalId ?? null,
        lastActionAt: existing?.lastActionAt ?? null,
        createdAt: existing?.createdAt ?? input.discoveredAt,
        updatedAt: input.lastSeenAt,
      };
      rows.set(row.id, row);
      return row;
    },
    recordAction: async (id, action) => {
      const existing = rows.get(id);
      if (!existing) throw new Error("not found");
      const row: QuoteTweet = {
        ...existing,
        lastActionType: action.actionType,
        lastActionExternalId: action.externalActionId,
        lastActionAt: action.actedAt,
        updatedAt: action.actedAt,
      };
      rows.set(id, row);
      return row;
    },
  };
}

function mockProvider(): SocialProvider {
  return {
    platform: "x",
    getCapabilities: () => ({
      textPost: true,
      imagePost: true,
      videoPost: true,
      threadPost: true,
      directMessage: true,
      commentReply: true,
      broadcast: false,
      nativeSchedule: false,
      usageApi: false,
    }),
    connectAccount: async () => ({}),
    validatePost: async () => ({ valid: true, errors: [], warnings: [] }),
    publishPost: async () => ({ success: true, platformPostId: "post-1", publishedAt: null }),
    deletePost: async () => ({ success: true }),
    listQuoteTweets: async () => ({
      quotes: [
        {
          sourceTweetId: "source-1",
          quoteTweetId: "quote-1",
          authorExternalId: "user-1",
          authorUsername: "alice",
          authorDisplayName: "Alice",
          authorProfileImageUrl: "https://cdn.example.test/alice.jpg",
          authorVerified: true,
          contentText: "nice launch",
          contentMedia: null,
          quotedAt: new Date("2026-04-29T00:05:00Z"),
          metrics: { like_count: 7 },
          providerMetadata: { lang: "en" },
        },
      ],
      nextCursor: null,
    }),
    sendReply: async () => ({ success: true, externalMessageId: "reply-1" }),
    performEngagementAction: async (input) => ({
      success: true,
      externalActionId: `brand-x:${input.actionType}:${input.targetPostId}`,
    }),
  };
}

function buildDeps(): QuoteTweetUsecaseDeps & { quoteTweetRepo: ReturnType<typeof mockQuoteRepo> } {
  const account = mockAccount();
  const quoteTweetRepo = mockQuoteRepo();
  return {
    accountRepo: mockAccountRepo(account),
    postRepo: mockPostRepo(),
    quoteTweetRepo,
    providers: new Map([["x", mockProvider()]]),
    encryptionKey: TEST_ENCRYPTION_KEY,
  };
}

describe("quote tweets usecase", () => {
  it("discovers quotes for tracked source tweets and dedupes by source tweet and quote id", async () => {
    const deps = buildDeps();

    const first = await discoverQuoteTweetsForTrackedSources(deps, {
      workspaceId: "ws-1",
      socialAccountId: "acc-1",
      now: new Date("2026-04-29T00:10:00Z"),
    });
    const second = await discoverQuoteTweetsForTrackedSources(deps, {
      workspaceId: "ws-1",
      socialAccountId: "acc-1",
      now: new Date("2026-04-29T00:11:00Z"),
    });

    expect(first).toMatchObject({ sourceTweetsScanned: 1, quotesScanned: 1, quotesStored: 1 });
    expect(second).toMatchObject({ sourceTweetsScanned: 1, quotesScanned: 1, quotesStored: 1 });
    const listed = await listQuoteTweets(deps, "ws-1", { socialAccountId: "acc-1" });
    expect(listed.data).toHaveLength(1);
    expect(listed.data[0]).toMatchObject({
      sourceTweetId: "source-1",
      quoteTweetId: "quote-1",
      authorUsername: "alice",
      authorDisplayName: "Alice",
      authorProfileImageUrl: "https://cdn.example.test/alice.jpg",
      authorVerified: true,
    });
  });

  it("triggers reply like and repost actions against the stored quote when permissions allow", async () => {
    const deps = buildDeps();
    await discoverQuoteTweetsForTrackedSources(deps, {
      workspaceId: "ws-1",
      socialAccountId: "acc-1",
      now: new Date("2026-04-29T00:10:00Z"),
    });
    const quote = (await listQuoteTweets(deps, "ws-1", { socialAccountId: "acc-1" })).data[0]!;

    const reply = await performQuoteTweetAction(deps, {
      workspaceId: "ws-1",
      quoteTweetId: quote.id,
      actionType: "reply",
      actorId: "user-editor",
      contentText: "Thanks for quoting us",
    });
    const like = await performQuoteTweetAction(deps, {
      workspaceId: "ws-1",
      quoteTweetId: quote.id,
      actionType: "like",
      actorId: "user-editor",
    });
    const repost = await performQuoteTweetAction(deps, {
      workspaceId: "ws-1",
      quoteTweetId: quote.id,
      actionType: "repost",
      actorId: "user-editor",
    });

    expect(reply.quote.lastActionType).toBe("reply");
    expect(reply.externalActionId).toBe("reply-1");
    expect(like.externalActionId).toBe("brand-x:like:quote-1");
    expect(repost.quote.lastActionType).toBe("repost");
  });
});
