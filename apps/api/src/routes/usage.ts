/**
 * 使用量ルート
 * design.md セクション 4.2: /api/usage
 */
import { Hono } from "hono";

const usage = new Hono();

usage.get("/", (c) => {
  return c.json(
    { error: { code: "NOT_IMPLEMENTED", message: "GET /api/usage is not yet implemented" } },
    501,
  );
});

export { usage };
