/**
 * LINE 投稿操作
 *
 * LINE Messaging API における「投稿」は、フィード型ではなく以下の形を取る:
 * - push message   : 特定ユーザー (userId) に 1 対 1 で送信
 * - multicast      : 複数 userId にまとめて送信
 * - broadcast      : 全友だちに一斉送信 (承認フローと連携する前提)
 *
 * v1 では以下をサポートする:
 * - validatePost : テキスト 5,000 文字チェック + メッセージ点数チェック
 * - publishPost  : push / multicast / broadcast を extraParams.mode で切替
 * - deletePost   : LINE は送信済みメッセージの削除に非対応 -> ProviderError
 *
 * リッチメッセージ (Flex Message) は v1 では未使用だが、message オブジェクトを
 * そのまま渡せる拡張ポイント (extraParams.messages) を用意する。
 *
 * design.md セクション 11.1 (LINE 5,000 文字), Task 4001 の仕様に準拠。
 */
import type {
  ValidatePostInput,
  ValidationResult,
  ValidationIssue,
  PublishPostInput,
  PublishResult,
  DeletePostInput,
  DeleteResult,
  MediaAttachment,
} from "@sns-agent/core";
import { ProviderError } from "@sns-agent/core";
import { LineApiClient } from "./http-client.js";
import { LINE_TEXT_LIMIT, LINE_MAX_MESSAGES_PER_REQUEST } from "./capabilities.js";
import { parseLineCredentials, type LinePublishMode } from "./credentials.js";

export type { LinePublishMode } from "./credentials.js";

// ───────────────────────────────────────────
// validatePost
// ───────────────────────────────────────────

/**
 * LINE の投稿バリデーション
 *
 * チェック項目:
 * - テキストまたは media が最低 1 つ存在する
 * - テキスト長が 5,000 文字以内 (コードポイント単位)
 * - 1 リクエストに換算したメッセージ点数が 5 以下
 *   (text 1 + media N を個別 message として送る前提)
 */
