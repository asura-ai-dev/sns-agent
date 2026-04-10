/**
 * 予約管理ルート
 * design.md セクション 4.2: /api/schedules
 */
import { Hono } from "hono";

const schedules = new Hono();

schedules.get("/", (c) => {
  return c.json(
    { error: { code: "NOT_IMPLEMENTED", message: "GET /api/schedules is not yet implemented" } },
    501,
  );
});

export { schedules };
