/**
 * 使用量自動記録ミドルウェア (Task 4003)
 *
 * Provider 呼び出しの使用量記録は **ユースケース層** (packages/core/src/usecases/*.ts)
 * で行う方針 (design.md セクション 4.4 の方針に沿う)。理由:
 * - HTTP レイヤでは Provider 呼び出しの成否・エンドポイント種別が分かりにくい
 * - CLI / SDK / Webhook 経由でも同じユースケースを通すため、ユースケース層に置けば
 *   1 箇所で網羅できる
 *
 * このミドルウェアは補助的な役割として以下を提供する:
 * - context に UsageRepository を注入し、各ルートハンドラがユースケース依存注入に
 *   使えるようにする
 * - 将来 HTTP 層でフォールバック的な使用量記録を行う拡張ポイント
 *
 * 本ミドルウェアを経由するルートでは `c.get("usageRepo")` でアクセスできる。
 */
import type { MiddlewareHandler } from "hono";
import { DrizzleUsageRepository } from "@sns-agent/db";
import type { UsageRepository } from "@sns-agent/core";
import type { AppVariables } from "../types.js";

/**
 * DB context から UsageRepository を生成し context にセットする。
 *
 * 注: authMiddleware / db 注入ミドルウェアの後段で適用すること。
 */
export const usageRecorderMiddleware: MiddlewareHandler<{ Variables: AppVariables }> = async (
  c,
  next,
) => {
  const db = c.get("db");
  if (db) {
    const repo: UsageRepository = new DrizzleUsageRepository(db);
    c.set("usageRepo", repo);
  }
  await next();
};
