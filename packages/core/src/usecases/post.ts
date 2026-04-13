/**
 * 投稿管理ユースケース
 *
 * Task 2004: 投稿の作成（下書き保存）、編集、即時公開、削除、一覧のユースケース。
 * design.md セクション 3.1（posts）、4.2（投稿管理）、11（投稿バリデーション）に準拠。
 */
import type { Platform } from "@sns-agent/config";
import { estimateCost } from "@sns-agent/config";
import type { MediaAttachment, Post, ScheduledJob, SocialAccount } from "../domain/entities.js";
import type {
  AccountRepository,
  ApprovalRepository,
  AuditLogRepository,
  BudgetPolicyRepository,
  PostListFilters as RepoPostListFilters,
  PostOrderBy,
  PostRepository,
  ScheduledJobRepository,
  UsageRepository,
} from "../interfaces/repositories.js";
import type { SocialProvider, ValidationResult } from "../interfaces/social-provider.js";
import {
  BudgetExceededError,
  NotFoundError,
  ProviderError,
  ValidationError,
} from "../errors/domain-error.js";
import { decrypt } from "../domain/crypto.js";
import { evaluateBudgetPolicy, type BudgetEvaluation } from "../policies/budget.js";
import { createApprovalRequest, type ApprovalUsecaseDeps } from "./approval.js";

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
  /**
   * 予約ジョブリポジトリ。省略時は listPosts の schedule 情報が埋まらない (後方互換)。
   * Task 2006: 投稿一覧の schedule フィールド生成に使う。
   */
  scheduledJobRepo?: ScheduledJobRepository;
  /**
   * 予算ポリシーリポジトリ。
   * Task 4004: publishPost 実行前に evaluateBudgetPolicy を呼ぶのに使用する。
   * 省略時は予算チェックをスキップ (後方互換)。
   */
  budgetPolicyRepo?: BudgetPolicyRepository;
  /**
   * 承認リポジトリ。予算ポリシーで require-approval になった場合に使う (Task 4004)。
   * 省略時は require-approval を warn と同じ挙動にフォールバック（後方互換）。
   */
  approvalRepo?: ApprovalRepository;
  /**
   * 監査ログリポジトリ。承認リクエスト作成時の記録に使う (Task 4004 / 6002)。
   */
  auditRepo?: AuditLogRepository;
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
  /** 単一プラットフォーム（後方互換） */
  platform?: Platform;
  /** 複数プラットフォーム（OR 条件） */
  platforms?: Platform[];
  /** 単一ステータス（後方互換） */
  status?: Post["status"];
  /** 複数ステータス（OR 条件） */
  statuses?: Array<Post["status"]>;
  /** created_at の下限 */
  from?: Date;
  /** created_at の上限 */
  to?: Date;
  /** contentText の部分一致検索 */
  search?: string;
  /** ソートキー。デフォルト createdAt */
  orderBy?: PostOrderBy;
  /** 1-based ページ番号 */
  page?: number;
  /** 1 ページあたりの件数。デフォルト 20、最大 100 */
  limit?: number;
}

/** 投稿一覧の1要素。schedule / socialAccount を埋めた投稿オブジェクト */
export interface PostListItem extends Post {
  /** JOIN したソーシャルアカウント情報 */
  socialAccount: {
    id: string;
    platform: Platform;
    displayName: string;
  } | null;
  /** 予約ジョブが存在する場合のスケジュール情報 */
  schedule: {
    id: string;
    scheduledAt: Date;
    status: ScheduledJob["status"];
    nextRetryAt: Date | null;
    lastError: string | null;
    lastExecutedAt: Date | null;
  } | null;
}

