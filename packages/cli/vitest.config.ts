/**
 * vitest 設定（packages/cli 統合テスト）
 *
 * Task 6004: CLI commands の統合テスト。モック HTTP サーバーに対して
 * 実際の SDK 経由で呼び出す。
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/__tests__/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
