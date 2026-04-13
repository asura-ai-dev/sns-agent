/**
 * Scheduler 単発実行エントリポイント
 *
 * 想定用途:
 * - cron から毎分起動する
 * - 運用担当が手動で 1 回だけ流す
 *
 * How:
 * - due jobs を取得
 * - atomic lock
 * - publish 実行
 * - succeeded / retrying / failed を更新
 */
import { POLL_BATCH_SIZE } from "@sns-agent/core";
import { runSchedulerBatch } from "./worker/scheduler.js";

function parseBatchSize(raw: string | undefined): number {
  if (!raw) return POLL_BATCH_SIZE;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("SCHEDULER_BATCH_SIZE must be a positive integer");
  }
  return parsed;
}

async function main(): Promise<void> {
  const batchSize = parseBatchSize(process.env.SCHEDULER_BATCH_SIZE);
  const result = await runSchedulerBatch({
    batchSize,
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
    },
  });

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        processedAt: result.processedAt.toISOString(),
        scanned: result.scanned,
        processed: result.processed,
        skipped: result.skipped,
        succeeded: result.succeeded,
        retrying: result.retrying,
        failed: result.failed,
      },
      null,
      2,
    ),
  );
}

void main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error(
    "[scheduler] single run failed",
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
});
