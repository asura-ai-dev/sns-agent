/**
 * 予約投稿ユースケースのテスト (Task 2005)
 *
 * schedulePost / updateSchedule / cancelSchedule / listSchedules / getSchedule / executeJob
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { Platform } from "@sns-agent/config";
import type { AuditLog, Post, ScheduledJob, SocialAccount } from "../../domain/entities.js";
import type {
  AccountRepository,
  AuditLogRepository,
  PostRepository,
  ScheduledJobRepository,
} from "../../interfaces/repositories.js";
import type { PublishPostInput, SocialProvider } from "../../interfaces/social-provider.js";
import { encrypt } from "../../domain/crypto.js";
import {
  schedulePost,
  updateSchedule,
  cancelSchedule,
  listSchedules,
  getSchedule,
  getScheduleOperationalView,
  executeJob,
  findExecutableJobs,
  RETRY_BACKOFF_SECONDS,
  LOCK_TIMEOUT_MS,
  dispatchDueJobs,
} from "../schedule.js";
import type { ScheduleUsecaseDeps } from "../schedule.js";
import type { PostUsecaseDeps } from "../post.js";
import { ValidationError, NotFoundError } from "../../errors/domain-error.js";

const TEST_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const PLAINTEXT_CREDS = '{"access_token":"tok"}';

// ───────────────────────────────────────────
// モック
// ───────────────────────────────────────────

function makeAccount(overrides: Partial<SocialAccount> = {}): SocialAccount {
  return {
    id: "acc-1",
    workspaceId: "ws-1",
    platform: "x",
    displayName: "Test",
    externalAccountId: "ext-1",
    credentialsEncrypted: encrypt(PLAINTEXT_CREDS, TEST_ENCRYPTION_KEY),
    tokenExpiresAt: new Date("2099-01-01"),
    status: "active",
    capabilities: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
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

function makeAccountRepo(accounts: SocialAccount[]): AccountRepository {
  const store = new Map(accounts.map((a) => [a.id, { ...a }]));
  return {
    findById: async (id) => {
      const a = store.get(id);
      return a ? { ...a } : null;
    },
    findByWorkspace: async (wsId) => [...store.values()].filter((a) => a.workspaceId === wsId),
    create: async (data) => {
      const a: SocialAccount = {
        ...data,
        id: `acc-${store.size + 1}`,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      store.set(a.id, a);
      return a;
    },
    update: async (id, data) => {
      const e = store.get(id);
      if (!e) throw new Error(`Not found: ${id}`);
      const u = { ...e, ...data, updatedAt: new Date() };
      store.set(id, u);
      return u;
    },
    delete: async (id) => {
      store.delete(id);
    },
  };
}

function makePostRepo(initial: Post[] = []): PostRepository {
  const store = new Map(initial.map((p) => [p.id, { ...p }]));
  let seq = initial.length;
  const filter = (wsId: string, opts: Parameters<PostRepository["findByWorkspace"]>[1]): Post[] => {
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
    arr.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return arr;
  };
  return {
    findById: async (id) => {
      const p = store.get(id);
      return p ? { ...p } : null;
    },
    findByWorkspace: async (wsId, opts) => {
      const arr = filter(wsId, opts);
      const offset = opts?.offset ?? 0;
      const end = opts?.limit ? offset + opts.limit : undefined;
      return arr.slice(offset, end);
    },
    countByWorkspace: async (wsId, opts) => filter(wsId, opts).length,
    create: async (p) => {
      seq += 1;
      const now = new Date();
      const c: Post = { ...p, id: `post-${seq}`, createdAt: now, updatedAt: now };
      store.set(c.id, c);
      return { ...c };
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

function makeJobRepo(initial: ScheduledJob[] = []): ScheduledJobRepository & {
  findByWorkspace: (
    wsId: string,
    opts?: { status?: ScheduledJob["status"]; postId?: string },
  ) => Promise<ScheduledJob[]>;
  findExecutable: (opts: {
    now: Date;
    lockTimeoutMs: number;
    limit: number;
  }) => Promise<ScheduledJob[]>;
} {
  const store = new Map(initial.map((j) => [j.id, { ...j }]));
  let seq = initial.length;
  return {
    findById: async (id) => {
      const j = store.get(id);
      return j ? { ...j } : null;
    },
    findPendingJobs: async (limit) => {
      const now = new Date();
      return [...store.values()]
        .filter((j) => j.status === "pending" && j.scheduledAt <= now)
        .slice(0, limit);
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
    lockJob: async (id, options) => {
      const j = store.get(id);
      if (!j) return null;
      const now = options?.now ?? new Date();
      const staleBefore =
        options?.lockTimeoutMs !== undefined
          ? new Date(now.getTime() - options.lockTimeoutMs)
          : null;
      const canRecoverLocked =
        j.status === "locked" &&
        j.lockedAt !== null &&
        staleBefore !== null &&
        j.lockedAt <= staleBefore;
      if (j.status !== "pending" && j.status !== "retrying" && !canRecoverLocked) return null;
      const locked = { ...j, status: "locked" as const, lockedAt: now };
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
    findByWorkspace: async (wsId, opts) => {
      let arr = [...store.values()].filter((j) => j.workspaceId === wsId);
      if (opts?.status) arr = arr.filter((j) => j.status === opts.status);
      if (opts?.postId) arr = arr.filter((j) => j.postId === opts.postId);
      return arr;
    },
    findExecutable: async (opts) => {
      const { now, lockTimeoutMs, limit } = opts;
      const staleBefore = new Date(now.getTime() - lockTimeoutMs);
      return [...store.values()]
        .filter((j) => {
          if (j.status === "pending" && j.scheduledAt <= now) return true;
          if (j.status === "retrying" && j.nextRetryAt && j.nextRetryAt <= now) return true;
          if (j.status === "locked" && j.lockedAt && j.lockedAt <= staleBefore) return true;
          return false;
        })
        .slice(0, limit);
    },
  };
}

function makeProvider(
  opts: {
    publishSuccess?: boolean;
    publishError?: string;
    publishThrows?: boolean;
    publishInputs?: PublishPostInput[];
  } = {},
): SocialProvider {
  return {
    platform: "x" as Platform,
    getCapabilities: () => ({
      textPost: true,
      imagePost: true,
      videoPost: false,
      threadPost: true,
      directMessage: false,
      commentReply: false,
      broadcast: false,
      nativeSchedule: false,
      usageApi: false,
    }),
    connectAccount: async () => ({}),
    validatePost: async () => ({ valid: true, errors: [], warnings: [] }),
    publishPost: async (input) => {
      opts.publishInputs?.push(input);
      if (opts.publishThrows) throw new Error("network failure");
      if (opts.publishSuccess === false) {
        return { success: false, error: opts.publishError ?? "publish failed" };
      }
      return {
        success: true,
        platformPostId: "ext-post-1",
        publishedAt: new Date("2026-04-10T10:00:00Z"),
      };
    },
    deletePost: async () => ({ success: true }),
  };
}

class InMemoryAuditRepo implements AuditLogRepository {
  logs: AuditLog[] = [];

  async create(log: Omit<AuditLog, "id">): Promise<AuditLog> {
    const created: AuditLog = {
      ...log,
      id: `audit-${this.logs.length + 1}`,
    };
    this.logs.unshift(created);
    return created;
  }

  async findByWorkspace(
    workspaceId: string,
    options?: {
      actorId?: string;
      actorType?: string;
      action?: string;
      resourceType?: string;
      resourceId?: string;
      platform?: string;
      startDate?: Date;
      endDate?: Date;
      limit?: number;
      offset?: number;
    },
  ): Promise<AuditLog[]> {
    let result = this.logs.filter((log) => log.workspaceId === workspaceId);
    if (options?.actorId) result = result.filter((log) => log.actorId === options.actorId);
    if (options?.actorType) result = result.filter((log) => log.actorType === options.actorType);
    if (options?.action) result = result.filter((log) => log.action === options.action);
    if (options?.resourceType) {
      result = result.filter((log) => log.resourceType === options.resourceType);
    }
    if (options?.resourceId) result = result.filter((log) => log.resourceId === options.resourceId);
    if (options?.platform) result = result.filter((log) => log.platform === options.platform);
    if (options?.startDate) result = result.filter((log) => log.createdAt >= options.startDate!);
    if (options?.endDate) result = result.filter((log) => log.createdAt <= options.endDate!);
    if (options?.offset) result = result.slice(options.offset);
    if (options?.limit) result = result.slice(0, options.limit);
    return result.map((log) => ({ ...log }));
  }

  async countByWorkspace(
    workspaceId: string,
    options?: Omit<Parameters<AuditLogRepository["findByWorkspace"]>[1], "limit" | "offset">,
  ): Promise<number> {
    const logs = await this.findByWorkspace(workspaceId, options);
    return logs.length;
  }
}

function makeDeps(
  accounts: SocialAccount[] = [makeAccount()],
  posts: Post[] = [],
  jobs: ScheduledJob[] = [],
  providerOpts: { publishSuccess?: boolean; publishError?: string; publishThrows?: boolean } = {},
  now: () => Date = () => new Date("2026-04-10T00:00:00Z"),
): ScheduleUsecaseDeps & { auditRepo: InMemoryAuditRepo } {
  const providers = new Map<Platform, SocialProvider>();
  providers.set("x", makeProvider(providerOpts));

  const postRepo = makePostRepo(posts);
  const accountRepo = makeAccountRepo(accounts);
  const scheduledJobRepo = makeJobRepo(jobs);
  const auditRepo = new InMemoryAuditRepo();

  const postUsecaseDeps: PostUsecaseDeps = {
    postRepo,
    accountRepo,
    providers,
    encryptionKey: TEST_ENCRYPTION_KEY,
  };

  return {
    scheduledJobRepo,
    postRepo,
    auditRepo,
    postUsecaseDeps,
    now,
  };
}

// ───────────────────────────────────────────
// schedulePost
// ───────────────────────────────────────────

describe("schedulePost", () => {
  it("creates a pending job and updates post status to scheduled", async () => {
    const post = makePost();
    const deps = makeDeps(undefined, [post]);
    const future = new Date("2026-04-10T12:00:00Z");

    const job = await schedulePost(deps, {
      workspaceId: "ws-1",
      postId: post.id,
      scheduledAt: future,
    });

    expect(job.status).toBe("pending");
    expect(job.scheduledAt).toEqual(future);
    expect(job.attemptCount).toBe(0);
    expect(job.maxAttempts).toBe(3);

    const updatedPost = await deps.postRepo.findById(post.id);
    expect(updatedPost?.status).toBe("scheduled");
  });

  it("throws ValidationError if scheduledAt is in the past", async () => {
    const post = makePost();
    const deps = makeDeps(undefined, [post]);
    const past = new Date("2026-04-09T00:00:00Z");

    await expect(
      schedulePost(deps, { workspaceId: "ws-1", postId: post.id, scheduledAt: past }),
    ).rejects.toThrow(ValidationError);
  });

  it("throws ValidationError if post is not draft", async () => {
    const post = makePost({ status: "published" });
    const deps = makeDeps(undefined, [post]);

    await expect(
      schedulePost(deps, {
        workspaceId: "ws-1",
        postId: post.id,
        scheduledAt: new Date("2026-04-10T12:00:00Z"),
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("throws NotFoundError if post is in different workspace", async () => {
    const post = makePost({ workspaceId: "ws-other" });
    const deps = makeDeps(undefined, [post]);

    await expect(
      schedulePost(deps, {
        workspaceId: "ws-1",
        postId: post.id,
        scheduledAt: new Date("2026-04-10T12:00:00Z"),
      }),
    ).rejects.toThrow(NotFoundError);
  });
});

// ───────────────────────────────────────────
// updateSchedule
// ───────────────────────────────────────────

describe("updateSchedule", () => {
  it("updates scheduledAt for a pending job", async () => {
    const post = makePost();
    const deps = makeDeps(undefined, [post]);
    const job = await schedulePost(deps, {
      workspaceId: "ws-1",
      postId: post.id,
      scheduledAt: new Date("2026-04-10T12:00:00Z"),
    });

    const newTime = new Date("2026-04-10T15:00:00Z");
    const updated = await updateSchedule(deps, "ws-1", job.id, newTime);
    expect(updated.scheduledAt).toEqual(newTime);
  });

  it("rejects update if job is not pending", async () => {
    const post = makePost();
    const deps = makeDeps(undefined, [post]);
    const job = await schedulePost(deps, {
      workspaceId: "ws-1",
      postId: post.id,
      scheduledAt: new Date("2026-04-10T12:00:00Z"),
    });
    await deps.scheduledJobRepo.update(job.id, { status: "running" });

    await expect(
      updateSchedule(deps, "ws-1", job.id, new Date("2026-04-10T15:00:00Z")),
    ).rejects.toThrow(ValidationError);
  });

  it("allows reschedule from retrying and resets it to pending", async () => {
    const post = makePost();
    const deps = makeDeps(undefined, [post]);
    const job = await schedulePost(deps, {
      workspaceId: "ws-1",
      postId: post.id,
      scheduledAt: new Date("2026-04-10T12:00:00Z"),
    });
    await deps.scheduledJobRepo.update(job.id, {
      status: "retrying",
      nextRetryAt: new Date("2026-04-10T12:01:00Z"),
    });

    const updated = await updateSchedule(deps, "ws-1", job.id, new Date("2026-04-10T15:00:00Z"));
    expect(updated.status).toBe("pending");
    expect(updated.nextRetryAt).toBeNull();
  });
});

// ───────────────────────────────────────────
// cancelSchedule
// ───────────────────────────────────────────

describe("cancelSchedule", () => {
  it("cancels a pending job and reverts post to draft", async () => {
    const post = makePost();
    const deps = makeDeps(undefined, [post]);
    const job = await schedulePost(deps, {
      workspaceId: "ws-1",
      postId: post.id,
      scheduledAt: new Date("2026-04-10T12:00:00Z"),
    });

    const canceled = await cancelSchedule(deps, "ws-1", job.id);
    expect(canceled.status).toBe("failed");
    expect(canceled.lastError).toBe("canceled_by_user");

    const updatedPost = await deps.postRepo.findById(post.id);
    expect(updatedPost?.status).toBe("draft");
  });

  it("rejects cancel if job is running", async () => {
    const post = makePost();
    const deps = makeDeps(undefined, [post]);
    const job = await schedulePost(deps, {
      workspaceId: "ws-1",
      postId: post.id,
      scheduledAt: new Date("2026-04-10T12:00:00Z"),
    });
    await deps.scheduledJobRepo.update(job.id, { status: "running" });

    await expect(cancelSchedule(deps, "ws-1", job.id)).rejects.toThrow(ValidationError);
  });
});

// ───────────────────────────────────────────
// listSchedules / getSchedule
// ───────────────────────────────────────────

describe("listSchedules", () => {
  it("returns jobs in the workspace", async () => {
    const post1 = makePost({ id: "post-1" });
    const post2 = makePost({ id: "post-2" });
    const deps = makeDeps(undefined, [post1, post2]);

    await schedulePost(deps, {
      workspaceId: "ws-1",
      postId: post1.id,
      scheduledAt: new Date("2026-04-10T12:00:00Z"),
    });
    await schedulePost(deps, {
      workspaceId: "ws-1",
      postId: post2.id,
      scheduledAt: new Date("2026-04-11T12:00:00Z"),
    });

    const list = await listSchedules(deps, "ws-1");
    expect(list.length).toBe(2);
  });

  it("filters by from/to", async () => {
    const post1 = makePost({ id: "post-1" });
    const post2 = makePost({ id: "post-2" });
    const deps = makeDeps(undefined, [post1, post2]);

    await schedulePost(deps, {
      workspaceId: "ws-1",
      postId: post1.id,
      scheduledAt: new Date("2026-04-10T12:00:00Z"),
    });
    await schedulePost(deps, {
      workspaceId: "ws-1",
      postId: post2.id,
      scheduledAt: new Date("2026-04-20T12:00:00Z"),
    });

    const list = await listSchedules(deps, "ws-1", {
      from: new Date("2026-04-15T00:00:00Z"),
    });
    expect(list.length).toBe(1);
    expect(list[0].postId).toBe("post-2");
  });
});

describe("getSchedule", () => {
  it("returns a single job", async () => {
    const post = makePost();
    const deps = makeDeps(undefined, [post]);
    const job = await schedulePost(deps, {
      workspaceId: "ws-1",
      postId: post.id,
      scheduledAt: new Date("2026-04-10T12:00:00Z"),
    });

    const got = await getSchedule(deps, "ws-1", job.id);
    expect(got.id).toBe(job.id);
  });

  it("throws NotFoundError for unknown job", async () => {
    const deps = makeDeps();
    await expect(getSchedule(deps, "ws-1", "missing")).rejects.toThrow(NotFoundError);
  });
});

// ───────────────────────────────────────────
// executeJob
// ───────────────────────────────────────────

describe("executeJob", () => {
  it.each([
    {
      name: "text",
      post: makePost({
        id: "post-text",
        contentText: "scheduled text",
      }),
      expected: {
        contentText: "scheduled text",
        contentMedia: null,
        providerMetadata: null,
      },
    },
    {
      name: "media",
      post: makePost({
        id: "post-media",
        contentText: "scheduled media",
        contentMedia: [
          { type: "image", url: "data:image/png;base64,aGVsbG8=", mimeType: "image/png" },
        ],
      }),
      expected: {
        contentText: "scheduled media",
        contentMedia: [
          { type: "image", url: "data:image/png;base64,aGVsbG8=", mimeType: "image/png" },
        ],
        providerMetadata: null,
      },
    },
    {
      name: "thread",
      post: makePost({
        id: "post-thread",
        contentText: "scheduled root",
        providerMetadata: { x: { threadPosts: [{ contentText: "scheduled reply" }] } },
      }),
      expected: {
        contentText: "scheduled root",
        contentMedia: null,
        providerMetadata: {
          x: {
            quotePostId: null,
            threadPosts: [{ contentText: "scheduled reply" }],
            publishedThreadIds: null,
          },
        },
      },
    },
    {
      name: "quote",
      post: makePost({
        id: "post-quote",
        contentText: "",
        providerMetadata: { x: { quotePostId: "tweet-42" } },
      }),
      expected: {
        contentText: "",
        contentMedia: null,
        providerMetadata: {
          x: { quotePostId: "tweet-42", threadPosts: null, publishedThreadIds: null },
        },
      },
    },
    {
      name: "media thread quote",
      post: makePost({
        id: "post-combined",
        contentText: "scheduled root with image",
        contentMedia: [
          { type: "image", url: "data:image/png;base64,aGVsbG8=", mimeType: "image/png" },
        ],
        providerMetadata: {
          x: {
            quotePostId: "tweet-42",
            threadPosts: [{ contentText: "scheduled image follow-up" }],
          },
        },
      }),
      expected: {
        contentText: "scheduled root with image",
        contentMedia: [
          { type: "image", url: "data:image/png;base64,aGVsbG8=", mimeType: "image/png" },
        ],
        providerMetadata: {
          x: {
            quotePostId: "tweet-42",
            threadPosts: [{ contentText: "scheduled image follow-up" }],
            publishedThreadIds: null,
          },
        },
      },
    },
  ])("publishes scheduled X $name variants through the provider", async ({ post, expected }) => {
    const publishInputs: PublishPostInput[] = [];
    const deps = makeDeps(undefined, [post], [], { publishInputs });
    const job = await schedulePost(deps, {
      workspaceId: "ws-1",
      postId: post.id,
      scheduledAt: new Date("2026-04-10T12:00:00Z"),
    });

    const result = await executeJob(deps, job.id);

    expect(result?.job.status).toBe("succeeded");
    expect(publishInputs).toHaveLength(1);
    expect(publishInputs[0]).toMatchObject(expected);
  });

  it("executes a pending job successfully and marks succeeded", async () => {
    const post = makePost();
    const deps = makeDeps(undefined, [post]);
    const job = await schedulePost(deps, {
      workspaceId: "ws-1",
      postId: post.id,
      scheduledAt: new Date("2026-04-10T12:00:00Z"),
    });

    const result = await executeJob(deps, job.id);
    expect(result).not.toBeNull();
    expect(result!.job.status).toBe("succeeded");
    expect(result!.willRetry).toBe(false);
    expect(result!.post?.status).toBe("published");
  });

  it("marks job retrying with nextRetryAt on publish failure (attempt < max)", async () => {
    const post = makePost();
    const deps = makeDeps(undefined, [post], [], { publishSuccess: false, publishError: "boom" });
    const job = await schedulePost(deps, {
      workspaceId: "ws-1",
      postId: post.id,
      scheduledAt: new Date("2026-04-10T12:00:00Z"),
    });

    const result = await executeJob(deps, job.id);
    expect(result).not.toBeNull();
    expect(result!.job.status).toBe("retrying");
    expect(result!.job.attemptCount).toBe(1);
    expect(result!.job.nextRetryAt).not.toBeNull();
    // Backoff should be 30s after attempt 1
    const delayMs = result!.job.nextRetryAt!.getTime() - new Date("2026-04-10T00:00:00Z").getTime();
    expect(delayMs).toBe(RETRY_BACKOFF_SECONDS[0] * 1000);
    expect(result!.willRetry).toBe(true);
    expect(result!.job.lastError).toMatch(/^retryable:/);
  });

  it("marks job failed after reaching max attempts", async () => {
    const post = makePost();
    const deps = makeDeps(undefined, [post], [], { publishSuccess: false, publishError: "boom" });
    const job = await schedulePost(deps, {
      workspaceId: "ws-1",
      postId: post.id,
      scheduledAt: new Date("2026-04-10T12:00:00Z"),
    });

    // Simulate two prior failures
    await deps.scheduledJobRepo.update(job.id, {
      attemptCount: 2,
      status: "retrying",
    });

    const result = await executeJob(deps, job.id);
    expect(result).not.toBeNull();
    expect(result!.job.status).toBe("failed");
    expect(result!.job.attemptCount).toBe(3);
    expect(result!.willRetry).toBe(false);

    const updatedPost = await deps.postRepo.findById(post.id);
    expect(updatedPost?.status).toBe("failed");
  });

  it("returns null when lock cannot be acquired", async () => {
    const post = makePost();
    const deps = makeDeps(undefined, [post]);
    const job = await schedulePost(deps, {
      workspaceId: "ws-1",
      postId: post.id,
      scheduledAt: new Date("2026-04-10T12:00:00Z"),
    });
    // Pre-lock
    await deps.scheduledJobRepo.update(job.id, { status: "running" });

    const result = await executeJob(deps, job.id);
    expect(result).toBeNull();
  });

  it("recovers a stale locked job and completes it", async () => {
    const now = new Date("2026-04-10T12:00:00Z");
    const post = makePost({ status: "scheduled" });
    const deps = makeDeps(
      undefined,
      [post],
      [
        {
          id: "job-1",
          workspaceId: "ws-1",
          postId: post.id,
          scheduledAt: new Date("2026-04-10T11:00:00Z"),
          status: "locked",
          lockedAt: new Date(now.getTime() - LOCK_TIMEOUT_MS - 60_000),
          startedAt: new Date("2026-04-10T11:50:00Z"),
          completedAt: null,
          attemptCount: 1,
          maxAttempts: 3,
          lastError: null,
          nextRetryAt: null,
          createdAt: new Date("2026-04-10T10:00:00Z"),
        },
      ],
      {},
      () => now,
    );

    const result = await executeJob(deps, "job-1");
    expect(result).not.toBeNull();
    expect(result!.job.status).toBe("succeeded");
  });

  it("increments attemptCount on each retry invocation", async () => {
    const post = makePost();
    const deps = makeDeps(undefined, [post], [], { publishThrows: true });
    const job = await schedulePost(deps, {
      workspaceId: "ws-1",
      postId: post.id,
      scheduledAt: new Date("2026-04-10T12:00:00Z"),
    });

    const r1 = await executeJob(deps, job.id);
    expect(r1!.job.attemptCount).toBe(1);
    expect(r1!.job.status).toBe("retrying");

    const r2 = await executeJob(deps, job.id);
    expect(r2!.job.attemptCount).toBe(2);
    expect(r2!.job.status).toBe("retrying");
    // Backoff should be 120s for attempt 2
    const delayMs = r2!.job.nextRetryAt!.getTime() - new Date("2026-04-10T00:00:00Z").getTime();
    expect(delayMs).toBe(RETRY_BACKOFF_SECONDS[1] * 1000);

    const r3 = await executeJob(deps, job.id);
    expect(r3!.job.attemptCount).toBe(3);
    expect(r3!.job.status).toBe("failed");
  });

  it("stops immediately for non-retryable validation errors", async () => {
    const post = makePost();
    const deps = makeDeps(undefined, [post]);
    const job = await schedulePost(deps, {
      workspaceId: "ws-1",
      postId: post.id,
      scheduledAt: new Date("2026-04-10T12:00:00Z"),
    });

    await deps.postRepo.update(post.id, { status: "published" });

    const result = await executeJob(deps, job.id);
    expect(result).not.toBeNull();
    expect(result!.job.status).toBe("failed");
    expect(result!.willRetry).toBe(false);
    expect(result!.job.lastError).toMatch(/^terminal:/);

    expect(deps.auditRepo.logs[0]?.action).toBe("schedule.execution.failed");
    expect((deps.auditRepo.logs[0]?.resultSummary as { retryRule?: string }).retryRule).toBe(
      "non_retryable",
    );
  });

  it("resets failed posts back to draft before retrying a transient failure", async () => {
    const post = makePost();
    const deps = makeDeps(undefined, [post], [], { publishThrows: true });
    const job = await schedulePost(deps, {
      workspaceId: "ws-1",
      postId: post.id,
      scheduledAt: new Date("2026-04-10T12:00:00Z"),
    });

    const first = await executeJob(deps, job.id);
    expect(first!.job.status).toBe("retrying");

    const provider = deps.postUsecaseDeps.providers.get("x");
    if (!provider) throw new Error("provider not found");
    provider.publishPost = async () => ({
      success: true,
      platformPostId: "ext-post-2",
      publishedAt: new Date("2026-04-10T00:02:00Z"),
    });

    const second = await executeJob(deps, job.id);
    expect(second!.job.status).toBe("succeeded");
    expect(second!.post?.status).toBe("published");
  });

  it("builds operational view from recorded execution logs", async () => {
    const post = makePost();
    const deps = makeDeps(undefined, [post], [], { publishSuccess: false, publishError: "boom" });
    const job = await schedulePost(deps, {
      workspaceId: "ws-1",
      postId: post.id,
      scheduledAt: new Date("2026-04-10T12:00:00Z"),
    });

    await executeJob(deps, job.id);

    const detail = await getScheduleOperationalView(deps, "ws-1", job.id);
    expect(detail.executionLogs.length).toBe(1);
    expect(detail.latestExecution?.status).toBe("retrying");
    expect(detail.notificationTarget.label).toContain("投稿作成者");
  });
});

// ───────────────────────────────────────────
// findExecutableJobs
// ───────────────────────────────────────────

describe("findExecutableJobs", () => {
  it("returns pending jobs whose scheduledAt has passed", async () => {
    const post = makePost();
    const now = new Date("2026-04-10T12:00:00Z");
    const deps = makeDeps(undefined, [post], [], {}, () => now);

    // Pre-create a pending job that's due
    await deps.scheduledJobRepo.create({
      workspaceId: "ws-1",
      postId: post.id,
      scheduledAt: new Date("2026-04-10T11:59:00Z"),
      status: "pending",
      lockedAt: null,
      startedAt: null,
      completedAt: null,
      attemptCount: 0,
      maxAttempts: 3,
      lastError: null,
      nextRetryAt: null,
    });

    const jobs = await findExecutableJobs(deps, 10);
    expect(jobs.length).toBe(1);
  });

  it("returns retrying jobs whose nextRetryAt has passed", async () => {
    const post = makePost();
    const now = new Date("2026-04-10T12:00:00Z");
    const deps = makeDeps(undefined, [post], [], {}, () => now);

    await deps.scheduledJobRepo.create({
      workspaceId: "ws-1",
      postId: post.id,
      scheduledAt: new Date("2026-04-10T11:00:00Z"),
      status: "retrying",
      lockedAt: null,
      startedAt: new Date("2026-04-10T11:00:00Z"),
      completedAt: null,
      attemptCount: 1,
      maxAttempts: 3,
      lastError: "boom",
      nextRetryAt: new Date("2026-04-10T11:59:30Z"),
    });

    const jobs = await findExecutableJobs(deps, 10);
    expect(jobs.length).toBe(1);
    expect(jobs[0].status).toBe("retrying");
  });

  it("returns locked jobs with stale lockedAt (deadlock recovery)", async () => {
    const post = makePost();
    const now = new Date("2026-04-10T12:00:00Z");
    const deps = makeDeps(undefined, [post], [], {}, () => now);

    await deps.scheduledJobRepo.create({
      workspaceId: "ws-1",
      postId: post.id,
      scheduledAt: new Date("2026-04-10T11:00:00Z"),
      status: "locked",
      lockedAt: new Date("2026-04-10T11:50:00Z"), // 10 min ago > 5 min threshold
      startedAt: new Date("2026-04-10T11:50:00Z"),
      completedAt: null,
      attemptCount: 1,
      maxAttempts: 3,
      lastError: null,
      nextRetryAt: null,
    });

    const jobs = await findExecutableJobs(deps, 10);
    expect(jobs.length).toBe(1);
  });

  it("skips recently-locked jobs (< 5 min)", async () => {
    const post = makePost();
    const now = new Date("2026-04-10T12:00:00Z");
    const deps = makeDeps(undefined, [post], [], {}, () => now);

    await deps.scheduledJobRepo.create({
      workspaceId: "ws-1",
      postId: post.id,
      scheduledAt: new Date("2026-04-10T11:00:00Z"),
      status: "locked",
      lockedAt: new Date("2026-04-10T11:58:00Z"), // 2 min ago
      startedAt: null,
      completedAt: null,
      attemptCount: 0,
      maxAttempts: 3,
      lastError: null,
      nextRetryAt: null,
    });

    const jobs = await findExecutableJobs(deps, 10);
    expect(jobs.length).toBe(0);
  });
});

describe("dispatchDueJobs", () => {
  it("returns execution summary for due jobs", async () => {
    const now = new Date("2026-04-10T12:00:00Z");
    const post = makePost({ status: "scheduled" });
    const deps = makeDeps(
      undefined,
      [post],
      [
        {
          id: "job-1",
          workspaceId: "ws-1",
          postId: post.id,
          scheduledAt: new Date("2026-04-10T11:30:00Z"),
          status: "pending",
          lockedAt: null,
          startedAt: null,
          completedAt: null,
          attemptCount: 0,
          maxAttempts: 3,
          lastError: null,
          nextRetryAt: null,
          createdAt: new Date("2026-04-10T10:00:00Z"),
        },
      ],
      {},
      () => now,
    );

    const result = await dispatchDueJobs(deps, { limit: 10 });
    expect(result.scanned).toBe(1);
    expect(result.processed).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(result.jobs[0].afterStatus).toBe("succeeded");
  });
});
