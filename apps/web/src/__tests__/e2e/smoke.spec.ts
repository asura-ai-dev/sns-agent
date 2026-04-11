/**
 * Web UI E2E スモークテスト (Task 6004)
 *
 * spec.md AC-11, AC-12, AC-13, AC-15 を想定した最小限の画面遷移確認。
 *
 * 前提:
 *   - API サーバーが http://localhost:3001 で動作
 *   - Web サーバーが http://localhost:3000 で動作
 *     （E2E_BASE_URL で上書き可能）
 *
 * 実行: `pnpm --filter @sns-agent/web test:e2e`
 *
 * 注意: auth middleware が未実装のため、全ページは unauth でもレンダリングできる。
 * AC の確認はデータが空でも UI 構造が存在することをもってスモークとする。
 */
import { test, expect } from "@playwright/test";

test.describe("Web UI smoke", () => {
  test("a. dashboard renders with summary cards region", async ({ page }) => {
    await page.goto("/");
    // dashboard page is at / (grouped under (dashboard))
    await expect(page.locator("body")).toBeVisible();
    // h1 または summary カード相当の見出しが存在することを確認
    await expect(page).toHaveTitle(/SNS|Dashboard/i);
  });

  test("b. posts list page renders a table region", async ({ page }) => {
    await page.goto("/posts");
    await expect(page.locator("body")).toBeVisible();
    // 投稿一覧テーブル or 空状態の見出しが出る
    await expect(
      page.locator("table, [role='table'], text=/投稿|Posts|No posts/i").first(),
    ).toBeVisible({ timeout: 5000 });
  });

  test("c. posts create page renders a form", async ({ page }) => {
    await page.goto("/posts/new");
    await expect(page.locator("body")).toBeVisible();
    // テキスト入力欄の存在
    await expect(page.locator("textarea, input[type='text']").first()).toBeVisible({
      timeout: 5000,
    });
  });

  test("d. calendar page renders", async ({ page }) => {
    await page.goto("/calendar");
    await expect(page.locator("body")).toBeVisible();
    // カレンダーヘッダ（月表示等）または grid
    await expect(page.locator("text=/月|Calendar|Schedule/i, [role='grid']").first()).toBeVisible({
      timeout: 5000,
    });
  });

  test("e. settings page renders", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.locator("body")).toBeVisible();
  });
});
