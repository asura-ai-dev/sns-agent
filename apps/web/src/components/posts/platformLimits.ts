/**
 * Task 3006: プラットフォーム別の投稿制約定義。
 *
 * 実際のバリデーションは API 側の `provider.validatePost` が正本。
 * 本ファイルはクライアントサイドの即時フィードバック用（カウンター表示・
 * 警告）に使う軽量ミラーである。design.md セクション 11.1 を参照。
 */

import type { Platform } from "@/components/settings/PlatformIcon";

export interface PlatformLimit {
  label: string;
  textLimit: number;
  /** X は Basic/Premium で異なるが、警告閾値は Basic に合わせる */
  textLimitNote?: string;
  mediaNote: string;
}

export const PLATFORM_LIMITS: Record<Platform, PlatformLimit> = {
  x: {
    label: "X",
    textLimit: 280,
    textLimitNote: "Basic 280 文字 / Premium 25,000 文字",
    mediaNote: "画像 最大 4 枚 (5MB) / 動画 1 本 (512MB)",
  },
  line: {
    label: "LINE",
    textLimit: 5000,
    mediaNote: "リッチメッセージ・動画メッセージ対応",
  },
  instagram: {
    label: "Instagram",
    textLimit: 2200,
    mediaNote: "画像必須 (フィード, 最大 10 枚) / リール対応",
  },
};

/** 文字数の区分（UI 色分け用） */
export type CounterZone = "safe" | "caution" | "danger" | "over";

export function getCounterZone(length: number, limit: number): CounterZone {
  if (length > limit) return "over";
  const ratio = length / limit;
  if (ratio >= 0.95) return "danger";
  if (ratio >= 0.8) return "caution";
  return "safe";
}
