/**
 * Webhook 受信ルート
 * design.md セクション 4.2: /api/webhooks
 * Task 6003: 受信したイベントを inbox usecase (processInboundMessage) に渡し、
 * conversation_threads / messages に永続化する。
 *
 * - POST /api/webhooks/x         : X mention/reply/DM (v1 は未接続だが受理して processInbound に渡す)
 * - POST /api/webhooks/line      : LINE Webhook (署名検証 + イベント解析 + inbox 保存)
 * - GET  /api/webhooks/instagram : Meta Webhook 購読検証 (hub.challenge エコー)
 * - POST /api/webhooks/instagram : Instagram Webhook (署名検証 + イベント解析 + inbox 保存)
 */
import { Hono } from "hono";
import type { Platform } from "@sns-agent/config";
import { processInboundMessage, type InboundMessageInput } from "@sns-agent/core";
import {
  DrizzleAccountRepository,
  DrizzleConversationRepository,
  DrizzleMessageRepository,
} from "@sns-agent/db";
import { getProviderRegistry } from "../providers.js";
import type { AppVariables } from "../types.js";

const webhooks = new Hono<{ Variables: AppVariables }>();

// ───────────────────────────────────────────
// ヘルパー: inbox usecase deps
// ───────────────────────────────────────────

function buildInboxDeps(db: AppVariables["db"]) {
  const encryptionKey =
    process.env.ENCRYPTION_KEY ||
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  return {
    conversationRepo: new DrizzleConversationRepository(db),
    messageRepo: new DrizzleMessageRepository(db),
    accountRepo: new DrizzleAccountRepository(db),
    providers: getProviderRegistry().getAll(),
    encryptionKey,
  };
}

/**
 * (platform, externalAccountId) でアクティブな social_account を検索する。
 * 複数ワークスペースに同じ external ID が存在する場合は active を優先して返す。
 */
async function findAccountByExternal(
  db: AppVariables["db"],
  platform: Platform,
  externalAccountId: string,
): Promise<{ id: string; workspaceId: string } | null> {
  const repo = new DrizzleAccountRepository(db);
  const account = await repo.findByPlatformAndExternalId(platform, externalAccountId);
  return account ? { id: account.id, workspaceId: account.workspaceId } : null;
}

// ───────────────────────────────────────────
// ヘルパー: collectHeaders
// ───────────────────────────────────────────
function collectHeaders(req: Request): Record<string, string> {
  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return headers;
}

// ───────────────────────────────────────────
// POST /api/webhooks/x
// ───────────────────────────────────────────
/**
 * X (Twitter) の mention/reply/DM webhook 受信 (最小実装)。
 * 署名検証は将来 (X 公式) 実装に委譲。
 * v1 は body から最低限のフィールドを取り出し、processInboundMessage に渡す。
 *
 * 想定 body 形状 (内部擬似形式 or X Account Activity API):
 *   {
 *     for_user_id: "<our-x-user-id>",   // 自アカウントの外部 ID
 *     tweet_create_events?: [           // mention / reply
 *       { id_str, text, user: { id_str, name }, in_reply_to_user_id_str }
 *     ],
 *     direct_message_events?: [
 *       { id, message_create: { sender_id, target: { recipient_id }, message_data: { text } } }
 *     ]
 *   }
 */
