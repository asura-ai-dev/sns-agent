/**
 * Webhook 受信ルート
 * design.md セクション 4.2: /api/webhooks
 */
import { Hono } from "hono";

const webhooks = new Hono();

webhooks.post("/x", (c) => {
  return c.json(
    { error: { code: "NOT_IMPLEMENTED", message: "POST /api/webhooks/x is not yet implemented" } },
    501,
  );
});

export { webhooks };
