/**
 * Instagram プロバイダの capability 定義
 *
 * Task 4002 の仕様:
 * - textPost: false     // Instagram はテキストのみ投稿不可 (フィード投稿は画像必須)
 * - imagePost: true
 * - videoPost: true     // リール
 * - threadPost: false
 * - directMessage: true
 * - commentReply: true
 * - broadcast: false
 * - nativeSchedule: false
 * - usageApi: false
 */
import type { ProviderCapabilities } from "@sns-agent/core";

export const INSTAGRAM_CAPABILITIES: ProviderCapabilities = {
  textPost: false,
  imagePost: true,
  videoPost: true,
  threadPost: false,
  directMessage: true,
  commentReply: true,
  broadcast: false,
  nativeSchedule: false,
  usageApi: false,
};

// ───────────────────────────────────────────
// 投稿制約 (design.md セクション 11.1)
// ───────────────────────────────────────────

/** Instagram のテキスト (キャプション) 上限 */
export const INSTAGRAM_TEXT_LIMIT = 2200;
/** フィード投稿の画像最大枚数 (カルーセル) */
export const INSTAGRAM_MAX_IMAGES = 10;
/** リール動画の最大本数 (単一メディア投稿として) */
export const INSTAGRAM_MAX_VIDEOS = 1;
