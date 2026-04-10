/**
 * 投稿管理ユースケース
 *
 * Task 2004: 投稿の作成（下書き保存）、編集、即時公開、削除、一覧のユースケース。
 * design.md セクション 3.1（posts）、4.2（投稿管理）、11（投稿バリデーション）に準拠。
 */
import type { Platform } from "@sns-agent/config";
import { estimateCost } from "@sns-agent/config";
import type { MediaAttachment, Post, SocialAccount } from "../domain/entities.js";
import type {
  AccountRepository,
  PostRepository,
  UsageRepository,
} from "../interfaces/repositories.js";
import type { SocialProvider, ValidationResult } from "../interfaces/social-provider.js";
import { NotFoundError, ValidationError, ProviderError } from "../errors/domain-error.js";
import { decrypt } from "../domain/crypto.js";

// ───────────────────────────────────────────
// 依存注入コンテキスト
// ───────────────────────────────────────────

export interface PostUsecaseDeps {
  postRepo: PostRepository;
  accountRepo: AccountRepository;
  /** platform -> SocialProvider */
  providers: Map<Platform, SocialProvider>;
  /** AES-256-GCM 用の暗号化キー */
  encryptionKey: string;
  /**
   * 使用量記録先。省略時は記録しない (後方互換)。
   * Task 4003: Provider 呼び出し成否をこの Repository に記録する。
   */
  usageRepo?: UsageRepository;
}

// ───────────────────────────────────────────
// 入出力型
// ───────────────────────────────────────────

export interface CreatePostInput {
  workspaceId: string;
  socialAccountId: string;
  contentText: string | null;
  contentMedia?: MediaAttachment[] | null;
  /** true で即時公開、false または省略で下書き保存 */
  publishNow?: boolean;
  /** 冪等性キー（指定時は同一キーで既存投稿を返す） */
  idempotencyKey?: string | null;
  /** 作成者 (user_id or agent_identity_id) */
  createdBy?: string | null;
}

export interface UpdatePostInput {
  contentText?: string | null;
  contentMedia?: MediaAttachment[] | null;
}

export interface ListPostsFilters {
  platform?: Platform;
  status?: Post["status"];
  from?: Date;
  to?: Date;
  page?: number;
  limit?: number;
}

export interface ListPostsResult {
  data: Post[];
  meta: {
    page: number;
    limit: number;
    total: number;
  };
}

// ───────────────────────────────────────────
// ヘルパー
// ───────────────────────────────────────────

/** アカウントを取得しワークスペース一致チェックを行う */
async function loadAccountForWorkspace(
  deps: PostUsecaseDeps,
  workspaceId: string,
  socialAccountId: string,
): Promise<SocialAccount> {
  const account = await deps.accountRepo.findById(socialAccountId);
  if (!account) {
    throw new NotFoundError("SocialAccount", socialAccountId);
  }
  if (account.workspaceId !== workspaceId) {
    throw new NotFoundError("SocialAccount", socialAccountId);
  }
  if (account.status !== "active") {
    throw new ValidationError(
      `SocialAccount ${socialAccountId} is not active (status=${account.status})`,
    );
  }
  return account;
}

function getProvider(deps: PostUsecaseDeps, platform: Platform): SocialProvider {
  const provider = deps.providers.get(platform);
  if (!provider) {
    throw new ValidationError(`Unsupported platform: ${platform}`);
  }
  return provider;
}

/** Post の所有権チェック */
async function loadOwnedPost(
  deps: PostUsecaseDeps,
  workspaceId: string,
  postId: string,
): Promise<Post> {
  const post = await deps.postRepo.findById(postId);
  if (!post || post.workspaceId !== workspaceId) {
    throw new NotFoundError("Post", postId);
  }
  return post;
}

/**
 * credentials を復号する。
 * account.credentialsEncrypted が暗号化済み文字列の想定。
 * 復号失敗は ProviderError として扱う。
 */
function decryptCredentials(credentialsEncrypted: string, encryptionKey: string): string {
  try {
    return decrypt(credentialsEncrypted, encryptionKey);
  } catch {
    throw new ProviderError("Failed to decrypt account credentials");
  }
}

/**
 * Provider 呼び出し後に使用量レコードを記録する (best-effort)。
 * usageRepo 未設定・記録失敗はログのみで投稿フローを止めない。
 */
async function recordProviderUsage(
  deps: PostUsecaseDeps,
  args: {
    workspaceId: string;
    platform: Platform;
    endpoint: string;
    actorId: string | null;
    success: boolean;
  },
): Promise<void> {
  if (!deps.usageRepo) return;
  try {
    const estimated = estimateCost(args.platform, args.endpoint, 1);
    await deps.usageRepo.record({
      workspaceId: args.workspaceId,
      platform: args.platform,
      endpoint: args.endpoint,
      actorId: args.actorId,
      actorType: "user",
      requestCount: 1,
      success: args.success,
      estimatedCostUsd: estimated,
      recordedAt: new Date(),
    });
  } catch (err) {
    // best-effort: 使用量記録の失敗でフローを止めない
    console.error("[post.usage] failed to record usage:", err);
  }
}

