/**
 * API アプリケーション共通型定義
 *
 * Hono の Variables 型を定義する。
 * ルートファイルからインポートして型安全にコンテキストを参照する。
 */
import type { Actor, UsageRepository } from "@sns-agent/core";
import type { DbClient } from "@sns-agent/db";

/**
 * Hono の Variables 型定義。
 * c.set / c.get で型安全にアクセスする。
 */
export type AppVariables = {
  requestId: string;
  db: DbClient;
  actor: Actor;
  /** X-Idempotency-Key ヘッダ値（idempotency ミドルウェアがセット） */
  idempotencyKey?: string;
  /** Task 4003: 使用量記録ミドルウェアがセット */
  usageRepo?: UsageRepository;
};
