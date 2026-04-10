/**
 * アカウント管理ルート
 * design.md セクション 4.2: /api/accounts
 */
import { Hono } from "hono";

const accounts = new Hono();

accounts.get("/", (c) => {
  return c.json(
    { error: { code: "NOT_IMPLEMENTED", message: "GET /api/accounts is not yet implemented" } },
    501,
  );
});

export { accounts };
