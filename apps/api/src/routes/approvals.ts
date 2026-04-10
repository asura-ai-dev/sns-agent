/**
 * 承認フロールート
 * design.md セクション 4.2: /api/approvals
 */
import { Hono } from "hono";

const approvals = new Hono();

approvals.get("/", (c) => {
  return c.json(
    { error: { code: "NOT_IMPLEMENTED", message: "GET /api/approvals is not yet implemented" } },
    501,
  );
});

export { approvals };
