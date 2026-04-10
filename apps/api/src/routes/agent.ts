/**
 * Agent Gateway ルート
 * design.md セクション 4.2: /api/agent
 */
import { Hono } from "hono";

const agent = new Hono();

agent.post("/chat", (c) => {
  return c.json(
    { error: { code: "NOT_IMPLEMENTED", message: "POST /api/agent/chat is not yet implemented" } },
    501,
  );
});

export { agent };
