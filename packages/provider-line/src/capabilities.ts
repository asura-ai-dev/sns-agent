/**
 * LINE プロバイダの capability 定義
 *
 * Task 4001 の仕様:
 * - textPost: true
 * - imagePost: true
 * - videoPost: true
 * - threadPost: false
 * - directMessage: true
 * - commentReply: false
 * - broadcast: true
 * - nativeSchedule: false
 * - usageApi: false
 *
 * design.md セクション 11.1 (LINE 投稿制約):
 * - テキスト 5,000 文字
 * - リッチメッセージ (Flex Message) 対応 (v1 では拡張ポイントのみ)
 * - 動画メッセージ対応
 */
import type { ProviderCapabilities } from "@sns-agent/core";

export const LINE_CAPABILITIES: ProviderCapabilities = {
  textPost: true,
  imagePost: true,
  videoPost: true,
  threadPost: false,
  directMessage: true,
  commentReply: false,
  broadcast: true,
  nativeSchedule: false,
  usageApi: false,
};

// ───────────────────────────────────────────
// 投稿制約 (design.md セクション 11.1)
// ───────────────────────────────────────────

/** LINE のテキスト上限 (text message 1 通あたり 5,000 文字) */
export const LINE_TEXT_LIMIT = 5000;

/**
 * 1 回の push/broadcast リクエストで送れる message オブジェクトの最大数。
 * LINE Messaging API 仕様: 最大 5 件。
 */
export const LINE_MAX_MESSAGES_PER_REQUEST = 5;

/** 画像メッセージ 1 枚あたりの最大サイズ (10MB) */
export const LINE_MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** 動画メッセージ 1 本あたりの最大サイズ (200MB) */
export const LINE_MAX_VIDEO_BYTES = 200 * 1024 * 1024;
