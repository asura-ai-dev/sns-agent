/**
 * vitest 設定（apps/api 統合テスト）
 *
 * Task 6004: API サーバーの統合テスト用。各スイートごとに SQLite DB を
 * 初期化するため、並列ファイル実行を無効化する（file-level 直列）。
 */
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@sns-agent/core": fileURLToPath(
        new URL("../../packages/core/src/index.ts", import.meta.url),
      ),
      "@sns-agent/db": fileURLToPath(new URL("../../packages/db/src/index.ts", import.meta.url)),
    },
  },
  test: {
    include: ["src/__tests__/**/*.test.ts", "src/routes/__tests__/**/*.test.ts"],
    // 統合テストは DB 共有を避けるため直列実行
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
