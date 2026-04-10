/**
 * 監査ログルート
 * design.md セクション 4.2: /api/audit
 */
import { Hono } from "hono";

const audit = new Hono();

audit.get("/", (c) => {
  return c.json(
    { error: { code: "NOT_IMPLEMENTED", message: "GET /api/audit is not yet implemented" } },
    501,
  );
});

export { audit };