webhooks.post("/x", async (c) => {
  const db = c.get("db");
  const body = await c.req
    .json<Record<string, unknown>>()
    .catch(() => ({}) as Record<string, unknown>);

  const forUserId = typeof body.for_user_id === "string" ? body.for_user_id : null;
  if (!forUserId) {
    return c.json(
      {
        error: {
          code: "WEBHOOK_INVALID_PAYLOAD",
          message: "X webhook requires for_user_id",
        },
      },
      400,
    );
  }

  const account = await findAccountByExternal(db, "x", forUserId);
  if (!account) {
    // 未接続アカウント宛のイベントは 202 で無視
    return c.json({ received: 0, ignored: true }, 202);
  }

  const deps = buildInboxDeps(db);
  const inboundList: InboundMessageInput[] = [];

  // mention / reply
  const tweetEvents = Array.isArray(body.tweet_create_events) ? body.tweet_create_events : [];
  for (const raw of tweetEvents) {
    if (!raw || typeof raw !== "object") continue;
    const ev = raw as Record<string, unknown>;
    const id = typeof ev.id_str === "string" ? ev.id_str : null;
    const conversationId =
      typeof ev.conversation_id_str === "string" ? ev.conversation_id_str : (id ?? null);
    const replyToPostId =
      typeof ev.in_reply_to_status_id_str === "string" ? ev.in_reply_to_status_id_str : null;
    const text = typeof ev.text === "string" ? ev.text : null;
    const user = (ev.user as Record<string, unknown> | undefined) ?? {};
    const senderId = typeof user.id_str === "string" ? user.id_str : null;
    const senderName = typeof user.name === "string" ? user.name : null;
    const senderUsername = typeof user.screen_name === "string" ? user.screen_name : null;
    if (!senderId) continue;
    if (senderId === forUserId) continue;
    inboundList.push({
      workspaceId: account.workspaceId,
      socialAccountId: account.id,
      platform: "x",
      externalThreadId: conversationId ?? senderId,
      participantName: senderName,
      participantExternalId: senderId,
      channel: "public",
      initiatedBy: "external",
      externalMessageId: id,
      contentText: text,
      authorExternalId: senderId,
      authorDisplayName: senderName,
      threadProviderMetadata: {
        x: {
          entryType: replyToPostId ? "reply" : "mention",
          conversationId,
          rootPostId: conversationId,
          focusPostId: id,
          replyToPostId,
          authorXUserId: senderId,
          authorUsername: senderUsername,
        },
      },
      messageProviderMetadata: {
        x: {
          entryType: replyToPostId ? "reply" : "mention",
          conversationId,
          postId: id,
          replyToPostId,
          authorUsername: senderUsername,
          mentionedXUserIds: [],
        },
      },
      sentAt: new Date(),
    });
  }

  // direct_message_events
  const dmEvents = Array.isArray(body.direct_message_events) ? body.direct_message_events : [];
  for (const raw of dmEvents) {
    if (!raw || typeof raw !== "object") continue;
    const ev = raw as Record<string, unknown>;
    const id = typeof ev.id === "string" ? ev.id : null;
    const create = (ev.message_create as Record<string, unknown> | undefined) ?? {};
    const senderId = typeof create.sender_id === "string" ? create.sender_id : null;
    const data = (create.message_data as Record<string, unknown> | undefined) ?? {};
    const text = typeof data.text === "string" ? data.text : null;
    if (!senderId) continue;
    if (senderId === forUserId) continue;
    inboundList.push({
      workspaceId: account.workspaceId,
      socialAccountId: account.id,
      platform: "x",
      externalThreadId: `dm:${senderId}`,
      participantName: null,
      participantExternalId: senderId,
      channel: "direct",
      initiatedBy: "external",
      externalMessageId: id,
      contentText: text,
      authorExternalId: senderId,
      authorDisplayName: null,
      threadProviderMetadata: {
        x: {
          entryType: "dm",
          conversationId: null,
          rootPostId: null,
          focusPostId: id,
          replyToPostId: null,
          authorXUserId: senderId,
          authorUsername: null,
        },
      },
      messageProviderMetadata: {
        x: {
          entryType: "dm",
          conversationId: null,
          postId: id,
          replyToPostId: null,
          authorUsername: null,
          mentionedXUserIds: [],
        },
      },
      sentAt: new Date(),
    });
  }

  let stored = 0;
  for (const input of inboundList) {
    try {
      await processInboundMessage(deps, input);
      stored += 1;
    } catch (err) {
      // 個別失敗は握りつぶし、カウントだけ記録する
      // eslint-disable-next-line no-console
      console.warn("[webhooks/x] processInboundMessage failed", err);
    }
  }

  return c.json({ received: stored }, 200);
});

