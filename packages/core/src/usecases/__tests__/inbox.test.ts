/**
 * 受信・会話管理ユースケースのテスト (Task 6003)
 *
 * listThreads / getThread / processInboundMessage / sendReply
 */
import { describe, it, expect, vi } from "vitest";
import type {
  ConversationThread,
  Message,
  SocialAccount,
  ThreadStatus,
} from "../../domain/entities.js";
import type {
  AccountRepository,
  ConversationRepository,
  ConversationFilterOptions,
  MessageRepository,
  UsageRepository,
} from "../../interfaces/repositories.js";
import type { SocialProvider } from "../../interfaces/social-provider.js";
import { encrypt } from "../../domain/crypto.js";
import {
  listThreads,
  getThread,
  processInboundMessage,
  sendReply,
  syncInboxFromProvider,
  type InboxUsecaseDeps,
} from "../inbox.js";
import { NotFoundError, ProviderError, ValidationError } from "../../errors/domain-error.js";

const TEST_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const PLAINTEXT_CREDS = '{"access_token":"tok"}';

// ───────────────────────────────────────────
// モック
// ───────────────────────────────────────────

function mockAccount(overrides: Partial<SocialAccount> = {}): SocialAccount {
  return {
    id: "acc-1",
    workspaceId: "ws-1",
    platform: "x",
    displayName: "Test",
    externalAccountId: "ext-1",
    credentialsEncrypted: encrypt(PLAINTEXT_CREDS, TEST_ENCRYPTION_KEY),
    tokenExpiresAt: new Date("2027-01-01"),
    status: "active",
    capabilities: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function mockAccountRepo(accounts: SocialAccount[]): AccountRepository {
  const store = new Map(accounts.map((a) => [a.id, { ...a }]));
  return {
    findById: async (id) => (store.has(id) ? { ...store.get(id)! } : null),
    findByWorkspace: async (ws) => [...store.values()].filter((a) => a.workspaceId === ws),
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

function mockConversationRepo(initial: ConversationThread[] = []): ConversationRepository {
  const store = new Map(initial.map((t) => [t.id, { ...t }]));
  let seq = initial.length;
  return {
    findById: async (id) => (store.has(id) ? { ...store.get(id)! } : null),
    findByWorkspace: async (ws, options?: ConversationFilterOptions) => {
      let list = [...store.values()].filter((t) => t.workspaceId === ws);
      if (options?.platform) list = list.filter((t) => t.platform === options.platform);
      if (options?.status) list = list.filter((t) => t.status === options.status);
      // lastMessageAt 降順
      list.sort((a, b) => {
        const av = a.lastMessageAt?.getTime() ?? 0;
        const bv = b.lastMessageAt?.getTime() ?? 0;
        return bv - av;
      });
      const offset = options?.offset ?? 0;
      const limit = options?.limit ?? list.length;
      return list.slice(offset, offset + limit);
    },
    countByWorkspace: async (ws, options) => {
      let list = [...store.values()].filter((t) => t.workspaceId === ws);
      if (options?.platform) list = list.filter((t) => t.platform === options.platform);
      if (options?.status) list = list.filter((t) => t.status === options.status);
      return list.length;
    },
    findByExternalThread: async (ws, acc, ext) => {
      const found = [...store.values()].find(
        (t) => t.workspaceId === ws && t.socialAccountId === acc && t.externalThreadId === ext,
      );
      return found ? { ...found } : null;
    },
    create: async (data) => {
      seq += 1;
      const thread: ConversationThread = {
        ...data,
        id: `th-${seq}`,
        participantExternalId: data.participantExternalId ?? null,
        channel: data.channel ?? null,
        initiatedBy: data.initiatedBy ?? null,
        providerMetadata: data.providerMetadata ?? null,
        createdAt: new Date(),
      };
      store.set(thread.id, thread);
      return { ...thread };
    },
    update: async (id, data) => {
      const existing = store.get(id);
      if (!existing) throw new Error(`not found: ${id}`);
      const updated = { ...existing, ...data };
      store.set(id, updated);
      return { ...updated };
    },
  };
}

function mockMessageRepo(): {
  repo: MessageRepository;
  store: Map<string, Message[]>;
} {
  const store = new Map<string, Message[]>();
  let seq = 0;
  const repo: MessageRepository = {
    findByThread: async (threadId, options) => {
      const list = (store.get(threadId) ?? []).slice();
      // 古い順
      list.sort((a, b) => (a.sentAt?.getTime() ?? 0) - (b.sentAt?.getTime() ?? 0));
      const offset = options?.offset ?? 0;
      const limit = options?.limit ?? list.length;
      return list.slice(offset, offset + limit);
    },
    countByThread: async (threadId) => (store.get(threadId) ?? []).length,
    findByExternalMessage: async (threadId, externalMessageId) =>
      (store.get(threadId) ?? []).find((msg) => msg.externalMessageId === externalMessageId) ??
      null,
    create: async (data) => {
      seq += 1;
      const msg: Message = {
        ...data,
        id: `msg-${seq}`,
        authorExternalId: data.authorExternalId ?? null,
        authorDisplayName: data.authorDisplayName ?? null,
        providerMetadata: data.providerMetadata ?? null,
        createdAt: new Date(),
      };
      const arr = store.get(data.threadId) ?? [];
      arr.push(msg);
      store.set(data.threadId, arr);
      return { ...msg };
    },
  };
  return { repo, store };
}

function mockUsageRepo(): UsageRepository & { records: Array<Record<string, unknown>> } {
  const records: Array<Record<string, unknown>> = [];
  return {
    records,
    record: async (usage) => {
      const row = {
        ...usage,
        id: `usage-${records.length + 1}`,
        createdAt: new Date(),
      };
      records.push(row);
      return row;
    },
    aggregate: async () => [],
  };
}

function mockProvider(): SocialProvider {
  return {
    platform: "x",
    getCapabilities: () => ({
      textPost: true,
      imagePost: false,
      videoPost: false,
      threadPost: false,
      directMessage: true,
      commentReply: true,
      broadcast: false,
      nativeSchedule: false,
      usageApi: false,
    }),
    connectAccount: async () => ({}),
    validatePost: async () => ({ valid: true, errors: [], warnings: [] }),
    publishPost: async () => ({
      success: true,
      platformPostId: "x-1",
      publishedAt: new Date(),
    }),
    deletePost: async () => ({ success: true }),
    sendReply: vi.fn(async () => ({
      success: true,
      externalMessageId: "ext-msg-1",
    })),
  };
}

function buildDeps(overrides: Partial<InboxUsecaseDeps> = {}): InboxUsecaseDeps {
  const accountRepo = overrides.accountRepo ?? mockAccountRepo([mockAccount()]);
  const conversationRepo = overrides.conversationRepo ?? mockConversationRepo();
  const messageRepo = overrides.messageRepo ?? mockMessageRepo().repo;
  const provider = mockProvider();
  const providers = overrides.providers ?? new Map([["x", provider]]);
  return {
    accountRepo,
    conversationRepo,
    messageRepo,
    providers,
    encryptionKey: TEST_ENCRYPTION_KEY,
    ...overrides,
  };
}

// ───────────────────────────────────────────
// processInboundMessage
// ───────────────────────────────────────────
describe("processInboundMessage", () => {
  it("creates a new thread and inbound message when none exists", async () => {
    const { repo: msgRepo, store } = mockMessageRepo();
    const deps = buildDeps({ messageRepo: msgRepo });

    const result = await processInboundMessage(deps, {
      workspaceId: "ws-1",
      socialAccountId: "acc-1",
      platform: "x",
      externalThreadId: "user-42",
      participantName: "Alice",
      externalMessageId: "m-1",
      contentText: "hello",
      sentAt: new Date("2026-04-10T10:00:00Z"),
    });

    expect(result.created).toBe(true);
    expect(result.thread.participantName).toBe("Alice");
    expect(result.thread.participantExternalId).toBeNull();
    expect(result.thread.lastMessageAt?.toISOString()).toBe("2026-04-10T10:00:00.000Z");
    expect(result.message.direction).toBe("inbound");
    expect(result.message.contentText).toBe("hello");
    expect(store.get(result.thread.id)?.length).toBe(1);
  });

  it("stores X-specific metadata separately from common inbox fields", async () => {
    const { repo: msgRepo, store } = mockMessageRepo();
    const deps = buildDeps({ messageRepo: msgRepo });

    const result = await processInboundMessage(deps, {
      workspaceId: "ws-1",
      socialAccountId: "acc-1",
      platform: "x",
      externalThreadId: "conv-42",
      participantName: "Alice",
      participantExternalId: "user-42",
      channel: "public",
      initiatedBy: "external",
      externalMessageId: "tweet-1",
      contentText: "@brand hello",
      authorExternalId: "user-42",
      authorDisplayName: "Alice",
      threadProviderMetadata: {
        x: {
          entryType: "mention",
          conversationId: "conv-42",
          rootPostId: "root-1",
          focusPostId: "tweet-1",
          replyToPostId: null,
          authorXUserId: "user-42",
          authorUsername: "alice",
        },
      },
      messageProviderMetadata: {
        x: {
          entryType: "mention",
          conversationId: "conv-42",
          postId: "tweet-1",
          replyToPostId: null,
          authorUsername: "alice",
          mentionedXUserIds: ["brand"],
        },
      },
      sentAt: new Date("2026-04-10T10:00:00Z"),
    });

    expect(result.thread.channel).toBe("public");
    expect(result.thread.initiatedBy).toBe("external");
    expect(result.thread.providerMetadata?.x?.conversationId).toBe("conv-42");
    expect(result.message.authorExternalId).toBe("user-42");
    expect(result.message.providerMetadata?.x?.entryType).toBe("mention");
    expect(store.get(result.thread.id)?.[0]?.providerMetadata?.x?.mentionedXUserIds).toEqual([
      "brand",
    ]);
  });

  it("reuses an existing thread and appends message", async () => {
    const existingThread: ConversationThread = {
      id: "th-existing",
      workspaceId: "ws-1",
      socialAccountId: "acc-1",
      platform: "x",
      externalThreadId: "user-42",
      participantName: "Alice",
      participantExternalId: "user-42",
      channel: "public",
      initiatedBy: "external",
      lastMessageAt: new Date("2026-04-09T10:00:00Z"),
      providerMetadata: null,
      status: "open",
      createdAt: new Date("2026-04-09T10:00:00Z"),
    };
    const convRepo = mockConversationRepo([existingThread]);
    const { repo: msgRepo } = mockMessageRepo();
    const deps = buildDeps({ conversationRepo: convRepo, messageRepo: msgRepo });

    const result = await processInboundMessage(deps, {
      workspaceId: "ws-1",
      socialAccountId: "acc-1",
      platform: "x",
      externalThreadId: "user-42",
      contentText: "next",
      sentAt: new Date("2026-04-10T10:00:00Z"),
    });

    expect(result.created).toBe(false);
    expect(result.thread.id).toBe("th-existing");
    expect(result.thread.lastMessageAt?.toISOString()).toBe("2026-04-10T10:00:00.000Z");
  });

  it("does not duplicate messages with the same externalMessageId", async () => {
    const { repo: msgRepo, store } = mockMessageRepo();
    const deps = buildDeps({ messageRepo: msgRepo });

    await processInboundMessage(deps, {
      workspaceId: "ws-1",
      socialAccountId: "acc-1",
      platform: "x",
      externalThreadId: "conv-dup",
      externalMessageId: "tweet-dup",
      contentText: "first",
      sentAt: new Date("2026-04-10T10:00:00Z"),
    });

    await processInboundMessage(deps, {
      workspaceId: "ws-1",
      socialAccountId: "acc-1",
      platform: "x",
      externalThreadId: "conv-dup",
      externalMessageId: "tweet-dup",
      contentText: "second",
      sentAt: new Date("2026-04-10T10:00:00Z"),
    });

    const threadId = [...store.keys()][0];
    expect(store.get(threadId)?.length).toBe(1);
  });

  it("rejects when externalThreadId is missing", async () => {
    const deps = buildDeps();
    await expect(
      processInboundMessage(deps, {
        workspaceId: "ws-1",
        socialAccountId: "acc-1",
        platform: "x",
        externalThreadId: "",
        contentText: "x",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects when account is not owned by workspace", async () => {
    const deps = buildDeps({
      accountRepo: mockAccountRepo([mockAccount({ id: "acc-1", workspaceId: "ws-other" })]),
    });
    await expect(
      processInboundMessage(deps, {
        workspaceId: "ws-1",
        socialAccountId: "acc-1",
        platform: "x",
        externalThreadId: "user-42",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

// ───────────────────────────────────────────
// listThreads / getThread
// ───────────────────────────────────────────
describe("listThreads", () => {
  it("returns filtered + paginated threads", async () => {
    const threads: ConversationThread[] = [
      {
        id: "th-1",
        workspaceId: "ws-1",
        socialAccountId: "acc-1",
        platform: "x",
        externalThreadId: "u1",
        participantName: "A",
        participantExternalId: "u1",
        channel: "public",
        initiatedBy: "external",
        lastMessageAt: new Date("2026-04-10T10:00:00Z"),
        providerMetadata: null,
        status: "open",
        createdAt: new Date(),
      },
      {
        id: "th-2",
        workspaceId: "ws-1",
        socialAccountId: "acc-1",
        platform: "line",
        externalThreadId: "u2",
        participantName: "B",
        participantExternalId: "u2",
        channel: "direct",
        initiatedBy: "external",
        lastMessageAt: new Date("2026-04-11T10:00:00Z"),
        providerMetadata: null,
        status: "open",
        createdAt: new Date(),
      },
    ];
    const deps = buildDeps({ conversationRepo: mockConversationRepo(threads) });

    const all = await listThreads(deps, "ws-1");
    expect(all.data.length).toBe(2);
    expect(all.data[0].id).toBe("th-2"); // 新しい方が先
    expect(all.meta.total).toBe(2);

    const xOnly = await listThreads(deps, "ws-1", { platform: "x" });
    expect(xOnly.data.length).toBe(1);
    expect(xOnly.data[0].id).toBe("th-1");
  });
});

describe("getThread", () => {
  it("returns thread + messages, rejects cross-workspace", async () => {
    const thread: ConversationThread = {
      id: "th-1",
      workspaceId: "ws-1",
      socialAccountId: "acc-1",
      platform: "x",
      externalThreadId: "u1",
      participantName: "A",
      participantExternalId: "u1",
      channel: "public",
      initiatedBy: "external",
      lastMessageAt: new Date(),
      providerMetadata: null,
      status: "open",
      createdAt: new Date(),
    };
    const { repo: msgRepo, store } = mockMessageRepo();
    store.set("th-1", [
      {
        id: "m-1",
        threadId: "th-1",
        direction: "inbound",
        contentText: "hi",
        contentMedia: null,
        externalMessageId: null,
        authorExternalId: "u1",
        authorDisplayName: "A",
        sentAt: new Date("2026-04-10T10:00:00Z"),
        providerMetadata: null,
        createdAt: new Date(),
      },
    ]);
    const deps = buildDeps({
      conversationRepo: mockConversationRepo([thread]),
      messageRepo: msgRepo,
    });

    const result = await getThread(deps, "ws-1", "th-1");
    expect(result.thread.id).toBe("th-1");
    expect(result.messages.length).toBe(1);

    await expect(getThread(deps, "ws-other", "th-1")).rejects.toBeInstanceOf(NotFoundError);
  });
});

// ───────────────────────────────────────────
// sendReply
// ───────────────────────────────────────────
describe("sendReply", () => {
  it("calls Provider.sendReply and records outbound message", async () => {
    const usageRepo = mockUsageRepo();
    const thread: ConversationThread = {
      id: "th-1",
      workspaceId: "ws-1",
      socialAccountId: "acc-1",
      platform: "x",
      externalThreadId: "user-42",
      participantName: "Alice",
      participantExternalId: "user-42",
      channel: "public",
      initiatedBy: "external",
      lastMessageAt: new Date(),
      providerMetadata: {
        x: {
          entryType: "reply",
          conversationId: "conv-1",
          rootPostId: "conv-1",
          focusPostId: "tweet-99",
          replyToPostId: "tweet-42",
          authorXUserId: "user-42",
          authorUsername: "alice",
        },
      },
      status: "open",
      createdAt: new Date(),
    };
    const provider = mockProvider();
    const deps = buildDeps({
      conversationRepo: mockConversationRepo([thread]),
      usageRepo,
      providers: new Map([["x", provider]]),
    });

    const result = await sendReply(deps, {
      workspaceId: "ws-1",
      threadId: "th-1",
      contentText: "reply!",
      actorId: "user-1",
    });

    expect(provider.sendReply).toHaveBeenCalledTimes(1);
    const call = (provider.sendReply as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.externalThreadId).toBe("user-42");
    expect(call.contentText).toBe("reply!");
    expect(call.replyToMessageId).toBe("tweet-99");
    expect(result.message.direction).toBe("outbound");
    expect(result.message.authorExternalId).toBe("ext-1");
    expect(result.message.authorDisplayName).toBe("Test");
    expect(result.externalMessageId).toBe("ext-msg-1");
    expect(usageRepo.records).toEqual(
      expect.arrayContaining([expect.objectContaining({ endpoint: "inbox.reply", success: true })]),
    );
  });

  it("allows media-only replies and stores text as null", async () => {
    const usageRepo = mockUsageRepo();
    const thread: ConversationThread = {
      id: "th-1",
      workspaceId: "ws-1",
      socialAccountId: "acc-1",
      platform: "x",
      externalThreadId: "dm:42",
      participantName: "Alice",
      participantExternalId: "user-42",
      channel: "direct",
      initiatedBy: "external",
      lastMessageAt: new Date(),
      providerMetadata: {
        x: {
          entryType: "dm",
          conversationId: "123-42",
          rootPostId: null,
          focusPostId: "dm-99",
          replyToPostId: null,
          authorXUserId: "user-42",
          authorUsername: "alice",
        },
      },
      status: "open",
      createdAt: new Date(),
    };
    const provider = mockProvider();
    const deps = buildDeps({
      conversationRepo: mockConversationRepo([thread]),
      usageRepo,
      providers: new Map([["x", provider]]),
    });

    const result = await sendReply(deps, {
      workspaceId: "ws-1",
      threadId: "th-1",
      contentText: "   ",
      contentMedia: [
        {
          type: "image",
          url: "data:image/png;base64,ZmFrZQ==",
          mimeType: "image/png",
        },
      ],
      actorId: "user-1",
    });

    expect(provider.sendReply).toHaveBeenCalledTimes(1);
    const call = (provider.sendReply as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.contentText).toBe("");
    expect(call.contentMedia).toEqual([
      {
        type: "image",
        url: "data:image/png;base64,ZmFrZQ==",
        mimeType: "image/png",
      },
    ]);
    expect(result.message.contentText).toBeNull();
    expect(result.message.contentMedia).toHaveLength(1);
    expect(usageRepo.records).toEqual(
      expect.arrayContaining([expect.objectContaining({ endpoint: "inbox.reply", success: true })]),
    );
  });

  it("rejects when both contentText and contentMedia are empty", async () => {
    const deps = buildDeps({
      conversationRepo: mockConversationRepo([
        {
          id: "th-1",
          workspaceId: "ws-1",
          socialAccountId: "acc-1",
          platform: "x",
          externalThreadId: "u",
          participantName: null,
          participantExternalId: null,
          channel: null,
          initiatedBy: null,
          lastMessageAt: null,
          providerMetadata: null,
          status: "open",
          createdAt: new Date(),
        },
      ]),
    });
    await expect(
      sendReply(deps, {
        workspaceId: "ws-1",
        threadId: "th-1",
        contentText: "   ",
        actorId: "u1",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws when provider lacks sendReply support", async () => {
    const thread: ConversationThread = {
      id: "th-1",
      workspaceId: "ws-1",
      socialAccountId: "acc-1",
      platform: "x",
      externalThreadId: "user-42",
      participantName: null,
      participantExternalId: null,
      channel: null,
      initiatedBy: null,
      lastMessageAt: null,
      providerMetadata: null,
      status: "open",
      createdAt: new Date(),
    };
    const provider: SocialProvider = {
      ...mockProvider(),
      sendReply: undefined,
    };
    const deps = buildDeps({
      conversationRepo: mockConversationRepo([thread]),
      providers: new Map([["x", provider]]),
    });
    await expect(
      sendReply(deps, {
        workspaceId: "ws-1",
        threadId: "th-1",
        contentText: "hi",
        actorId: "u1",
      }),
    ).rejects.toBeInstanceOf(ProviderError);
  });
});

describe("syncInboxFromProvider", () => {
  it("imports provider threads/messages and records usage", async () => {
    const usageRepo = mockUsageRepo();
    const provider: SocialProvider = {
      ...mockProvider(),
      listThreads: vi.fn(async () => ({
        threads: [
          {
            externalThreadId: "conv-1",
            participantName: "Alice",
            participantExternalId: "user-42",
            channel: "public",
            initiatedBy: "external",
            lastMessageAt: new Date("2026-04-10T10:05:00Z"),
            providerMetadata: {
              x: {
                entryType: "reply",
                conversationId: "conv-1",
                rootPostId: "conv-1",
                focusPostId: "tweet-2",
                replyToPostId: "tweet-root",
                authorXUserId: "user-42",
                authorUsername: "alice",
              },
            },
          },
        ],
        nextCursor: '{"sinceId":"tweet-2"}',
      })),
      getMessages: vi.fn(async () => ({
        messages: [
          {
            externalMessageId: "tweet-1",
            direction: "inbound",
            contentText: "@brand hello",
            contentMedia: null,
            authorExternalId: "user-42",
            authorDisplayName: "Alice",
            sentAt: new Date("2026-04-10T10:00:00Z"),
            providerMetadata: null,
          },
          {
            externalMessageId: "tweet-2",
            direction: "outbound",
            contentText: "thanks",
            contentMedia: null,
            authorExternalId: "ext-1",
            authorDisplayName: "Test",
            sentAt: new Date("2026-04-10T10:05:00Z"),
            providerMetadata: null,
          },
        ],
        nextCursor: null,
      })),
    };
    const { repo: msgRepo } = mockMessageRepo();
    const deps = buildDeps({
      messageRepo: msgRepo,
      usageRepo,
      providers: new Map([["x", provider]]),
    });

    const result = await syncInboxFromProvider(deps, {
      workspaceId: "ws-1",
      socialAccountId: "acc-1",
      actorId: "user-1",
      limit: 10,
    });

    expect(result.syncedThreadCount).toBe(1);
    expect(result.syncedMessageCount).toBe(2);
    expect(result.nextCursor).toContain("sinceId");
    expect(provider.listThreads).toHaveBeenCalledTimes(1);
    expect(provider.getMessages).toHaveBeenCalledTimes(1);
    expect(usageRepo.records).toHaveLength(2);
  });
});