// ───────────────────────────────────────────
// ユースケース: createPost
// ───────────────────────────────────────────

/**
 * 投稿を作成する。
 *
 * フロー:
 * 1. idempotencyKey が指定されていれば既存投稿を返す
 * 2. アカウントを取得しワークスペース一致確認
 * 3. Provider.validatePost でバリデーション実行
 *    - 失敗時: ValidationError（保存しない）
 * 4. DB に draft として保存（validation_result 付き）
 * 5. publishNow なら publishPost を呼び、結果を反映
 */
export async function createPost(deps: PostUsecaseDeps, input: CreatePostInput): Promise<Post> {
  // 1. Idempotency チェック
  if (input.idempotencyKey) {
    const existing = await deps.postRepo.findByIdempotencyKey(input.idempotencyKey);
    if (existing) {
      // 既存投稿のワークスペースが一致すれば返す
      if (existing.workspaceId === input.workspaceId) {
        return existing;
      }
      // 他ワークスペースの場合はキー衝突として扱う
      throw new ValidationError(
        `Idempotency key already used by another workspace: ${input.idempotencyKey}`,
      );
    }
  }

  // 2. アカウント確認
  const account = await loadAccountForWorkspace(deps, input.workspaceId, input.socialAccountId);

  // 3. Provider バリデーション
  const provider = getProvider(deps, account.platform);
  const validation: ValidationResult = await provider.validatePost({
    platform: account.platform,
    contentText: input.contentText,
    contentMedia: input.contentMedia ?? null,
  });

  if (!validation.valid) {
    throw new ValidationError("Post validation failed", {
      errors: validation.errors,
      warnings: validation.warnings,
    });
  }

  // 4. draft として保存
  const created = await deps.postRepo.create({
    workspaceId: input.workspaceId,
    socialAccountId: input.socialAccountId,
    platform: account.platform,
    status: "draft",
    contentText: input.contentText,
    contentMedia: input.contentMedia ?? null,
    platformPostId: null,
    validationResult: validation,
    idempotencyKey: input.idempotencyKey ?? null,
    createdBy: input.createdBy ?? null,
    publishedAt: null,
  });

  // 5. publishNow なら即時公開
  if (input.publishNow) {
    return publishPost(deps, input.workspaceId, created.id);
  }

  return created;
}

// ───────────────────────────────────────────
// ユースケース: updatePost
// ───────────────────────────────────────────

/**
 * 下書きを更新する。status が draft 以外の場合はエラー。
 * 内容変更時は再バリデーションを行い validationResult を更新する。
 */
export async function updatePost(
  deps: PostUsecaseDeps,
  workspaceId: string,
  postId: string,
  input: UpdatePostInput,
): Promise<Post> {
  const post = await loadOwnedPost(deps, workspaceId, postId);

  if (post.status !== "draft") {
    throw new ValidationError(`Only draft posts can be updated (current status: ${post.status})`);
  }

  const newText = input.contentText !== undefined ? input.contentText : post.contentText;
  const newMedia = input.contentMedia !== undefined ? input.contentMedia : post.contentMedia;

  // 再バリデーション
  const provider = getProvider(deps, post.platform);
  const validation = await provider.validatePost({
    platform: post.platform,
    contentText: newText,
    contentMedia: newMedia,
  });

  if (!validation.valid) {
    throw new ValidationError("Post validation failed", {
      errors: validation.errors,
      warnings: validation.warnings,
    });
  }

  return deps.postRepo.update(postId, {
    contentText: newText,
    contentMedia: newMedia,
    validationResult: validation,
  });
}

// ───────────────────────────────────────────
// ユースケース: publishPost
// ───────────────────────────────────────────

/**
 * 下書きを即時公開する。
 *
 * フロー:
 * 1. Post を取得し status が draft であることを確認
 * 2. status を publishing に更新（中間状態）
 * 3. Provider.publishPost を呼び出し
 * 4. 成功: status=published, platform_post_id, published_at を記録
 *    失敗: status=failed, last error を validation_result に追記
 */
