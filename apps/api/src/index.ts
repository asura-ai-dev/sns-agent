/**
 * API サーバーエントリポイント
 *
 * @hono/node-server の serve() で起動する。
 * ポートは環境変数 API_PORT（デフォルト 3001）を使用。
 * design.md セクション 1.4（Node.js サーバー）に準拠。
 */
import { serve } from "@hono/node-server";
import { app } from "./app.js";

const port = Number(process.env.API_PORT) || 3001;

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`SNS Agent API server running on http://localhost:${info.port}`);
});

export { app };
