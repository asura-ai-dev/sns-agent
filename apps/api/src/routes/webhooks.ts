/**
 * Webhook 受信ルート
 * design.md セクション 4.2: /api/webhooks
 *
 * - POST /api/webhooks/x         : X (未実装)
 * - POST /api/webhooks/line      : LINE Webhook 受信 (署名検証 + イベント解析)
 * - GET  /api/webhooks/instagram : Meta Webhook 検証 (hub.challenge エコー)
 * - POST /api/webhooks/instagram : Instagram Webhook 受信 (署名検証 + イベント解析)
 */
import { Hono } from "hono";
import { getProviderRegistry } from "../providers.js";

const webhooks = new Hono();

webhooks.post("/x", (c) => {
  return c.json(
    { error: { code: "NOT_IMPLEMENTED", message: "POST /api/webhooks/x is not yet implemented" } },
    501,
  );
});

/**
 * LINE Webhook 受信 (Task 4001)。
 * 署名検証のため raw body を取得し、provider-line の handleWebhook に渡す。
 * LINE の仕様: `x-line-signature` ヘッダの HMAC-SHA256(channelSecret, rawBody) を検証。
 */
webhooks.post("/line", async (c) => {
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
  const headers: Record<string, string> = {};
  c.req.raw.headers.forEach((value, key) => {
    headers[key] = value;
  });

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

  // v1 はイベントの enqueue までは行わず、受理数のみ返す
  return c.json({ received: result.events.length }, 200);
});

/**
 * Meta Webhook の購読検証エンドポイント。
 * GET /api/webhooks/instagram?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...
 * INSTAGRAM_WEBHOOK_VERIFY_TOKEN 環境変数と一致したら hub.challenge をそのまま返す。
 */
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

/**
 * Instagram Webhook 受信。
 * 署名検証のため raw body 文字列を取得し、provider-instagram の handleWebhook に渡す。
 */
webhooks.post("/instagram", async (c) => {
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

  // 署名検証には raw body が必要
  const rawBody = await c.req.text();
  const headers: Record<string, string> = {};
  c.req.raw.headers.forEach((value, key) => {
    headers[key] = value;
  });

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

  // v1 はイベントの enqueue までは行わず、受理数のみ返す
  return c.json({ received: result.events.length }, 200);
});

export { webhooks };
