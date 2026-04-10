/**
 * LINE credentials (JSON) の共通パーサ
 *
 * usecase 層が復号した credentials 文字列を各操作 (post / inbox / webhook) に渡す。
 * すべての操作で同じスキーマを共有したいので、このファイルに集約する。
 */
import { ProviderError } from "@sns-agent/core";

export type LinePublishMode = "push" | "multicast" | "broadcast";

export interface LineAccessCredentials {
  /** Channel Access Token (Bearer) */
  accessToken: string;
  /** credentials レベルのデフォルト送信モード */
  defaultMode?: LinePublishMode;
  /** push のデフォルト宛先 userId */
  defaultTargetId?: string;
  /** multicast のデフォルト宛先 userId[] */
  defaultTargetIds?: string[];
  /**
   * Webhook 署名検証用 Channel Secret。
   * v1 では credentials に含める運用 (provider options 経由でも渡せる)。
   */
  channelSecret?: string;
}

export function parseLineCredentials(raw: string): LineAccessCredentials {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    if (typeof obj.accessToken !== "string" || obj.accessToken.length === 0) {
      throw new Error("accessToken missing");
    }
    const creds: LineAccessCredentials = { accessToken: obj.accessToken };
    if (typeof obj.defaultMode === "string") {
      creds.defaultMode = obj.defaultMode as LinePublishMode;
    }
    if (typeof obj.defaultTargetId === "string") {
      creds.defaultTargetId = obj.defaultTargetId;
    }
    if (Array.isArray(obj.defaultTargetIds)) {
      creds.defaultTargetIds = obj.defaultTargetIds.filter(
        (x): x is string => typeof x === "string",
      );
    }
    if (typeof obj.channelSecret === "string") {
      creds.channelSecret = obj.channelSecret;
    }
    return creds;
  } catch (err) {
    throw new ProviderError(`Invalid LINE credentials: ${(err as Error).message}`, {
      cause: String(err),
    });
  }
}
