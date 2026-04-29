import { Hono } from "hono";

export type D1DatabaseBinding = {
  prepare<T = unknown>(query: string): {
    first(): Promise<T | null>;
  };
};

export type WorkerBindings = {
  DB?: D1DatabaseBinding;
};

type WorkerVariables = {
  Bindings: WorkerBindings;
};

export function createWorkerApp(): Hono<WorkerVariables> {
  const app = new Hono<WorkerVariables>();

  app.get("/api/health", (c) => {
    return c.json({
      status: "ok",
      runtime: "cloudflare-worker",
      database: "d1",
    });
  });

  app.get("/api/d1/schema-version", async (c) => {
    const db = c.env?.DB;
    if (!db) {
      return c.json(
        {
          error: {
            code: "D1_NOT_CONFIGURED",
            message: "Cloudflare D1 binding DB is not configured",
          },
        },
        503,
      );
    }

    const row = await db
      .prepare<{ version: string }>(
        "select version from sns_agent_schema_version order by applied_at desc limit 1",
      )
      .first();

    return c.json({ schemaVersion: row?.version ?? null });
  });

  app.notFound((c) => {
    return c.json(
      { error: { code: "NOT_FOUND", message: `Route not found: ${c.req.method} ${c.req.path}` } },
      404,
    );
  });

  return app;
}

const app = createWorkerApp();
type WorkerFetchRequest = Parameters<typeof app.fetch>[0];

export default {
  fetch(request: WorkerFetchRequest, env: WorkerBindings) {
    return app.fetch(request, env);
  },
};
