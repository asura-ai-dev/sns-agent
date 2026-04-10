/**
 * 投稿管理ユースケースのテスト (Task 2004)
 *
 * createPost / updatePost / publishPost / deletePost / listPosts / getPost
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Platform } from "@sns-agent/config";
import type { Post, SocialAccount, MediaAttachment } from "../../domain/entities.js";
import type { AccountRepository, PostRepository } from "../../interfaces/repositories.js";
import type { SocialProvider, ValidationResult } from "../../interfaces/social-provider.js";
import { encrypt } from "../../domain/crypto.js";
import { createPost, updatePost, publishPost, deletePost, listPosts, getPost } from "../post.js";
import type { PostUsecaseDeps } from "../post.js";
import { ValidationError, NotFoundError, ProviderError } from "../../errors/domain-error.js";

const TEST_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const PLAINTEXT_CREDS = '{"access_token":"tok"}';

// ───────────────────────────────────────────
// モック
// ───────────────────────────────────────────

function createMockAccount(overrides: Partial<SocialAccount> = {}): SocialAccount {
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

function createMockAccountRepo(accounts: SocialAccount[]): AccountRepository {
  const store = new Map(accounts.map((a) => [a.id, { ...a }]));
  return {
    findById: async (id) => {
      const a = store.get(id);
      return a ? { ...a } : null;
    },
    findByWorkspace: async (wsId) => [...store.values()].filter((a) => a.workspaceId === wsId),
    create: async (data) => {
      const account: SocialAccount = {
        ...data,
        id: `acc-${store.size + 1}`,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      store.set(account.id, account);
      return account;
    },
    update: async (id, data) => {
      const existing = store.get(id);
      if (!existing) throw new Error(`Not found: ${id}`);
      const updated = { ...existing, ...data, updatedAt: new Date() };
      store.set(id, updated);
      return updated;
    },
    delete: async (id) => {
      store.delete(id);
    },
  };
}

function createMockPostRepo(initial: Post[] = []): PostRepository {
  const store = new Map(initial.map((p) => [p.id, { ...p }]));
  let seq = initial.length;
  return {
    findById: async (id) => {
      const p = store.get(id);
      return p ? { ...p } : null;
    },
    findByWorkspace: async (wsId, options) => {
      let filtered = [...store.values()].filter((p) => p.workspaceId === wsId);
      if (options?.platform) {
        filtered = filtered.filter((p) => p.platform === options.platform);
      }
      if (options?.status) {
        filtered = filtered.filter((p) => p.status === options.status);
      }
      return filtered;
    },
    create: async (post) => {
      seq += 1;
      const now = new Date();
      const created: Post = {
        ...post,
        id: `post-${seq}`,
        createdAt: now,
        updatedAt: now,
      };
      store.set(created.id, created);
      return { ...created };
    },
    update: async (id, data) => {
      const existing = store.get(id);
      if (!existing) throw new Error(`Not found: ${id}`);
      const updated = { ...existing, ...data, updatedAt: new Date() };
      store.set(id, updated);
      return { ...updated };
    },
    delete: async (id) => {
      store.delete(id);
    },
    findByIdempotencyKey: async (key) => {
      for (const p of store.values()) {
        if (p.idempotencyKey === key) return { ...p };
      }
      return null;
    },
  };
}

interface MockProviderOptions {
  validateResult?: ValidationResult;
  publishResult?: {
    success: boolean;
    platformPostId?: string | null;
    publishedAt?: Date | null;
    error?: string;
  };
  deleteResult?: { success: boolean; error?: string };
  publishThrows?: Error;
}

function createMockProvider(options: MockProviderOptions = {}): SocialProvider {
  return {
    platform: "x" as Platform,
    getCapabilities: () => ({
      textPost: true,
      imagePost: true,
      videoPost: false,
      threadPost: false,
      directMessage: false,
      commentReply: false,
      broadcast: false,
      nativeSchedule: false,
      usageApi: false,
    }),
    connectAccount: async () => ({}),
    validatePost: async () => options.validateResult ?? { valid: true, errors: [], warnings: [] },
    publishPost: async () => {
      if (options.publishThrows) throw options.publishThrows;
      return {
        success: options.publishResult?.success ?? true,
        platformPostId: options.publishResult?.platformPostId ?? "ext-post-1",
        publishedAt: options.publishResult?.publishedAt ?? new Date("2026-04-10T10:00:00Z"),
        error: options.publishResult?.error,
      };
    },
    deletePost: async () => options.deleteResult ?? { success: true },
  };
}

function createDeps(
  accounts: SocialAccount[] = [createMockAccount()],
  posts: Post[] = [],
  providerOptions: MockProviderOptions = {},
): PostUsecaseDeps {
  const providers = new Map<Platform, SocialProvider>();
  providers.set("x", createMockProvider(providerOptions));
  return {
    postRepo: createMockPostRepo(posts),
    accountRepo: createMockAccountRepo(accounts),
    providers,
    encryptionKey: TEST_ENCRYPTION_KEY,
  };
}

function makePost(overrides: Partial<Post> = {}): Post {
  const now = new Date("2026-04-10T00:00:00Z");
  return {
    id: "post-1",
    workspaceId: "ws-1",
    socialAccountId: "acc-1",
    platform: "x",
    status: "draft",
    contentText: "hello",
    contentMedia: null,
    platformPostId: null,
    validationResult: { valid: true, errors: [], warnings: [] },
    idempotencyKey: null,
    createdBy: "user-1",
    createdAt: now,
    updatedAt: now,
    publishedAt: null,
    ...overrides,
  };
}

// ───────────────────────────────────────────
// createPost
// ───────────────────────────────────────────

describe("createPost", () => {
  it("下書きとして作成し、validationResult を含める", async () => {
    const deps = createDeps();
    const post = await createPost(deps, {
      workspaceId: "ws-1",
      socialAccountId: "acc-1",
      contentText: "hello world",
      createdBy: "user-1",
    });
    expect(post.status).toBe("draft");
    expect(post.contentText).toBe("hello world");
    expect(post.platform).toBe("x");
    expect(post.validationResult).toEqual({ valid: true, errors: [], warnings: [] });
  });

  it("publishNow: true で即時公開される", async () => {
    const deps = createDeps();
    const post = await createPost(deps, {
      workspaceId: "ws-1",
      socialAccountId: "acc-1",
      contentText: "publish me",
      publishNow: true,
    });
    expect(post.status).toBe("published");
    expect(post.platformPostId).toBe("ext-post-1");
    expect(post.publishedAt).toBeInstanceOf(Date);
  });

  it("バリデーション失敗時は ValidationError で保存しない", async () => {
    const deps = createDeps([createMockAccount()], [], {
      validateResult: {
        valid: false,
        errors: [{ field: "contentText", message: "too long" }],
        warnings: [],
      },
    });

    await expect(
      createPost(deps, {
        workspaceId: "ws-1",
        socialAccountId: "acc-1",
        contentText: "x".repeat(10000),
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    const all = await deps.postRepo.findByWorkspace("ws-1");
    expect(all).toHaveLength(0);
  });

  it("idempotency_key が既存ならば既存 Post を返す", async () => {
    const existing = makePost({
      id: "post-existing",
      idempotencyKey: "key-123",
      contentText: "already created",
    });
    const deps = createDeps([createMockAccount()], [existing]);

    const result = await createPost(deps, {
      workspaceId: "ws-1",
      socialAccountId: "acc-1",
      contentText: "different content",
      idempotencyKey: "key-123",
    });

    expect(result.id).toBe("post-existing");
    expect(result.contentText).toBe("already created");
  });

  it("別ワークスペースの idempotency_key 衝突は ValidationError", async () => {
    const existing = makePost({
      id: "post-other-ws",
      workspaceId: "ws-other",
      idempotencyKey: "key-xyz",
    });
    const deps = createDeps([createMockAccount()], [existing]);

    await expect(
      createPost(deps, {
        workspaceId: "ws-1",
        socialAccountId: "acc-1",
        contentText: "x",
        idempotencyKey: "key-xyz",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("存在しないアカウントは NotFoundError", async () => {
    const deps = createDeps();
    await expect(
      createPost(deps, {
        workspaceId: "ws-1",
        socialAccountId: "acc-missing",
        contentText: "hi",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("別ワークスペースのアカウントには作成不可", async () => {
    const deps = createDeps([createMockAccount({ workspaceId: "ws-other" })]);
    await expect(
      createPost(deps, {
        workspaceId: "ws-1",
        socialAccountId: "acc-1",
        contentText: "hi",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("非アクティブアカウントには作成不可", async () => {
    const deps = createDeps([createMockAccount({ status: "expired" })]);
    await expect(
      createPost(deps, {
        workspaceId: "ws-1",
        socialAccountId: "acc-1",
        contentText: "hi",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

// ───────────────────────────────────────────
// updatePost
// ───────────────────────────────────────────

describe("updatePost", () => {
  it("下書きを更新できる", async () => {
    const deps = createDeps([createMockAccount()], [makePost()]);
    const updated = await updatePost(deps, "ws-1", "post-1", {
      contentText: "updated",
    });
    expect(updated.contentText).toBe("updated");
    expect(updated.status).toBe("draft");
  });

  it("published の投稿は更新不可", async () => {
    const deps = createDeps([createMockAccount()], [makePost({ status: "published" })]);
    await expect(updatePost(deps, "ws-1", "post-1", { contentText: "x" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("バリデーション失敗時は更新しない", async () => {
    const deps = createDeps([createMockAccount()], [makePost({ contentText: "original" })], {
      validateResult: {
        valid: false,
        errors: [{ field: "contentText", message: "too long" }],
        warnings: [],
      },
    });
    await expect(
      updatePost(deps, "ws-1", "post-1", { contentText: "new content" }),
    ).rejects.toBeInstanceOf(ValidationError);

    const post = await deps.postRepo.findById("post-1");
    expect(post?.contentText).toBe("original");
  });

  it("別ワークスペースの投稿は更新不可", async () => {
    const deps = createDeps([createMockAccount()], [makePost({ workspaceId: "ws-other" })]);
    await expect(updatePost(deps, "ws-1", "post-1", { contentText: "x" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

// ───────────────────────────────────────────
// publishPost
// ───────────────────────────────────────────

describe("publishPost", () => {
  it("成功すると status=published, platformPostId, publishedAt をセット", async () => {
    const deps = createDeps([createMockAccount()], [makePost()]);
    const published = await publishPost(deps, "ws-1", "post-1");
    expect(published.status).toBe("published");
    expect(published.platformPostId).toBe("ext-post-1");
    expect(published.publishedAt).toBeInstanceOf(Date);
  });

  it("provider が success=false を返すと status=failed に更新して ProviderError", async () => {
    const deps = createDeps([createMockAccount()], [makePost()], {
      publishResult: { success: false, error: "rate limited" },
    });
    await expect(publishPost(deps, "ws-1", "post-1")).rejects.toBeInstanceOf(ProviderError);
    const after = await deps.postRepo.findById("post-1");
    expect(after?.status).toBe("failed");
  });

  it("provider が throw しても status=failed に更新して ProviderError", async () => {
    const deps = createDeps([createMockAccount()], [makePost()], {
      publishThrows: new Error("network error"),
    });
    await expect(publishPost(deps, "ws-1", "post-1")).rejects.toBeInstanceOf(ProviderError);
    const after = await deps.postRepo.findById("post-1");
    expect(after?.status).toBe("failed");
  });

  it("draft 以外は公開不可", async () => {
    const deps = createDeps([createMockAccount()], [makePost({ status: "published" })]);
    await expect(publishPost(deps, "ws-1", "post-1")).rejects.toBeInstanceOf(ValidationError);
  });
});

// ───────────────────────────────────────────
// deletePost
// ───────────────────────────────────────────

describe("deletePost", () => {
  it("draft は status=deleted になる", async () => {
    const deps = createDeps([createMockAccount()], [makePost()]);
    const deleted = await deletePost(deps, "ws-1", "post-1");
    expect(deleted.status).toBe("deleted");
  });

  it("published は Provider.deletePost を呼び status=deleted", async () => {
    const deleteSpy = vi.fn(async () => ({ success: true }));
    const deps = createDeps(
      [createMockAccount()],
      [makePost({ status: "published", platformPostId: "plat-1" })],
    );
    (deps.providers.get("x") as SocialProvider).deletePost = deleteSpy;

    const deleted = await deletePost(deps, "ws-1", "post-1");
    expect(deleted.status).toBe("deleted");
    expect(deleteSpy).toHaveBeenCalledTimes(1);
  });

  it("Provider.deletePost が失敗すると ProviderError", async () => {
    const deps = createDeps(
      [createMockAccount()],
      [makePost({ status: "published", platformPostId: "plat-1" })],
      { deleteResult: { success: false, error: "not found upstream" } },
    );
    await expect(deletePost(deps, "ws-1", "post-1")).rejects.toBeInstanceOf(ProviderError);
  });

  it("既に deleted の投稿は冪等に deleted を返す", async () => {
    const deps = createDeps([createMockAccount()], [makePost({ status: "deleted" })]);
    const result = await deletePost(deps, "ws-1", "post-1");
    expect(result.status).toBe("deleted");
  });
});

// ───────────────────────────────────────────
// listPosts
// ───────────────────────────────────────────

describe("listPosts", () => {
  it("ワークスペース内の投稿を一覧で返す", async () => {
    const deps = createDeps(
      [createMockAccount()],
      [
        makePost({ id: "p-1" }),
        makePost({ id: "p-2" }),
        makePost({ id: "p-other", workspaceId: "ws-other" }),
      ],
    );
    const result = await listPosts(deps, "ws-1");
    expect(result.data).toHaveLength(2);
    expect(result.meta.total).toBe(2);
  });

  it("status フィルタが効く", async () => {
    const deps = createDeps(
      [createMockAccount()],
      [makePost({ id: "p-1", status: "draft" }), makePost({ id: "p-2", status: "published" })],
    );
    const result = await listPosts(deps, "ws-1", { status: "published" });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe("p-2");
  });

  it("日付範囲フィルタ (from/to) が効く", async () => {
    const deps = createDeps(
      [createMockAccount()],
      [
        makePost({ id: "p-old", createdAt: new Date("2026-01-01") }),
        makePost({ id: "p-mid", createdAt: new Date("2026-03-01") }),
        makePost({ id: "p-new", createdAt: new Date("2026-05-01") }),
      ],
    );
    const result = await listPosts(deps, "ws-1", {
      from: new Date("2026-02-01"),
      to: new Date("2026-04-01"),
    });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe("p-mid");
  });

  it("ページングが動作する", async () => {
    const posts = Array.from({ length: 5 }, (_, i) => makePost({ id: `p-${i}` }));
    const deps = createDeps([createMockAccount()], posts);
    const result = await listPosts(deps, "ws-1", { page: 2, limit: 2 });
    expect(result.data).toHaveLength(2);
    expect(result.meta.total).toBe(5);
    expect(result.meta.page).toBe(2);
    expect(result.meta.limit).toBe(2);
  });
});

// ───────────────────────────────────────────
// getPost
// ───────────────────────────────────────────

describe("getPost", () => {
  it("投稿詳細を返す", async () => {
    const deps = createDeps([createMockAccount()], [makePost()]);
    const post = await getPost(deps, "ws-1", "post-1");
    expect(post.id).toBe("post-1");
  });

  it("別ワークスペースの投稿は NotFoundError", async () => {
    const deps = createDeps([createMockAccount()], [makePost({ workspaceId: "ws-other" })]);
    await expect(getPost(deps, "ws-1", "post-1")).rejects.toBeInstanceOf(NotFoundError);
  });
});
