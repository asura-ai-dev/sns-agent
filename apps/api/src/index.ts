/**
 * API サーバーエントリポイント
 *
 * @hono/node-server の serve() で起動する。
 * ポートは環境変数 API_PORT（デフォルト 3001）を使用。
 * design.md セクション 1.4（Node.js サーバー）に準拠。
 *
 * ENABLE_SCHEDULER=true の場合は予約投稿の polling ワーカーも同時に起動する。
 */
import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { createSchedulerWorker } from "./worker/scheduler.js";
import type { SchedulerWorker } from "./worker/scheduler.js";

const port = Number(process.env.API_PORT) || 3001;

serve({ fetch: app.fetch, port }, (info) => {
  // eslint-disable-next-line no-console
  console.log(`SNS Agent API server running on http://localhost:${info.port}`);
});

// 予約投稿ワーカー起動
let schedulerWorker: SchedulerWorker | null = null;
if (process.env.ENABLE_SCHEDULER === "true") {
  schedulerWorker = createSchedulerWorker();
  schedulerWorker.start();

  // graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    // eslint-disable-next-line no-console
    console.log(`[scheduler] received ${signal}, shutting down...`);
    if (schedulerWorker) {
      await schedulerWorker.stop();
    }
    process.exit(0);
  };
  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

export { app };