export function validatePost(input: ValidatePostInput): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  const text = input.contentText ?? "";
  const media = input.contentMedia ?? [];

  if (text.length === 0 && media.length === 0) {
    errors.push({
      field: "content",
      message: "Post must contain text or media",
    });
  }

  const textLength = Array.from(text).length;
  if (textLength > LINE_TEXT_LIMIT) {
    errors.push({
      field: "contentText",
      message: `Text exceeds the ${LINE_TEXT_LIMIT}-character limit (current: ${textLength})`,
      constraint: { limit: LINE_TEXT_LIMIT, current: textLength },
    });
  }

  // LINE の 1 リクエストあたり最大メッセージ数 (5) チェック。
  // text があれば +1 + 各 media 1 件で換算。
  const messageCount = (text.length > 0 ? 1 : 0) + media.length;
  if (messageCount > LINE_MAX_MESSAGES_PER_REQUEST) {
    errors.push({
      field: "contentMedia",
      message: `LINE allows at most ${LINE_MAX_MESSAGES_PER_REQUEST} messages per request (got ${messageCount})`,
      constraint: { maxMessages: LINE_MAX_MESSAGES_PER_REQUEST, current: messageCount },
    });
  }

  // 未知のメディア種別は警告
  for (const m of media) {
    if (m.type !== "image" && m.type !== "video") {
      warnings.push({
        field: "contentMedia",
        message: `Unsupported media type for LINE: ${m.type}`,
      });
    }
    if (!m.url || m.url.length === 0) {
      errors.push({
        field: "contentMedia",
        message: "LINE media requires a public https URL",
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ───────────────────────────────────────────
// publishPost
// ───────────────────────────────────────────

/**
 * PublishPostInput を LINE Messaging API 用の message オブジェクト配列に変換する。
 * 拡張: Flex Message を生で渡したい場合は input.contentMedia に
 *   `{ type: "other", url: "", mime: "application/json", meta: { flex: ... } }` を使う想定。
 */
export function buildLineMessages(input: {
  contentText: string | null;
  contentMedia: MediaAttachment[] | null;
}): unknown[] {
  const messages: unknown[] = [];
  if (input.contentText && input.contentText.length > 0) {
    messages.push({ type: "text", text: input.contentText });
  }
  const media = input.contentMedia ?? [];
  for (const m of media) {
    if (m.type === "image") {
      messages.push({
        type: "image",
        originalContentUrl: m.url,
        previewImageUrl: m.url,
      });
    } else if (m.type === "video") {
      messages.push({
        type: "video",
        originalContentUrl: m.url,
        // preview は画像 URL が必要。なければ同じ URL を fallback
        previewImageUrl: m.url,
      });
    }
  }
  return messages;
}

/** publishPost で使う追加パラメータ (非標準フィールド経由で受け渡し) */
export interface LinePublishExtras {
  mode?: LinePublishMode;
  /** push モードの宛先 userId */
  targetId?: string;
  /** multicast モードの宛先 userId 配列 */
  targetIds?: string[];
  /** notificationDisabled などのオプション */
  notificationDisabled?: boolean;
  /** 事前に組み立てた message オブジェクト (Flex 等の拡張用) */
  messages?: unknown[];
}

/**
 * PublishPostInput から拡張フィールドを抽出する。
 *
 * core の PublishPostInput は platform 非依存なので、LINE 固有の
 * 宛先情報は以下のいずれかで渡す運用とする:
 *
 * 1. (input as any).extra に LinePublishExtras を格納
 * 2. credentials に defaultTargetId / defaultTargetIds を含めておく
 */
function extractExtras(input: PublishPostInput): LinePublishExtras {
  const anyInput = input as unknown as { extra?: unknown };
  if (anyInput.extra && typeof anyInput.extra === "object") {
    return anyInput.extra as LinePublishExtras;
  }
  return {};
}

export async function publishPost(
  input: PublishPostInput,
  httpClient: LineApiClient,
): Promise<PublishResult> {
  const creds = parseLineCredentials(input.accountCredentials);
  const extras = extractExtras(input);

  const mode: LinePublishMode =
    extras.mode ?? creds.defaultMode ?? (extras.targetIds ? "multicast" : "push");

  const messages =
    extras.messages && extras.messages.length > 0
      ? extras.messages
      : buildLineMessages({
          contentText: input.contentText,
          contentMedia: input.contentMedia ?? null,
        });

  if (messages.length === 0) {
    return {
      success: false,
      platformPostId: null,
      publishedAt: null,
      error: "Empty LINE post: neither text nor media provided",
    };
  }

  if (messages.length > LINE_MAX_MESSAGES_PER_REQUEST) {
    return {
      success: false,
      platformPostId: null,
      publishedAt: null,
      error: `LINE allows at most ${LINE_MAX_MESSAGES_PER_REQUEST} messages per request (got ${messages.length})`,
    };
  }

  const body: Record<string, unknown> = { messages };
  if (typeof extras.notificationDisabled === "boolean") {
    body.notificationDisabled = extras.notificationDisabled;
  }

  let path: string;
  switch (mode) {
    case "push": {
      const to = extras.targetId ?? creds.defaultTargetId;
      if (!to) {
        return {
          success: false,
          platformPostId: null,
          publishedAt: null,
          error: "LINE push mode requires targetId (userId)",
        };
      }
      body.to = to;
      path = "/v2/bot/message/push";
      break;
    }
    case "multicast": {
      const toList = extras.targetIds ?? creds.defaultTargetIds;
      if (!toList || toList.length === 0) {
        return {
          success: false,
          platformPostId: null,
          publishedAt: null,
          error: "LINE multicast mode requires targetIds (userId[])",
        };
      }
      body.to = toList;
      path = "/v2/bot/message/multicast";
      break;
    }
    case "broadcast": {
      path = "/v2/bot/message/broadcast";
      break;
    }
    default:
      return {
        success: false,
        platformPostId: null,
        publishedAt: null,
        error: `Unknown LINE publish mode: ${mode as string}`,
      };
  }

  const headers: Record<string, string> = {};
  if (input.idempotencyKey) {
    // LINE Messaging API は X-Line-Retry-Key をサポート
    headers["X-Line-Retry-Key"] = input.idempotencyKey;
  }

  try {
    const res = await httpClient.request<{ sentMessages?: Array<{ id?: string }> }>({
      method: "POST",
      path,
      accessToken: creds.accessToken,
      json: body,
      headers,
    });
    // push/multicast/broadcast のレスポンスから代表 message id を採る
    // broadcast では id が返らないことがあるため request-id ヘッダ相当のフォールバックを行う
    const first = res.data?.sentMessages?.[0]?.id ?? null;
    const platformPostId = first ?? `line-${mode}-${Date.now()}`;
    return {
      success: true,
      platformPostId,
      publishedAt: new Date(),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      platformPostId: null,
      publishedAt: null,
      error: message,
    };
  }
}

// ───────────────────────────────────────────
// deletePost
// ───────────────────────────────────────────

/**
 * LINE は送信済みメッセージの削除を公式にサポートしていない。
 * unsend は個人ユーザーの LINE アプリ側機能であり、Messaging API では提供されない。
 * そのため deletePost は常に ProviderError を返す。
 */
export async function deletePost(_input: DeletePostInput): Promise<DeleteResult> {
  throw new ProviderError("LINE Messaging API does not support deleting sent messages", {
    code: "PROVIDER_UNSUPPORTED_OPERATION",
    operation: "deletePost",
    platform: "line",
  });
}
