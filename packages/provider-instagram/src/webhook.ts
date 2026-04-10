/**
 * Instagram Webhook の署名検証とイベント解析
 *
 * Meta の Webhook は X-Hub-Signature-256 ヘッダに HMAC-SHA256(body, app_secret) を hex 文字列で入れる。
 * Instagram は Messenger Platform と同じペイロード形状を持つ (field: messages, comments 等)。
 *
 * design.md セクション 4.2: /api/webhooks/instagram。
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { WebhookInput, WebhookResult, WebhookEvent } from "@sns-agent/core";

export interface InstagramWebhookConfig {
  /** Facebook App Secret (X-Hub-Signature-256 検証用) */
  appSecret: string;
}

/**
 * 署名検証 + イベント解析のエントリポイント。
 *
 * body は「受信時の raw 文字列」を想定する。Hono 等のフレームワークは
 * JSON パース後の object を渡してくることがあるため、両方を受け入れる。
 * object が渡ってきた場合は JSON.stringify 済みを内部で検証に使う。
 *
 * 注意: 署名検証は raw バイト列との一致が前提のため、apps/api 層では
 * c.req.raw.text() 等で取り出した文字列を body に渡す運用を推奨する。
 */
export function handleWebhook(input: WebhookInput, config: InstagramWebhookConfig): WebhookResult {
  const rawBody = typeof input.body === "string" ? input.body : JSON.stringify(input.body ?? {});

  const signature = headerValue(input.headers, "x-hub-signature-256");
  const verified = verifySignature(rawBody, signature, config.appSecret);

  if (!verified) {
    return { verified: false, events: [] };
  }

  let parsed: unknown;
  try {
    parsed = typeof input.body === "string" ? JSON.parse(input.body) : input.body;
  } catch {
    return { verified: true, events: [] };
  }

  const events = parseEvents(parsed);
  return { verified: true, events };
}

/**
 * X-Hub-Signature-256: sha256=<hex>
 */
export function verifySignature(
  body: string,
  signatureHeader: string | undefined,
  appSecret: string,
): boolean {
  if (!signatureHeader) return false;
  const prefix = "sha256=";
  if (!signatureHeader.startsWith(prefix)) return false;
  const received = signatureHeader.slice(prefix.length);

  const expected = createHmac("sha256", appSecret).update(body, "utf8").digest("hex");

  if (expected.length !== received.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(received, "hex"));
  } catch {
    return false;
  }
}

/**
 * Instagram Webhook ペイロード:
 * {
 *   object: "instagram",
 *   entry: [
 *     {
 *       id: "<ig-user-id>",
 *       time: 1700000000,
 *       messaging?: [ { sender: {id}, recipient: {id}, timestamp, message: { mid, text } } ],
 *       changes?: [ { field: "comments", value: { id, text, from: {id, username}, media: {id} } } ]
 *     }
 *   ]
 * }
 */
function parseEvents(body: unknown): WebhookEvent[] {
  if (!body || typeof body !== "object") return [];
  const obj = body as Record<string, unknown>;

  const entries = Array.isArray(obj.entry) ? obj.entry : [];
  const events: WebhookEvent[] = [];

  for (const rawEntry of entries) {
    if (!rawEntry || typeof rawEntry !== "object") continue;
    const entry = rawEntry as Record<string, unknown>;

    // Messenger 互換 messaging イベント (DM)
    const messaging = Array.isArray(entry.messaging) ? entry.messaging : [];
    for (const rawMsg of messaging) {
      if (!rawMsg || typeof rawMsg !== "object") continue;
      const msg = rawMsg as Record<string, unknown>;
      const sender = (msg.sender as Record<string, unknown> | undefined) ?? {};
      const recipient = (msg.recipient as Record<string, unknown> | undefined) ?? {};
      const message = msg.message as Record<string, unknown> | undefined;
      const senderId = typeof sender.id === "string" ? sender.id : null;
      const recipientId = typeof recipient.id === "string" ? recipient.id : null;
      const threadId = senderId && recipientId ? `${recipientId}:${senderId}` : senderId;
      const mid = message && typeof message.mid === "string" ? message.mid : null;

      events.push({
        type: "message",
        externalThreadId: threadId,
        externalMessageId: mid,
        data: msg,
      });
    }

    // changes (comments, mentions 等)
    const changes = Array.isArray(entry.changes) ? entry.changes : [];
    for (const rawChange of changes) {
      if (!rawChange || typeof rawChange !== "object") continue;
      const change = rawChange as Record<string, unknown>;
      const field = typeof change.field === "string" ? change.field : null;
      const value = change.value as Record<string, unknown> | undefined;

      if (field === "comments") {
        const commentId = value && typeof value.id === "string" ? value.id : null;
        const mediaId =
          value && value.media && typeof (value.media as Record<string, unknown>).id === "string"
            ? ((value.media as Record<string, unknown>).id as string)
            : null;
        events.push({
          type: "postback",
          externalThreadId: mediaId,
          externalMessageId: commentId,
          data: change,
        });
      } else {
        events.push({
          type: "other",
          externalThreadId: null,
          externalMessageId: null,
          data: change,
        });
      }
    }
  }

  return events;
}

function headerValue(headers: Record<string, string>, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}
