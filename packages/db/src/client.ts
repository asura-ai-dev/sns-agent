/**
 * DB 接続ファクトリ
 *
 * DATABASE_URL のプレフィックスに応じて SQLite / PostgreSQL ドライバを切り替える。
 * - `file:` → better-sqlite3
 * - `postgres://` → postgres ドライバ (将来対応、現在は未実装)
 *
 * design.md セクション 1.1 に準拠。
 */
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import * as schema from "./schema/index.js";

import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

export type DbClient = BetterSQLite3Database<typeof schema>;

let _db: DbClient | null = null;

/**
 * DB 接続を取得する。
 * 初回呼び出し時に接続を初期化し、以降はキャッシュを返す。
 *
 * @param databaseUrl - DATABASE_URL。省略時は環境変数から取得。
 */
export function getDb(databaseUrl?: string): DbClient {
  if (_db) {
    return _db;
  }

  const url = databaseUrl ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }

  if (url.startsWith("file:")) {
    const filePath = url.replace(/^file:/, "");
    const sqlite = new Database(filePath);
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    _db = drizzle(sqlite, { schema });
    return _db;
  }

  if (url.startsWith("postgres://") || url.startsWith("postgresql://")) {
    // PostgreSQL ドライバは Phase 2 以降で追加予定
    // drizzle-orm/node-postgres を依存に追加し、ここで分岐する
    throw new Error("PostgreSQL driver is not yet implemented. Use file: URL for SQLite.");
  }

  throw new Error(`Unsupported DATABASE_URL scheme: ${url}. Expected "file:" or "postgres://"`);
}

/**
 * DB 接続をリセットする（テスト用）
 */
export function resetDb(): void {
  _db = null;
}
