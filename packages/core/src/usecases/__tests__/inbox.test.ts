/**
 * 受信・会話管理ユースケースのテスト (Task 6003)
 *
 * listThreads / getThread / processInboundMessage / sendReply
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
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
} from "../../interfaces/repositories.js";
import type { SocialProvider } from "../../interfaces/social-provider.js";
import { encrypt } from "../../domain/crypto.js";
import {
  listThreads,
  getThread,
  processInboundMessage,
  sendReply,
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
    create: async (data) => {
      seq += 1;
      const msg: Message = {
        ...data,
        id: `msg-${seq}`,
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
    expect(result.thread.lastMessageAt?.toISOString()).toBe("2026-04-10T10:00:00.000Z");
    expect(result.message.direction).toBe("inbound");
    expect(result.message.contentText).toBe("hello");
    expect(store.get(result.thread.id)?.length).toBe(1);
  });

  it("reuses an existing thread and appends message", async () => {
    const existingThread: ConversationThread = {
      id: "th-existing",
      workspaceId: "ws-1",
      socialAccountId: "acc-1",
      platform: "x",
      externalThreadId: "user-42",
      participantName: "Alice",
      lastMessageAt: new Date("2026-04-09T10:00:00Z"),
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
        lastMessageAt: new Date("2026-04-10T10:00:00Z"),
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
        lastMessageAt: new Date("2026-04-11T10:00:00Z"),
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
      lastMessageAt: new Date(),
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
        sentAt: new Date("2026-04-10T10:00:00Z"),
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
    const thread: ConversationThread = {
      id: "th-1",
      workspaceId: "ws-1",
      socialAccountId: "acc-1",
      platform: "x",
      externalThreadId: "user-42",
      participantName: "Alice",
      lastMessageAt: new Date(),
      status: "open",
      createdAt: new Date(),
    };
    const provider = mockProvider();
    const deps = buildDeps({
      conversationRepo: mockConversationRepo([thread]),
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
    expect(result.message.direction).toBe("outbound");
    expect(result.externalMessageId).toBe("ext-msg-1");
  });

  it("rejects empty contentText", async () => {
    const deps = buildDeps({
      conversationRepo: mockConversationRepo([
        {
          id: "th-1",
          workspaceId: "ws-1",
          socialAccountId: "acc-1",
          platform: "x",
          externalThreadId: "u",
          participantName: null,
          lastMessageAt: null,
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
      lastMessageAt: null,
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
