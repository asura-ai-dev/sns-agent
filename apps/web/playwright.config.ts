/**
 * Playwright 設定 (Task 6004)
 *
 * Web UI の E2E スモークテスト用の最小設定。
 *
 * 実行方法:
 *   1. API サーバー起動:  `pnpm --filter @sns-agent/api dev`
 *   2. Web サーバー起動:  `pnpm --filter @sns-agent/web dev`
 *   3. テスト実行:        `pnpm --filter @sns-agent/web test:e2e`
 *
 * CI では webServer オプションで自動起動する想定だが、v1 では
 * 手動起動を前提とする（起動コマンドを変えずにスモークを撮るため）。
 */
import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./src/__tests__/e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
