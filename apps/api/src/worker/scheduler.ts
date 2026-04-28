/**
 * 予約投稿 Polling ワーカー
 *
 * Task 2005: DB ベース queue を 10 秒間隔で polling し、executeJob を呼び出す。
 * design.md セクション 1.3（Queue / Scheduler）に準拠。
 *
 * 条件:
 * - status = 'pending' AND scheduled_at <= now
 * - status = 'retrying' AND next_retry_at <= now
 * - status = 'locked' AND locked_at <= (now - 5 分)（デッドロック回復）
 *
 * 起動は apps/api/src/index.ts で ENABLE_SCHEDULER=true の時のみ行う。
 */
import {
  captureFollowerSnapshotsForWorkspace,
  dispatchDueJobs,
  POLL_BATCH_SIZE,
  processEngagementGateReplies,
} from "@sns-agent/core";
import type {
  EngagementGateUsecaseDeps,
  FollowerAnalyticsUsecaseDeps,
  ScheduleUsecaseDeps,
} from "@sns-agent/core";
import {
  DrizzleAuditLogRepository,
  DrizzleEngagementGateDeliveryRepository,
  DrizzleEngagementGateRepository,
  DrizzleScheduledJobRepository,
  DrizzlePostRepository,
  DrizzleAccountRepository,
  DrizzleFollowerRepository,
  DrizzleFollowerSnapshotRepository,
  getDb,
} from "@sns-agent/db";
import type { DbClient } from "@sns-agent/db";
import { getProviderRegistry } from "../providers.js";

/** デフォルト polling 間隔 (ms) */
export const DEFAULT_POLL_INTERVAL_MS = 10_000;

export interface SchedulerWorkerOptions {
  /** polling 間隔（ms）。テスト時に短縮する */
  pollIntervalMs?: number;
  /** 1 回の polling で取り出すジョブ数上限 */
  batchSize?: number;
  /** DB インスタンス。未指定時は getDb() */
  db?: DbClient;
  /** ログ出力関数。未指定時は console */
  logger?: {
    info: (msg: string, meta?: unknown) => void;
    warn: (msg: string, meta?: unknown) => void;
    error: (msg: string, meta?: unknown) => void;
  };
}

export interface SchedulerWorker {
  /** ワーカーを開始する */
  start(): void;
  /** ワーカーを停止する（進行中の 1 バッチは完了まで待つ） */
  stop(): Promise<void>;
  /** 即時に 1 バッチを実行する（テスト用） */
  tick(): Promise<void>;
  /** 実行中かどうか */
  isRunning(): boolean;
}

function buildScheduleDeps(db: DbClient): ScheduleUsecaseDeps {
  const encryptionKey =
    process.env.ENCRYPTION_KEY ||
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  const scheduledJobRepo = new DrizzleScheduledJobRepository(db);
  const postRepo = new DrizzlePostRepository(db);
  const accountRepo = new DrizzleAccountRepository(db);
  const providers = getProviderRegistry().getAll();

  return {
    scheduledJobRepo,
    postRepo,
    auditRepo: new DrizzleAuditLogRepository(db),
    postUsecaseDeps: {
      postRepo,
      accountRepo,
      providers,
      encryptionKey,
    },
  };
}

function buildEngagementGateDeps(db: DbClient): EngagementGateUsecaseDeps {
  const encryptionKey =
    process.env.ENCRYPTION_KEY ||
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  return {
    accountRepo: new DrizzleAccountRepository(db),
    gateRepo: new DrizzleEngagementGateRepository(db),
    deliveryRepo: new DrizzleEngagementGateDeliveryRepository(db),
    providers: getProviderRegistry().getAll(),
    encryptionKey,
  };
}

function buildFollowerAnalyticsDeps(db: DbClient): FollowerAnalyticsUsecaseDeps {
  return {
    accountRepo: new DrizzleAccountRepository(db),
    followerRepo: new DrizzleFollowerRepository(db),
    snapshotRepo: new DrizzleFollowerSnapshotRepository(db),
  };
}

/**
 * Polling スケジューラワーカーを作成する。
 *
 * 使用例:
 *   const worker = createSchedulerWorker();
 *   worker.start();
 *   // shutdown 時
 *   await worker.stop();
 */
