import { Hono } from "hono";
import { serve } from "@hono/node-server";

const app = new Hono();

app.get("/", (c) => {
  return c.json({ message: "SNS Agent API" });
});

const port = Number(process.env.PORT) || 3001;

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Server running on http://localhost:${info.port}`);
});

export default app;
