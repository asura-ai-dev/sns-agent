/**
 * 予算ルート
 * design.md セクション 4.2: /api/budget
 */
import { Hono } from "hono";

const budget = new Hono();

budget.get("/policies", (c) => {
  return c.json(
    {
      error: {
        code: "NOT_IMPLEMENTED",
        message: "GET /api/budget/policies is not yet implemented",
      },
    },
    501,
  );
});

export { budget };
