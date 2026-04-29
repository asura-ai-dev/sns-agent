import { describe, expect, it } from "vitest";
import { createWorkerApp } from "../index.js";

describe("Cloudflare worker app", () => {
  it("reports worker and D1 readiness on /api/health", async () => {
    const app = createWorkerApp();
    const response = await app.request("/api/health", {}, { DB: createD1Stub() });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      runtime: "cloudflare-worker",
      database: "d1",
    });
  });

  it("reads schema version through the D1 binding", async () => {
    const app = createWorkerApp();
    const response = await app.request("/api/d1/schema-version", {}, { DB: createD1Stub("0011") });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ schemaVersion: "0011" });
  });

  it("returns 503 when the D1 binding is not configured", async () => {
    const app = createWorkerApp();
    const response = await app.request("/api/d1/schema-version");

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: { code: "D1_NOT_CONFIGURED", message: "Cloudflare D1 binding DB is not configured" },
    });
  });
});

function createD1Stub(schemaVersion = "0001") {
  return {
    prepare(sql: string) {
      return {
        async first<T>() {
          expect(sql).toContain("sns_agent_schema_version");
          return { version: schemaVersion } as T;
        },
      };
    },
  };
}