export function createSchedulerWorker(options: SchedulerWorkerOptions = {}): SchedulerWorker {
  const pollInterval = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const batchSize = options.batchSize ?? POLL_BATCH_SIZE;
  const logger = options.logger ?? {
    // eslint-disable-next-line no-console
    info: (msg, meta) => console.log(`[scheduler] ${msg}`, meta ?? ""),
    // eslint-disable-next-line no-console
    warn: (msg, meta) => console.warn(`[scheduler] ${msg}`, meta ?? ""),
    // eslint-disable-next-line no-console
    error: (msg, meta) => console.error(`[scheduler] ${msg}`, meta ?? ""),
  };

  let timer: NodeJS.Timeout | null = null;
  let running = false;
  let tickInFlight: Promise<void> | null = null;

  const db = options.db ?? getDb();
  const deps = buildScheduleDeps(db);
  const engagementGateDeps = buildEngagementGateDeps(db);
  const followerAnalyticsDeps = buildFollowerAnalyticsDeps(db);

  async function runBatch(): Promise<void> {
    const result = await dispatchDueJobs(deps, { limit: batchSize });
    const gateResult = await processEngagementGateReplies(engagementGateDeps, { limit: batchSize });
    const snapshotWorkspaceId = process.env.FOLLOWER_SNAPSHOT_WORKSPACE_ID;
    if (snapshotWorkspaceId) {
      const snapshotResult = await captureFollowerSnapshotsForWorkspace(followerAnalyticsDeps, {
        workspaceId: snapshotWorkspaceId,
      });
      if (snapshotResult.captured > 0) {
        logger.info(`captured follower snapshots`, snapshotResult);
      }
    }
    if (gateResult.gatesScanned > 0) {
      logger.info(`processed engagement gate replies`, gateResult);
    }
    if (result.scanned === 0) return;

    logger.info(`processed ${result.processed}/${result.scanned} due job(s)`, {
      succeeded: result.succeeded,
      retrying: result.retrying,
      failed: result.failed,
      skipped: result.skipped,
    });

    for (const job of result.jobs) {
      if (job.afterStatus === "skipped") {
        logger.warn(`job ${job.id} skipped`, {
          previousStatus: job.beforeStatus,
          recoveredStaleLock: job.recoveredStaleLock,
        });
        continue;
      }
      if (job.afterStatus === "retrying") {
        logger.warn(`job ${job.id} failed, will retry`, {
          error: job.error,
          recoveredStaleLock: job.recoveredStaleLock,
        });
        continue;
      }
      if (job.afterStatus === "failed") {
        logger.error(`job ${job.id} permanently failed`, {
          error: job.error,
          recoveredStaleLock: job.recoveredStaleLock,
        });
        continue;
      }
      logger.info(`job ${job.id} succeeded`, {
        recoveredStaleLock: job.recoveredStaleLock,
      });
    }
  }

  async function runTick(): Promise<void> {
    try {
      await runBatch();
    } catch (err) {
      logger.error("poll tick failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  function scheduleNext(): void {
    if (!running) return;
    timer = setTimeout(async () => {
      tickInFlight = runTick();
      await tickInFlight;
      tickInFlight = null;
      scheduleNext();
    }, pollInterval);
    // Node.js: タイマーがプロセスを保持しないようにする（テストで stop 忘れ防止）
    if (timer && typeof timer.unref === "function") {
      timer.unref();
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      logger.info(`starting (interval=${pollInterval}ms, batchSize=${batchSize})`);
      scheduleNext();
    },
    async stop() {
      running = false;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (tickInFlight) {
        await tickInFlight.catch(() => {
          /* noop - logged in runTick */
        });
      }
      logger.info("stopped");
    },
    async tick() {
      await runTick();
    },
    isRunning() {
      return running;
    },
  };
}

export async function runSchedulerBatch(
  options: SchedulerWorkerOptions = {},
): Promise<Awaited<ReturnType<typeof dispatchDueJobs>>> {
  const logger = options.logger ?? {
    // eslint-disable-next-line no-console
    info: (msg, meta) => console.log(`[scheduler] ${msg}`, meta ?? ""),
    // eslint-disable-next-line no-console
    warn: (msg, meta) => console.warn(`[scheduler] ${msg}`, meta ?? ""),
    // eslint-disable-next-line no-console
    error: (msg, meta) => console.error(`[scheduler] ${msg}`, meta ?? ""),
  };

  const db = options.db ?? getDb();
  const deps = buildScheduleDeps(db);
  const engagementGateDeps = buildEngagementGateDeps(db);
  const followerAnalyticsDeps = buildFollowerAnalyticsDeps(db);
  const batchSize = options.batchSize ?? POLL_BATCH_SIZE;
  const result = await dispatchDueJobs(deps, { limit: batchSize });
  const gateResult = await processEngagementGateReplies(engagementGateDeps, { limit: batchSize });
  const snapshotWorkspaceId = process.env.FOLLOWER_SNAPSHOT_WORKSPACE_ID;
  const snapshotResult = snapshotWorkspaceId
    ? await captureFollowerSnapshotsForWorkspace(followerAnalyticsDeps, {
        workspaceId: snapshotWorkspaceId,
      })
    : null;

  logger.info(`single run complete`, {
    scanned: result.scanned,
    processed: result.processed,
    succeeded: result.succeeded,
    retrying: result.retrying,
    failed: result.failed,
    skipped: result.skipped,
    engagementGates: gateResult,
    followerSnapshots: snapshotResult,
  });

  return result;
}

export async function runEngagementGateBatch(
  options: SchedulerWorkerOptions = {},
): Promise<Awaited<ReturnType<typeof processEngagementGateReplies>>> {
  const logger = options.logger ?? {
    // eslint-disable-next-line no-console
    info: (msg, meta) => console.log(`[scheduler] ${msg}`, meta ?? ""),
    // eslint-disable-next-line no-console
    warn: (msg, meta) => console.warn(`[scheduler] ${msg}`, meta ?? ""),
    // eslint-disable-next-line no-console
    error: (msg, meta) => console.error(`[scheduler] ${msg}`, meta ?? ""),
  };
  const db = options.db ?? getDb();
  const batchSize = options.batchSize ?? POLL_BATCH_SIZE;
  const result = await processEngagementGateReplies(buildEngagementGateDeps(db), {
    limit: batchSize,
  });

  logger.info(`single engagement gate run complete`, result);
  return result;
}
