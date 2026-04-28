/**
 * vitest 設定（apps/api 統合テスト）
 *
 * Task 6004: API サーバーの統合テスト用。各スイートごとに SQLite DB を
 * 初期化するため、並列ファイル実行を無効化する（file-level 直列）。
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/__tests__/**/*.test.ts", "src/routes/__tests__/**/*.test.ts"],
    // 統合テストは DB 共有を避けるため直列実行
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
