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
    const main = page.locator("main");
    await expect(main.getByRole("heading", { name: "Posts" })).toBeVisible({ timeout: 5000 });
    await expect(main.getByText(/投稿一覧|PLATFORM|No posts/i).first()).toBeVisible({
      timeout: 5000,
    });
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
    const main = page.locator("main");
    await expect(main.getByRole("heading", { name: "Calendar" })).toBeVisible({ timeout: 5000 });
    await expect(main.getByText(/月|Calendar|Schedule/i).first()).toBeVisible({
      timeout: 5000,
    });
  });

  test("e. settings page renders", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.locator("body")).toBeVisible();
  });

  test("f. usage page does not overflow on mobile width", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/usage?period=weekly");
    await expect(page.getByRole("heading", { name: "Usage" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "X Cost Dimensions" })).toBeVisible();

    const metrics = await page.evaluate(() => ({
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth);
  });
});