export interface ListPostsResult {
  data: PostListItem[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

/** 1 ページあたりの最大件数 */
const LIST_POSTS_MAX_LIMIT = 100;
/** 1 ページあたりのデフォルト件数 */
const LIST_POSTS_DEFAULT_LIMIT = 20;

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
 * Task 4004: publishPost の拡張結果型。
 * API ルートはこの型経由で budget warning / require-approval を受け取る。
 */
export interface PublishPostResult {
  post: Post;
  /**
   * 予算ポリシー評価結果。budgetPolicyRepo 未設定または該当ポリシーなしの場合は null。
   * action / allowed / percentage を呼び出し側が参照する。
   */
  budgetEvaluation: BudgetEvaluation | null;
  /**
   * 予算ポリシーが require-approval を返し、承認リクエストが作成された場合の ID。
   * 承認が不要な場合は null。
   */
  approvalRequestId: string | null;
}

/**
 * 予算ポリシーチェック付きで下書きを公開する (Task 4004)。
 *
 * フロー:
 * 1. Post を取得し status が draft であることを確認
 * 2. 予算ポリシーを評価（deps.budgetPolicyRepo 指定時のみ）
 *    - block: BudgetExceededError を投げて公開を中止
 *    - require-approval: 承認リクエストを作成し、Post を scheduled に戻す
 *    - warn: 続行、結果に warning を含める
 * 3. Provider.publishPost を呼び出し（以降は従来フロー）
 */
export async function publishPostChecked(
  deps: PostUsecaseDeps,
  workspaceId: string,
  postId: string,
  options?: { requestedBy?: string | null },
): Promise<PublishPostResult> {
  const post = await loadOwnedPost(deps, workspaceId, postId);

  if (post.status !== "draft") {
    throw new ValidationError(`Only draft posts can be published (current status: ${post.status})`);
  }

  // 1. 予算ポリシー評価
  let evaluation: BudgetEvaluation | null = null;
  if (deps.budgetPolicyRepo && deps.usageRepo) {
    const endpoint = "post.publish";
    const additionalCost = estimateCost(post.platform, endpoint, 1) ?? 0;
    evaluation = await evaluateBudgetPolicy(
      {
        budgetPolicyRepo: deps.budgetPolicyRepo,
        usageRepo: deps.usageRepo,
      },
      {
        workspaceId,
        platform: post.platform,
        endpoint,
        additionalCost,
      },
    );

    // block: 公開中止
    if (!evaluation.allowed && evaluation.action === "block") {
      throw new BudgetExceededError(
        evaluation.reason ?? `Budget exceeded for ${post.platform}/post.publish`,
        {
          policyId: evaluation.matchedPolicy?.id,
          scopeType: evaluation.matchedPolicy?.scopeType,
          consumed: evaluation.consumed,
          limit: evaluation.limit,
          percentage: evaluation.percentage,
        },
      );
    }

    // require-approval: 承認リクエストを作成し、公開は保留
    if (evaluation.action === "require-approval") {
      if (deps.approvalRepo && deps.auditRepo) {
        const approvalDeps: ApprovalUsecaseDeps = {
          approvalRepo: deps.approvalRepo,
          auditRepo: deps.auditRepo,
        };
        const requester = options?.requestedBy ?? post.createdBy ?? "system";
        const approval = await createApprovalRequest(approvalDeps, {
          workspaceId,
          resourceType: "post",
          resourceId: post.id,
          requestedBy: requester,
          reason: evaluation.reason,
        });

        // Post の status を scheduled (承認待ち) に変更
        const updated = await deps.postRepo.update(postId, {
          status: "scheduled",
        });

        return {
          post: updated,
          budgetEvaluation: evaluation,
          approvalRequestId: approval.id,
        };
      }
      // approvalRepo 未設定: BudgetExceededError で通知
      throw new BudgetExceededError(
        `Budget requires approval but approval repo is not configured: ${evaluation.reason}`,
        {
          policyId: evaluation.matchedPolicy?.id,
          consumed: evaluation.consumed,
          limit: evaluation.limit,
          percentage: evaluation.percentage,
        },
      );
    }
    // warn は続行
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
    return {
      post: published,
      budgetEvaluation: evaluation,
      approvalRequestId: null,
    };
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

/**
 * 後方互換用の薄いラッパー。
 * Task 2004 からの既存呼び出し (CLI / 承認フロー / createPost publishNow) は Post 単体を期待するため、
 * publishPostChecked の結果から post のみを取り出して返す。
 *
 * 予算ポリシーが block / require-approval の場合は publishPostChecked が例外または
 * approvalRequestId を返すため、ここで直接呼ぶ API ルートは publishPostChecked を使うこと。
 */
export async function publishPost(
  deps: PostUsecaseDeps,
  workspaceId: string,
  postId: string,
): Promise<Post> {
  const result = await publishPostChecked(deps, workspaceId, postId);
  return result.post;
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
 * リポジトリへ渡す共通フィルタを構築する。
 */
function buildRepoFilters(filters: ListPostsFilters): RepoPostListFilters {
  return {
    platform: filters.platform,
    platforms: filters.platforms,
    status: filters.status,
    statuses: filters.statuses,
    from: filters.from,
    to: filters.to,
    search: filters.search,
    orderBy: filters.orderBy,
  };
}

/**
 * ワークスペースの投稿一覧を返す。
 *
 * 機能:
 * - platform / status は複数指定可（platforms / statuses を優先）
 * - from / to で created_at の範囲検索
 * - search で contentText の部分一致検索
 * - orderBy: createdAt / publishedAt / scheduledAt
 * - ページネーション: page (1-based) + limit (default 20, max 100)
 * - total count と totalPages を meta に返す
 * - 各 Post に socialAccount / schedule を付与して返す
 *
 * deps.scheduledJobRepo が省略された場合、schedule フィールドは常に null。
 */
export async function listPosts(
  deps: PostUsecaseDeps,
  workspaceId: string,
  filters: ListPostsFilters = {},
): Promise<ListPostsResult> {
  const page = filters.page && filters.page > 0 ? filters.page : 1;
  const rawLimit = filters.limit && filters.limit > 0 ? filters.limit : LIST_POSTS_DEFAULT_LIMIT;
  const limit = Math.min(rawLimit, LIST_POSTS_MAX_LIMIT);
  const offset = (page - 1) * limit;

  const repoFilters = buildRepoFilters(filters);

  // 1. 件数取得 + ページデータ取得を並列発火
  const [total, pagePosts] = await Promise.all([
    deps.postRepo.countByWorkspace(workspaceId, repoFilters),
    deps.postRepo.findByWorkspace(workspaceId, {
      ...repoFilters,
      limit,
      offset,
    }),
  ]);

  // 2. JOIN 対象の ID 集合を収集
  const accountIds = Array.from(new Set(pagePosts.map((p) => p.socialAccountId)));
  const postIds = pagePosts.map((p) => p.id);

  // 3. socialAccount の一括取得 (Repository に findByIds がないため個別取得)
  const accountMap = new Map<string, SocialAccount>();
  await Promise.all(
    accountIds.map(async (id) => {
      const acc = await deps.accountRepo.findById(id);
      if (acc && acc.workspaceId === workspaceId) {
        accountMap.set(id, acc);
      }
    }),
  );

  // 4. scheduled_jobs の一括取得 (scheduled_at 降順で返る想定)
  const scheduleByPost = new Map<
    string,
    {
      id: string;
      scheduledAt: Date;
      status: ScheduledJob["status"];
      nextRetryAt: Date | null;
      lastError: string | null;
      lastExecutedAt: Date | null;
    }
  >();
  if (deps.scheduledJobRepo && postIds.length > 0) {
    const jobs = await deps.scheduledJobRepo.findByPostIds(postIds);
    // scheduled_at 降順の先頭 = 最新ジョブを採用する
    for (const job of jobs) {
      if (!scheduleByPost.has(job.postId)) {
        scheduleByPost.set(job.postId, {
          id: job.id,
          scheduledAt: job.scheduledAt,
          status: job.status,
          nextRetryAt: job.nextRetryAt,
          lastError: job.lastError,
          lastExecutedAt: job.completedAt ?? job.startedAt ?? null,
        });
      }
    }
  }

  // 5. 各 Post を PostListItem に変換
  const data: PostListItem[] = pagePosts.map((post) => {
    const account = accountMap.get(post.socialAccountId) ?? null;
    return {
      ...post,
      socialAccount: account
        ? {
            id: account.id,
            platform: account.platform,
            displayName: account.displayName,
          }
        : null,
      schedule: scheduleByPost.get(post.id) ?? null,
    };
  });

  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

  return {
    data,
    meta: { page, limit, total, totalPages },
  };
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
