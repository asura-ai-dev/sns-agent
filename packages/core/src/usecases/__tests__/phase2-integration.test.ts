/**
 * Phase 2 総合動作確認用統合テスト (Task 2006)
 *
 * 対象シナリオ:
 * 1. アカウント作成 → 投稿作成 (下書き) → バリデーション → 即時公開
 * 2. アカウント作成 → 投稿作成 → 予約 (ScheduledJob 生成)
 * 3. 文字数超過投稿がValidationError
 * 4. 一覧フィルタ動作 (platform/status/from/to/search/orderBy/pagination)
 *
 * Phase 2 受け入れ条件:
 * - AC-3: 各SNSに対してテキスト投稿を作成・下書き保存・即時投稿できる
 * - AC-4: CLI 相当の usecase から投稿を作成できる
 * - AC-5: SNSごとの文字数制限を事前検証しエラーを返す
 * - AC-6: 予約できる (予約ジョブの状態確認は Task 2005)
 *
 * 実装メモ:
 * Repository は in-memory mock。Provider は X (280 char limit) 相当の mock。
 * これにより packages/core のユースケース結線が spec どおり動作するかを検証する。
 */
import { describe, it, expect } from "vitest";
import type { Platform } from "@sns-agent/config";
import type { MediaAttachment, Post, ScheduledJob, SocialAccount } from "../../domain/entities.js";
import type {
  AccountRepository,
  PostRepository,
  ScheduledJobRepository,
} from "../../interfaces/repositories.js";
import type { SocialProvider, ValidationResult } from "../../interfaces/social-provider.js";
import { encrypt } from "../../domain/crypto.js";
import { createPost, listPosts, publishPost } from "../post.js";
import type { PostUsecaseDeps } from "../post.js";
import { schedulePost } from "../schedule.js";
import type { ScheduleUsecaseDeps } from "../schedule.js";
import { ValidationError } from "../../errors/domain-error.js";

const ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const X_TEXT_LIMIT = 280;

// ───────────────────────────────────────────
// In-memory AccountRepository
// ───────────────────────────────────────────
function makeAccountRepo(): AccountRepository {
  const store = new Map<string, SocialAccount>();
  let seq = 0;
  return {
    findById: async (id) => {
      const a = store.get(id);
      return a ? { ...a } : null;
    },
    findByWorkspace: async (wsId) =>
      [...store.values()].filter((a) => a.workspaceId === wsId).map((a) => ({ ...a })),
    create: async (data) => {
      seq += 1;
      const now = new Date();
      const account: SocialAccount = {
        ...data,
        id: `acc-${seq}`,
        createdAt: now,
        updatedAt: now,
      };
      store.set(account.id, account);
      return { ...account };
    },
    update: async (id, data) => {
      const e = store.get(id);
      if (!e) throw new Error(`Not found: ${id}`);
      const u = { ...e, ...data, updatedAt: new Date() };
      store.set(id, u);
      return { ...u };
    },
    delete: async (id) => {
      store.delete(id);
    },
  };
}

