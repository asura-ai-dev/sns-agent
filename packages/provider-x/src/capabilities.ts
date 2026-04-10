/**
 * X (Twitter) プロバイダの capability 定義
 *
 * Task 2003 の仕様:
 * - textPost: true
 * - imagePost: true
 * - videoPost: true
 * - threadPost: false   // v1 ではスレッド非対応
 * - directMessage: true
 * - commentReply: true
 * - broadcast: false
 * - nativeSchedule: false // X API v2 にネイティブ予約なし
 * - usageApi: false
 */
import type { ProviderCapabilities } from "@sns-agent/core";

export const X_CAPABILITIES: ProviderCapabilities = {
  textPost: true,
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

/** X のテキスト上限 (Basic プラン) */
export const X_TEXT_LIMIT_BASIC = 280;
/** X のテキスト上限 (Premium プラン) */
export const X_TEXT_LIMIT_PREMIUM = 25000;
/** 画像の最大枚数 */
export const X_MAX_IMAGES = 4;
/** 画像 1 枚あたりの最大サイズ (5MB) */
export const X_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** 動画の最大本数 */
export const X_MAX_VIDEOS = 1;
/** 動画 1 本あたりの最大サイズ (512MB) */
export const X_MAX_VIDEO_BYTES = 512 * 1024 * 1024;
