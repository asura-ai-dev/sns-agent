/**
 * 環境変数スキーマとバリデーション
 * design.md セクション 8（ENCRYPTION_KEY）、チケット 1002 の定義に準拠
 */
import { z } from "zod";

/**
 * 環境変数スキーマ定義
 *
 * - DATABASE_URL: 必須。SQLite (file:./dev.db) or PostgreSQL (postgres://...)
 * - ENCRYPTION_KEY: 本番では必須。開発/テストでは省略可（デフォルト値を使用）
 * - API_PORT: デフォルト 3001
 * - WEB_URL: デフォルト http://localhost:3000
 * - NODE_ENV: development / production / test
 */
export const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  ENCRYPTION_KEY: z
    .string()
    .min(1)
    .optional()
    .refine(
      (val) => {
        // 本番環境では必須
        if (process.env.NODE_ENV === "production" && !val) {
          return false;
        }
        return true;
      },
      { message: "ENCRYPTION_KEY is required in production" },
    ),

  API_PORT: z.coerce.number().int().positive().default(3001),

  WEB_URL: z.string().url().default("http://localhost:3000"),

  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

export type EnvConfig = z.infer<typeof envSchema>;

/** パース済みの設定をキャッシュ */
let _cachedConfig: EnvConfig | null = null;

/**
 * 環境変数をパースし、型安全な設定オブジェクトを返す。
 * 初回呼び出し時にバリデーションを実行し、以降はキャッシュを返す。
 * バリデーション失敗時は ZodError をスローする。
 */
export function getConfig(): EnvConfig {
  if (_cachedConfig) {
    return _cachedConfig;
  }

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Environment variable validation failed:\n${formatted}`);
  }

  _cachedConfig = result.data;
  return _cachedConfig;
}

/**
 * キャッシュをリセットする（テスト用）
 */
export function resetConfigCache(): void {
  _cachedConfig = null;
}