// ───────────────────────────────────────────
// LINE Webhook
// ───────────────────────────────────────────
webhooks.post("/line", async (c) => {
  const db = c.get("db");
  const registry = getProviderRegistry();
  const provider = registry.get("line");
  if (!provider?.handleWebhook) {
    return c.json(
      {
        error: {
          code: "PROVIDER_NOT_REGISTERED",
          message: "LINE provider is not registered",
        },
      },
      503,
    );
  }

  const rawBody = await c.req.text();
  const headers = collectHeaders(c.req.raw);

  const result = await provider.handleWebhook({ headers, body: rawBody });
  if (!result.verified) {
    return c.json(
      {
        error: {
          code: "WEBHOOK_SIGNATURE_INVALID",
          message: "LINE webhook signature verification failed",
        },
      },
      401,
    );
  }

  // LINE は payload.destination が bot の userId (= externalAccountId)
  let destination: string | null = null;
  try {
    const parsed = JSON.parse(rawBody) as { destination?: unknown };
    if (typeof parsed.destination === "string") destination = parsed.destination;
  } catch {
    destination = null;
  }

  if (!destination) {
    // destination が取れない場合はイベント数だけ返して終了
    return c.json({ received: 0, ignored: true }, 200);
  }

  const account = await findAccountByExternal(db, "line", destination);
  if (!account) {
    return c.json({ received: 0, ignored: true }, 202);
  }

  const deps = buildInboxDeps(db);
  let stored = 0;

  for (const ev of result.events) {
    if (ev.type !== "message") continue;
    if (!ev.externalThreadId) continue;
    const raw = ev.data as Record<string, unknown> | null;
    const message =
      raw && typeof raw === "object"
        ? (raw.message as Record<string, unknown> | undefined)
        : undefined;
    const text = message && typeof message.text === "string" ? message.text : null;
    const source =
      raw && typeof raw === "object" ? (raw.source as Record<string, unknown> | undefined) : {};
    const participantName =
      source && typeof (source as Record<string, unknown>).userId === "string"
        ? ((source as Record<string, unknown>).userId as string)
        : null;
    const ts =
      raw &&
      typeof raw === "object" &&
      typeof (raw as { timestamp?: unknown }).timestamp === "number"
        ? new Date((raw as { timestamp: number }).timestamp)
        : new Date();

    try {
      await processInboundMessage(deps, {
        workspaceId: account.workspaceId,
        socialAccountId: account.id,
        platform: "line",
        externalThreadId: ev.externalThreadId,
        participantName,
        participantExternalId: participantName,
        channel: "direct",
        initiatedBy: "external",
        externalMessageId: ev.externalMessageId,
        contentText: text,
        authorExternalId: participantName,
        authorDisplayName: participantName,
        sentAt: ts,
      });
      stored += 1;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[webhooks/line] processInboundMessage failed", err);
    }
  }

  return c.json({ received: stored }, 200);
});

// ───────────────────────────────────────────
// Instagram Webhook 購読検証 (GET)
// ───────────────────────────────────────────
webhooks.get("/instagram", (c) => {
  const mode = c.req.query("hub.mode");
  const verifyToken = c.req.query("hub.verify_token");
  const challenge = c.req.query("hub.challenge");
  const expected = process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN;

  if (mode === "subscribe" && expected && verifyToken === expected && challenge) {
    return c.text(challenge, 200);
  }
  return c.json(
    {
      error: {
        code: "WEBHOOK_VERIFICATION_FAILED",
        message: "Instagram webhook verification failed",
      },
    },
    403,
  );
});