// ───────────────────────────────────────────
// In-memory PostRepository (本物の filters を実装)
// ───────────────────────────────────────────
function makePostRepo(): PostRepository {
  const store = new Map<string, Post>();
  let seq = 0;

  const applyFilters = (
    wsId: string,
    opts: Parameters<PostRepository["findByWorkspace"]>[1],
  ): Post[] => {
    let arr = [...store.values()].filter((p) => p.workspaceId === wsId);
    const platformList =
      opts?.platforms && opts.platforms.length > 0
        ? opts.platforms
        : opts?.platform
          ? [opts.platform]
          : undefined;
    if (platformList) arr = arr.filter((p) => platformList.includes(p.platform));
    const statusList =
      opts?.statuses && opts.statuses.length > 0
        ? opts.statuses
        : opts?.status
          ? [opts.status]
          : undefined;
    if (statusList) arr = arr.filter((p) => statusList.includes(p.status));
    if (opts?.from) {
      const from = opts.from;
      arr = arr.filter((p) => p.createdAt >= from);
    }
    if (opts?.to) {
      const to = opts.to;
      arr = arr.filter((p) => p.createdAt <= to);
    }
    if (opts?.search) {
      const q = opts.search.toLowerCase();
      arr = arr.filter((p) => (p.contentText ?? "").toLowerCase().includes(q));
    }
    const orderBy = opts?.orderBy ?? "createdAt";
    arr.sort((a, b) => {
      if (orderBy === "publishedAt") {
        const av = a.publishedAt?.getTime() ?? 0;
        const bv = b.publishedAt?.getTime() ?? 0;
        return bv - av;
      }
      return b.createdAt.getTime() - a.createdAt.getTime();
    });
    return arr;
  };

  return {
    findById: async (id) => {
      const p = store.get(id);
      return p ? { ...p } : null;
    },
    findByWorkspace: async (wsId, opts) => {
      const filtered = applyFilters(wsId, opts);
      const offset = opts?.offset ?? 0;
      const end = opts?.limit ? offset + opts.limit : undefined;
      return filtered.slice(offset, end).map((p) => ({ ...p }));
    },
    countByWorkspace: async (wsId, opts) => applyFilters(wsId, opts).length,
    create: async (p) => {
      seq += 1;
      const now = new Date();
      // createdAt を少しずつずらして order が安定するようにする
      const created: Post = {
        ...p,
        id: `post-${seq}`,
        createdAt: new Date(now.getTime() + seq),
        updatedAt: new Date(now.getTime() + seq),
      };
      store.set(created.id, created);
      return { ...created };
    },
    update: async (id, data) => {
      const e = store.get(id);
      if (!e) throw new Error(`Not found: ${id}`);
      const u = { ...e, ...data, updatedAt: new Date() };
      store.set(id, u);
      return { ...u };
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

// ───────────────────────────────────────────
// In-memory ScheduledJobRepository
// ───────────────────────────────────────────
function makeJobRepo(): ScheduledJobRepository {
  const store = new Map<string, ScheduledJob>();
  let seq = 0;
  return {
    findById: async (id) => {
      const j = store.get(id);
      return j ? { ...j } : null;
    },
    findPendingJobs: async (limit) => {
      const now = new Date();
      return [...store.values()]
        .filter((j) => j.status === "pending" && j.scheduledAt <= now)
        .slice(0, limit)
        .map((j) => ({ ...j }));
    },
    create: async (data) => {
      seq += 1;
      const created: ScheduledJob = {
        ...data,
        id: `job-${seq}`,
        createdAt: new Date(),
      };
      store.set(created.id, created);
      return { ...created };
    },
    update: async (id, data) => {
      const e = store.get(id);
      if (!e) throw new Error(`Not found: ${id}`);
      const u = { ...e, ...data };
      store.set(id, u);
      return { ...u };
    },
    lockJob: async (id) => {
      const j = store.get(id);
      if (!j) return null;
      if (j.status !== "pending" && j.status !== "retrying") return null;
      const locked = { ...j, status: "locked" as const, lockedAt: new Date() };
      store.set(id, locked);
      return { ...locked };
    },
    findByPostIds: async (postIds) => {
      if (postIds.length === 0) return [];
      const set = new Set(postIds);
      return [...store.values()]
        .filter((j) => set.has(j.postId))
        .sort((a, b) => b.scheduledAt.getTime() - a.scheduledAt.getTime())
        .map((j) => ({ ...j }));
    },
  };
}

// ───────────────────────────────────────────
// X 相当のモック SocialProvider
// ───────────────────────────────────────────
function makeXLikeProvider(platform: Platform = "x"): SocialProvider {
  let publishCount = 0;
  return {
    platform,
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
    validatePost: async (input): Promise<ValidationResult> => {
      const errors = [];
      const text = input.contentText ?? "";
      if (text.length === 0 && !(input.contentMedia && input.contentMedia.length > 0)) {
        errors.push({ field: "contentText", message: "Empty post" });
      }
      // 投稿プラットフォームごとの文字数制限。簡略化のため全プラットフォームで X 相当
      if (text.length > X_TEXT_LIMIT) {
        errors.push({
          field: "contentText",
          message: `Text exceeds ${X_TEXT_LIMIT} characters`,
        });
      }
      return {
        valid: errors.length === 0,
        errors,
        warnings: [],
      };
    },
    publishPost: async () => {
      publishCount += 1;
      return {
        success: true,
        platformPostId: `ext-${platform}-${publishCount}`,
        publishedAt: new Date(),
      };
    },
    deletePost: async () => ({ success: true }),
  };
}

// ───────────────────────────────────────────
// セットアップヘルパー
// ───────────────────────────────────────────
interface TestEnv {
  accountRepo: AccountRepository;
  postRepo: PostRepository;
  jobRepo: ScheduledJobRepository;
  postDeps: PostUsecaseDeps;
  scheduleDeps: ScheduleUsecaseDeps;
}

function makeEnv(): TestEnv {
  const accountRepo = makeAccountRepo();
  const postRepo = makePostRepo();
  const jobRepo = makeJobRepo();

  const providers = new Map<Platform, SocialProvider>();
  providers.set("x", makeXLikeProvider("x"));
  providers.set("line", makeXLikeProvider("line"));
  providers.set("instagram", makeXLikeProvider("instagram"));

  const postDeps: PostUsecaseDeps = {
    postRepo,
    accountRepo,
    providers,
    encryptionKey: ENCRYPTION_KEY,
    scheduledJobRepo: jobRepo,
  };

  const scheduleDeps: ScheduleUsecaseDeps = {
    scheduledJobRepo: jobRepo,
    postRepo,
    postUsecaseDeps: postDeps,
  };

  return { accountRepo, postRepo, jobRepo, postDeps, scheduleDeps };
}

async function createActiveAccount(
  accountRepo: AccountRepository,
  workspaceId: string,
  platform: Platform,
  displayName: string,
): Promise<SocialAccount> {
  return accountRepo.create({
    workspaceId,
    platform,
    displayName,
    externalAccountId: `ext-${platform}-${displayName}`,
    credentialsEncrypted: encrypt('{"access_token":"tok"}', ENCRYPTION_KEY),
    tokenExpiresAt: new Date("2099-01-01"),
    status: "active",
    capabilities: null,
  });
}

// ───────────────────────────────────────────
// シナリオ 1: 下書き → 即時公開
// ───────────────────────────────────────────
describe("Phase 2 integration: 下書き作成 → 即時公開", () => {
  it("アカウント作成 → 下書き投稿 → バリデーション通過 → publishPost で public に遷移", async () => {
    const env = makeEnv();
    const account = await createActiveAccount(env.accountRepo, "ws-1", "x", "main-x");

    // 1. 下書き作成
    const draft = await createPost(env.postDeps, {
      workspaceId: "ws-1",
      socialAccountId: account.id,
      contentText: "最初の投稿です。hello!",
    });
    expect(draft.status).toBe("draft");
    expect(draft.platform).toBe("x");
    // validationResult が付与されている
    expect(draft.validationResult).toMatchObject({ valid: true });

    // 2. 即時公開
    const published = await publishPost(env.postDeps, "ws-1", draft.id);
    expect(published.status).toBe("published");
    expect(published.platformPostId).toMatch(/^ext-x-/);
    expect(published.publishedAt).toBeInstanceOf(Date);

    // 3. DB の状態も一致
    const fetched = await env.postRepo.findById(draft.id);
    expect(fetched?.status).toBe("published");
  });

  it("createPost({ publishNow: true }) は 1 ステップで published になる", async () => {
    const env = makeEnv();
    const account = await createActiveAccount(env.accountRepo, "ws-1", "x", "main-x");

    const post = await createPost(env.postDeps, {
      workspaceId: "ws-1",
      socialAccountId: account.id,
      contentText: "ワンステップ公開",
      publishNow: true,
    });
    expect(post.status).toBe("published");
    expect(post.platformPostId).toBeTruthy();
  });
});

// ───────────────────────────────────────────
// シナリオ 2: 下書き → 予約
// ───────────────────────────────────────────
describe("Phase 2 integration: 下書き作成 → 予約", () => {
  it("schedulePost で ScheduledJob が作成され Post の status が scheduled になる", async () => {
    const env = makeEnv();
    const account = await createActiveAccount(env.accountRepo, "ws-1", "x", "main-x");

    const draft = await createPost(env.postDeps, {
      workspaceId: "ws-1",
      socialAccountId: account.id,
      contentText: "予約投稿テスト",
    });
    expect(draft.status).toBe("draft");

    const scheduledAt = new Date(Date.now() + 60 * 60 * 1000); // 1h later
    const job = await schedulePost(env.scheduleDeps, {
      workspaceId: "ws-1",
      postId: draft.id,
      scheduledAt,
    });

    expect(job.status).toBe("pending");
    expect(job.scheduledAt.getTime()).toBe(scheduledAt.getTime());
    expect(job.postId).toBe(draft.id);

    // Post 側も scheduled 状態に更新される
    const after = await env.postRepo.findById(draft.id);
    expect(after?.status).toBe("scheduled");

    // listPosts で schedule 情報が埋まる
    const list = await listPosts(env.postDeps, "ws-1");
    const listed = list.data.find((p) => p.id === draft.id);
    expect(listed).toBeDefined();
    expect(listed?.schedule).not.toBeNull();
    expect(listed?.schedule?.scheduledAt.getTime()).toBe(scheduledAt.getTime());
    expect(listed?.schedule?.status).toBe("pending");
  });
});

// ───────────────────────────────────────────
// シナリオ 3: バリデーションエラー
// ───────────────────────────────────────────
describe("Phase 2 integration: 文字数超過はValidationError", () => {
  it("X の 280 文字制限を超える投稿は ValidationError で保存されない", async () => {
    const env = makeEnv();
    const account = await createActiveAccount(env.accountRepo, "ws-1", "x", "main-x");

    const longText = "x".repeat(X_TEXT_LIMIT + 1);

    await expect(
      createPost(env.postDeps, {
        workspaceId: "ws-1",
        socialAccountId: account.id,
        contentText: longText,
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    // Post は作成されていない
    const all = await env.postRepo.findByWorkspace("ws-1");
    expect(all).toHaveLength(0);
  });

  it("空の投稿は ValidationError", async () => {
    const env = makeEnv();
    const account = await createActiveAccount(env.accountRepo, "ws-1", "x", "main-x");
    await expect(
      createPost(env.postDeps, {
        workspaceId: "ws-1",
        socialAccountId: account.id,
        contentText: "",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

// ───────────────────────────────────────────
// シナリオ 4: listPosts のフィルタ動作
// ───────────────────────────────────────────
describe("Phase 2 integration: 投稿一覧フィルタ", () => {
  async function seed(env: TestEnv): Promise<{
    xAcc: SocialAccount;
    lineAcc: SocialAccount;
    igAcc: SocialAccount;
    created: Post[];
  }> {
    const xAcc = await createActiveAccount(env.accountRepo, "ws-1", "x", "x-main");
    const lineAcc = await createActiveAccount(env.accountRepo, "ws-1", "line", "line-main");
    const igAcc = await createActiveAccount(env.accountRepo, "ws-1", "instagram", "ig-main");

    // 6 件作成: X=3, LINE=2, IG=1
    const posts: Post[] = [];
    posts.push(
      await createPost(env.postDeps, {
        workspaceId: "ws-1",
        socialAccountId: xAcc.id,
        contentText: "apple on x",
      }),
    );
    posts.push(
      await createPost(env.postDeps, {
        workspaceId: "ws-1",
        socialAccountId: xAcc.id,
        contentText: "banana on x",
        publishNow: true,
      }),
    );
    posts.push(
      await createPost(env.postDeps, {
        workspaceId: "ws-1",
        socialAccountId: xAcc.id,
        contentText: "cherry on x",
      }),
    );
    posts.push(
      await createPost(env.postDeps, {
        workspaceId: "ws-1",
        socialAccountId: lineAcc.id,
        contentText: "apple on line",
      }),
    );
    posts.push(
      await createPost(env.postDeps, {
        workspaceId: "ws-1",
        socialAccountId: lineAcc.id,
        contentText: "durian on line",
        publishNow: true,
      }),
    );
    posts.push(
      await createPost(env.postDeps, {
        workspaceId: "ws-1",
        socialAccountId: igAcc.id,
        contentText: "apple on instagram",
      }),
    );
    return { xAcc, lineAcc, igAcc, created: posts };
  }

  it("フィルタなし: 全件と meta.total / totalPages を返す", async () => {
    const env = makeEnv();
    await seed(env);

    const result = await listPosts(env.postDeps, "ws-1");
    expect(result.data).toHaveLength(6);
    expect(result.meta.total).toBe(6);
    expect(result.meta.page).toBe(1);
    expect(result.meta.limit).toBe(20);
    expect(result.meta.totalPages).toBe(1);
    // 各要素に socialAccount が埋められている
    for (const item of result.data) {
      expect(item.socialAccount).not.toBeNull();
      expect(item.socialAccount?.platform).toBe(item.platform);
    }
  });

  it("platform 単一フィルタ: x のみ", async () => {
    const env = makeEnv();
    await seed(env);
    const result = await listPosts(env.postDeps, "ws-1", { platform: "x" });
    expect(result.data).toHaveLength(3);
    expect(result.meta.total).toBe(3);
    for (const p of result.data) expect(p.platform).toBe("x");
  });

  it("platforms 複数フィルタ: x + line", async () => {
    const env = makeEnv();
    await seed(env);
    const result = await listPosts(env.postDeps, "ws-1", {
      platforms: ["x", "line"],
    });
    expect(result.data).toHaveLength(5);
    for (const p of result.data) expect(["x", "line"]).toContain(p.platform);
  });

  it("status フィルタ: published のみ", async () => {
    const env = makeEnv();
    await seed(env);
    const result = await listPosts(env.postDeps, "ws-1", { status: "published" });
    // seed() で publishNow:true が 2 件
    expect(result.data).toHaveLength(2);
    for (const p of result.data) expect(p.status).toBe("published");
  });

  it("statuses 複数フィルタ: draft + published", async () => {
    const env = makeEnv();
    await seed(env);
    const result = await listPosts(env.postDeps, "ws-1", {
      statuses: ["draft", "published"],
    });
    expect(result.data).toHaveLength(6);
  });

  it("search フィルタ: contentText 部分一致", async () => {
    const env = makeEnv();
    await seed(env);
    const result = await listPosts(env.postDeps, "ws-1", { search: "apple" });
    // apple を含む 3 件
    expect(result.data).toHaveLength(3);
    for (const p of result.data) {
      expect((p.contentText ?? "").toLowerCase()).toContain("apple");
    }
  });

  it("pagination: page=2, limit=2 で適切にページングされる", async () => {
    const env = makeEnv();
    await seed(env);
    const result = await listPosts(env.postDeps, "ws-1", { page: 2, limit: 2 });
    expect(result.data).toHaveLength(2);
    expect(result.meta.total).toBe(6);
    expect(result.meta.page).toBe(2);
    expect(result.meta.limit).toBe(2);
    expect(result.meta.totalPages).toBe(3);
  });

  it("limit の上限は 100 に丸められる", async () => {
    const env = makeEnv();
    await seed(env);
    const result = await listPosts(env.postDeps, "ws-1", { limit: 500 });
    expect(result.meta.limit).toBe(100);
  });

  it("from/to 日付フィルタが効く", async () => {
    const env = makeEnv();
    await seed(env);

    // seed 直後は createdAt がほぼ同時。from を現在+1h にすると全て除外
    const future = new Date(Date.now() + 60 * 60 * 1000);
    const result = await listPosts(env.postDeps, "ws-1", { from: future });
    expect(result.data).toHaveLength(0);
    expect(result.meta.total).toBe(0);
  });

  it("複合フィルタ: platform=x & status=draft & search=apple", async () => {
    const env = makeEnv();
    await seed(env);
    const result = await listPosts(env.postDeps, "ws-1", {
      platform: "x",
      status: "draft",
      search: "apple",
    });
    // x + draft + apple を含むのは "apple on x" の 1 件
    expect(result.data).toHaveLength(1);
    expect(result.data[0].contentText).toBe("apple on x");
  });

  it("別ワークスペースの投稿は見えない", async () => {
    const env = makeEnv();
    await seed(env);

    const otherAcc = await createActiveAccount(env.accountRepo, "ws-other", "x", "x-other");
    await createPost(env.postDeps, {
      workspaceId: "ws-other",
      socialAccountId: otherAcc.id,
      contentText: "別WSの投稿",
    });

    const wsResult = await listPosts(env.postDeps, "ws-1");
    expect(wsResult.data).toHaveLength(6);
    const otherResult = await listPosts(env.postDeps, "ws-other");
    expect(otherResult.data).toHaveLength(1);
  });
});
