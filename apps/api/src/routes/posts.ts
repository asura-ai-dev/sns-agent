/**
 * 投稿管理ルート
 * design.md セクション 4.2: /api/posts
 */
import { Hono } from "hono";

const posts = new Hono();

posts.get("/", (c) => {
  return c.json(
    { error: { code: "NOT_IMPLEMENTED", message: "GET /api/posts is not yet implemented" } },
    501,
  );
});

export { posts };
