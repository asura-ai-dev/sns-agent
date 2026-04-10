/**
 * Skills パッケージルート
 * design.md セクション 4.2: /api/skills
 */
import { Hono } from "hono";

const skills = new Hono();

skills.get("/", (c) => {
  return c.json(
    { error: { code: "NOT_IMPLEMENTED", message: "GET /api/skills is not yet implemented" } },
    501,
  );
});

export { skills };
