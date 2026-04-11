/**
 * LINE Webhook 受信ハンドラ
 *
 * - 署名検証: HTTP ヘッダ `x-line-signature` (または `X-Line-Signature`) に含まれる
 *   HMAC-SHA256(channelSecret, rawBody) の base64 値と一致するか確認する。
 * - イベント解析: Messaging API の webhook payload ({ destination, events: [...] })
 *   を解析し、SocialProvider 共通の WebhookEvent 配列に正規化する。
 *
 * design.md セクション 4.2 (/api/webhooks/line), Task 4001 の仕様に準拠。
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { WebhookInput, WebhookResult, WebhookEvent } from "@sns-agent/core";

export interface LineWebhookOptions {
  /**
   * Channel Secret。署名検証に使用する。
   * 未指定の場合は verified=false だが events は解析して返す (devモード)。
   */
  channelSecret?: string;
}

/**
 * x-line-signature ヘッダの検証。
 * LINE 仕様: signature = base64(HmacSHA256(channelSecret, rawBody))
 */
export function verifyLineSignature(
  rawBody: string,
  signature: string,
  channelSecret: string,
): boolean {
  const expected = createHmac("sha256", channelSecret).update(rawBody).digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(signature, "base64");
  } catch {
    return false;
  }
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

/**
 * raw body 文字列を取得する。
 * handleWebhook は input.body が既に parse 済みの JSON でも、raw string でも
 * 受けられるようにする。署名検証には raw の bytes が必要なので、
 * parse 済みの場合は JSON.stringify で再構築する (LINE の仕様上、これは
 * 呼び出し側が raw を保持している方が安全なので非推奨ルート)。
 */
function getRawBody(body: unknown): string {
  if (typeof body === "string") return body;
  if (body && typeof body === "object" && "__raw" in body) {
    const raw = (body as { __raw: unknown }).__raw;
    if (typeof raw === "string") return raw;
  }
  return JSON.stringify(body ?? {});
}

/**
 * WebhookInput.body から LINE webhook payload を取り出す。
 * raw 文字列で渡された場合は JSON.parse する。
 */
function getParsedPayload(body: unknown): LineWebhookPayload | null {
  let obj: unknown = body;
  if (typeof body === "string") {
    try {
      obj = JSON.parse(body);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== "object") return null;
  const casted = obj as { events?: unknown; destination?: unknown; __raw?: unknown };
  if (!Array.isArray(casted.events)) return null;
  return {
    destination: typeof casted.destination === "string" ? casted.destination : null,
    events: casted.events as LineRawEvent[],
  };
}

interface LineWebhookPayload {
  destination: string | null;
  events: LineRawEvent[];
}

interface LineRawEvent {
  type?: string;
  timestamp?: number;
  source?: { type?: string; userId?: string; groupId?: string; roomId?: string };
  message?: { id?: string; type?: string; text?: string };
  replyToken?: string;
  postback?: { data?: string };
}

/**
 * LINE Webhook ハンドラ本体。
 * 署名検証 + イベント正規化を行う。
 */
export async function handleWebhook(
  input: WebhookInput,
  options: LineWebhookOptions = {},
): Promise<WebhookResult> {
  const signature =
    input.headers["x-line-signature"] ??
    input.headers["X-Line-Signature"] ??
    input.headers["x-line-Signature"] ??
    "";

  const rawBody = getRawBody(input.body);

  let verified = false;
  if (options.channelSecret && signature.length > 0) {
    verified = verifyLineSignature(rawBody, signature, options.channelSecret);
  }

  const payload = getParsedPayload(input.body);
  if (!payload) {
    return { verified, events: [] };
  }

  const events: WebhookEvent[] = payload.events.map((ev) => normalizeEvent(ev));
  return { verified, events };
}

function normalizeEvent(ev: LineRawEvent): WebhookEvent {
  const externalThreadId = ev.source?.userId ?? ev.source?.groupId ?? ev.source?.roomId ?? null;
  const externalMessageId = ev.message?.id ?? null;

  let type: WebhookEvent["type"] = "other";
  switch (ev.type) {
    case "message":
      type = "message";
      break;
    case "follow":
      type = "follow";
      break;
    case "unfollow":
      type = "unfollow";
      break;
    case "postback":
      type = "postback";
      break;
    default:
      type = "other";
  }

  return {
    type,
    externalThreadId,
    externalMessageId,
    data: ev,
  };
}