// ───────────────────────────────────────────
// Instagram Webhook 受信 (POST)
// ───────────────────────────────────────────
webhooks.post("/instagram", async (c) => {
  const db = c.get("db");
  const registry = getProviderRegistry();
  const provider = registry.get("instagram");
  if (!provider?.handleWebhook) {
    return c.json(
      {
        error: {
          code: "PROVIDER_NOT_REGISTERED",
          message: "Instagram provider is not registered",
        },
      },
      503,
    );
  }

  const rawBody = await c.req.text();
  const headers = collectHeaders(c.req.raw);

  const result = await provider.handleWebhook({ headers, body: rawBody });
  if (!result.verified) {
    return c.json(
      {
        error: {
          code: "WEBHOOK_SIGNATURE_INVALID",
          message: "Instagram webhook signature verification failed",
        },
      },
      401,
    );
  }

  // entry[].id を取得するため raw payload を再 parse
  let entries: Record<string, unknown>[] = [];
  try {
    const parsed = JSON.parse(rawBody) as { entry?: unknown };
    if (Array.isArray(parsed.entry)) {
      entries = parsed.entry.filter(
        (e): e is Record<string, unknown> => !!e && typeof e === "object",
      );
    }
  } catch {
    entries = [];
  }

  const deps = buildInboxDeps(db);
  let stored = 0;

  for (const entry of entries) {
    const igUserId = typeof entry.id === "string" ? entry.id : null;
    if (!igUserId) continue;
    const account = await findAccountByExternal(db, "instagram", igUserId);
    if (!account) continue;

    // messaging イベント (DM)
    const messaging = Array.isArray(entry.messaging) ? entry.messaging : [];
    for (const raw of messaging) {
      if (!raw || typeof raw !== "object") continue;
      const msg = raw as Record<string, unknown>;
      const sender = (msg.sender as Record<string, unknown> | undefined) ?? {};
      const recipient = (msg.recipient as Record<string, unknown> | undefined) ?? {};
      const message = msg.message as Record<string, unknown> | undefined;
      const senderId = typeof sender.id === "string" ? sender.id : null;
      const recipientId = typeof recipient.id === "string" ? recipient.id : null;
      if (!senderId) continue;
      const threadId = senderId && recipientId ? `${recipientId}:${senderId}` : senderId;
      const text = message && typeof message.text === "string" ? message.text : null;
      const mid = message && typeof message.mid === "string" ? message.mid : null;
      const tsRaw = typeof msg.timestamp === "number" ? msg.timestamp : null;

      try {
        await processInboundMessage(deps, {
          workspaceId: account.workspaceId,
          socialAccountId: account.id,
          platform: "instagram",
          externalThreadId: threadId,
          participantName: senderId,
          participantExternalId: senderId,
          channel: "direct",
          initiatedBy: "external",
          externalMessageId: mid,
          contentText: text,
          authorExternalId: senderId,
          authorDisplayName: senderId,
          sentAt: tsRaw ? new Date(tsRaw) : new Date(),
        });
        stored += 1;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[webhooks/instagram] processInboundMessage failed", err);
      }
    }

    // changes (comments)
    const changes = Array.isArray(entry.changes) ? entry.changes : [];
    for (const raw of changes) {
      if (!raw || typeof raw !== "object") continue;
      const change = raw as Record<string, unknown>;
      const field = typeof change.field === "string" ? change.field : null;
      const value = change.value as Record<string, unknown> | undefined;
      if (field !== "comments" || !value) continue;
      const commentId = typeof value.id === "string" ? value.id : null;
      const text = typeof value.text === "string" ? value.text : null;
      const from = (value.from as Record<string, unknown> | undefined) ?? {};
      const fromId = typeof from.id === "string" ? from.id : null;
      const fromName = typeof from.username === "string" ? from.username : null;
      const media = (value.media as Record<string, unknown> | undefined) ?? {};
      const mediaId = typeof media.id === "string" ? media.id : null;
      const threadId = mediaId ?? fromId;
      if (!threadId) continue;

      try {
        await processInboundMessage(deps, {
          workspaceId: account.workspaceId,
          socialAccountId: account.id,
          platform: "instagram",
          externalThreadId: threadId,
          participantName: fromName,
          participantExternalId: fromId,
          channel: "public",
          initiatedBy: "external",
          externalMessageId: commentId,
          contentText: text,
          authorExternalId: fromId,
          authorDisplayName: fromName,
          sentAt: new Date(),
        });
        stored += 1;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[webhooks/instagram] processInboundMessage failed (comment)", err);
      }
    }
  }

  return c.json({ received: stored }, 200);
});

export { webhooks };
