/**
 * LLM ルーティングルート
 * design.md セクション 4.2: /api/llm
 */
import { Hono } from "hono";

const llm = new Hono();

llm.get("/routes", (c) => {
  return c.json(
    { error: { code: "NOT_IMPLEMENTED", message: "GET /api/llm/routes is not yet implemented" } },
    501,
  );
});

export { llm };