export async function publishPost(
  deps: PostUsecaseDeps,
  workspaceId: string,
  postId: string,
): Promise<Post> {
  const post = await loadOwnedPost(deps, workspaceId, postId);

  if (post.status !== "draft") {
    throw new ValidationError(`Only draft posts can be published (current status: ${post.status})`);
  }

  const account = await loadAccountForWorkspace(deps, workspaceId, post.socialAccountId);
  const provider = getProvider(deps, post.platform);

  // 中間状態に遷移
  await deps.postRepo.update(postId, { status: "publishing" });

  const credentials = decryptCredentials(account.credentialsEncrypted, deps.encryptionKey);

  try {
    const result = await provider.publishPost({
      accountCredentials: credentials,
      contentText: post.contentText,
      contentMedia: post.contentMedia,
      idempotencyKey: post.idempotencyKey ?? undefined,
    });

    if (!result.success) {
      const updated = await deps.postRepo.update(postId, {
        status: "failed",
        validationResult: {
          ...(typeof post.validationResult === "object" && post.validationResult !== null
            ? (post.validationResult as Record<string, unknown>)
            : {}),
          publishError: result.error ?? "unknown error",
        },
      });
      await recordProviderUsage(deps, {
        workspaceId,
        platform: post.platform,
        endpoint: "post.publish",
        actorId: post.createdBy ?? null,
        success: false,
      });
      throw new ProviderError(`Failed to publish post: ${result.error ?? "unknown error"}`, {
        postId,
        post: updated,
      });
    }

    const published = await deps.postRepo.update(postId, {
      status: "published",
      platformPostId: result.platformPostId,
      publishedAt: result.publishedAt ?? new Date(),
    });
    await recordProviderUsage(deps, {
      workspaceId,
      platform: post.platform,
      endpoint: "post.publish",
      actorId: post.createdBy ?? null,
      success: true,
    });
    return published;
  } catch (err) {
    // Provider 呼び出し自体が throw した場合
    if (err instanceof ProviderError) {
      throw err;
    }
    await deps.postRepo.update(postId, {
      status: "failed",
      validationResult: {
        ...(typeof post.validationResult === "object" && post.validationResult !== null
          ? (post.validationResult as Record<string, unknown>)
          : {}),
        publishError: err instanceof Error ? err.message : String(err),
      },
    });
    await recordProviderUsage(deps, {
      workspaceId,
      platform: post.platform,
      endpoint: "post.publish",
      actorId: post.createdBy ?? null,
      success: false,
    });
    throw new ProviderError(
      `Failed to publish post: ${err instanceof Error ? err.message : String(err)}`,
      { postId },
    );
  }
}

// ───────────────────────────────────────────
// ユースケース: deletePost
// ───────────────────────────────────────────

/**
 * 投稿を論理削除する。
 * - draft: status を deleted に変更
 * - published: Provider.deletePost を呼び、成功したら status=deleted
 * - publishing / failed / scheduled: status を deleted に変更
 * - deleted: 冪等に deleted を返す
 */
export async function deletePost(
  deps: PostUsecaseDeps,
  workspaceId: string,
  postId: string,
): Promise<Post> {
  const post = await loadOwnedPost(deps, workspaceId, postId);

  if (post.status === "deleted") {
    return post;
  }

  if (post.status === "published" && post.platformPostId) {
    const account = await loadAccountForWorkspace(deps, workspaceId, post.socialAccountId);
    const provider = getProvider(deps, post.platform);
    const credentials = decryptCredentials(account.credentialsEncrypted, deps.encryptionKey);

    const result = await provider.deletePost({
      accountCredentials: credentials,
      platformPostId: post.platformPostId,
    });

    await recordProviderUsage(deps, {
      workspaceId,
      platform: post.platform,
      endpoint: "post.delete",
      actorId: post.createdBy ?? null,
      success: result.success,
    });

    if (!result.success) {
      throw new ProviderError(
        `Failed to delete post on platform: ${result.error ?? "unknown error"}`,
      );
    }
  }

  return deps.postRepo.update(postId, { status: "deleted" });
}

// ───────────────────────────────────────────
// ユースケース: listPosts
// ───────────────────────────────────────────

/**
 * ワークスペースの投稿一覧を返す。
 * filters: platform, status, 日付範囲 (from/to, created_at 基準), page, limit
 * from/to はリポジトリ側がサポートしていないため、ここでフィルタする（v1 ベストエフォート）。
 */
export async function listPosts(
  deps: PostUsecaseDeps,
  workspaceId: string,
  filters: ListPostsFilters = {},
): Promise<ListPostsResult> {
  const page = filters.page && filters.page > 0 ? filters.page : 1;
  const limit = filters.limit && filters.limit > 0 ? Math.min(filters.limit, 200) : 20;

  // from/to フィルタは JS 層で行うため、全件取得して絞り込む
  const needsDateFilter = !!(filters.from || filters.to);

  if (needsDateFilter) {
    const all = await deps.postRepo.findByWorkspace(workspaceId, {
      platform: filters.platform,
      status: filters.status,
    });

    const filtered = all.filter((p) => {
      if (filters.from && p.createdAt < filters.from) return false;
      if (filters.to && p.createdAt > filters.to) return false;
      return true;
    });

    const total = filtered.length;
    const start = (page - 1) * limit;
    const paged = filtered.slice(start, start + limit);

    return { data: paged, meta: { page, limit, total } };
  }

  // 日付フィルタなし: repository の offset/limit を使う
  // total 取得のため 2 クエリ。v1 は簡素化のため全件取得してカウントする。
  const all = await deps.postRepo.findByWorkspace(workspaceId, {
    platform: filters.platform,
    status: filters.status,
  });
  const total = all.length;
  const start = (page - 1) * limit;
  const paged = all.slice(start, start + limit);

  return { data: paged, meta: { page, limit, total } };
}

// ───────────────────────────────────────────
// ユースケース: getPost
// ───────────────────────────────────────────

export async function getPost(
  deps: PostUsecaseDeps,
  workspaceId: string,
  postId: string,
): Promise<Post> {
  return loadOwnedPost(deps, workspaceId, postId);
}
