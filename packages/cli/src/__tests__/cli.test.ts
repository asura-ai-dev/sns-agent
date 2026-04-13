/**
 * CLI 統合テスト (Task 6004)
 *
 * モック API サーバー（node:http）を起動し、SDK → fetch → mock server の
 * エンドツーエンド経路で CLI コマンドの挙動を検証する。
 *
 * spec.md AC-4, AC-7, AC-8, AC-9, AC-10、評価観点「CLI / Web UI / SDK が共通の
 * core use cases を経由しており、挙動が一致するか」に準拠。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { AddressInfo } from "node:net";
import { Command } from "commander";
import { registerAccountsCommand } from "../commands/accounts.js";
import { registerPostCommand } from "../commands/post.js";
import { registerScheduleCommand } from "../commands/schedule.js";
import { registerUsageCommand } from "../commands/usage.js";

// ───────────────────────────────────────────
// モック HTTP サーバー
// ───────────────────────────────────────────

interface MockRoute {
  method: string;
  path: string | RegExp;
  respond: (req: IncomingMessage, body: string) => { status: number; body: unknown };
}

let mockServer: Server;
let mockPort: number;
let routeHits: Array<{ method: string; url: string; body: string }> = [];

function startMockServer(routes: MockRoute[]): Promise<void> {
  return new Promise((resolve, reject) => {
    mockServer = createServer((req: IncomingMessage, res: ServerResponse) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        const url = req.url ?? "";
        const method = req.method ?? "GET";
        routeHits.push({ method, url, body });

        // 認証チェック
        const auth = req.headers.authorization;
        if (!auth || !auth.startsWith("Bearer ")) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: { code: "AUTH_UNAUTHORIZED", message: "no auth" } }));
          return;
        }

        for (const route of routes) {
          const methodMatch = route.method === method;
          const pathMatch =
            typeof route.path === "string"
              ? url.split("?")[0] === route.path
              : route.path.test(url);
          if (methodMatch && pathMatch) {
            const r = route.respond(req, body);
            res.writeHead(r.status, { "Content-Type": "application/json" });
            res.end(JSON.stringify(r.body));
            return;
          }
        }
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { code: "NOT_FOUND", message: `${method} ${url}` } }));
      });
    });
    mockServer.listen(0, "127.0.0.1", () => {
      const addr = mockServer.address() as AddressInfo;
      mockPort = addr.port;
      resolve();
    });
    mockServer.on("error", reject);
  });
}

function stopMockServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!mockServer) return resolve();
    mockServer.close(() => resolve());
  });
}

// ───────────────────────────────────────────
// 出力キャプチャ
// ───────────────────────────────────────────

interface CaptureResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runCli(argv: string[]): Promise<CaptureResult> {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];

  const origLog = console.log;
  const origError = console.error;
  const origExitCode = process.exitCode;
  const origStdoutWrite = process.stdout.write.bind(process.stdout);
  const origStderrWrite = process.stderr.write.bind(process.stderr);

  console.log = (...args: unknown[]) => {
    stdoutChunks.push(args.map(String).join(" "));
  };
  console.error = (...args: unknown[]) => {
    stderrChunks.push(args.map(String).join(" "));
  };
  // JsonFormatter 等が process.stdout.write を直接使うためインターセプト
  (process.stdout as unknown as { write: (chunk: unknown) => boolean }).write = (
    chunk: unknown,
  ): boolean => {
    if (typeof chunk === "string") stdoutChunks.push(chunk);
    else if (chunk instanceof Uint8Array) stdoutChunks.push(Buffer.from(chunk).toString("utf8"));
    return true;
  };
  (process.stderr as unknown as { write: (chunk: unknown) => boolean }).write = (
    chunk: unknown,
  ): boolean => {
    if (typeof chunk === "string") stderrChunks.push(chunk);
    else if (chunk instanceof Uint8Array) stderrChunks.push(Buffer.from(chunk).toString("utf8"));
    return true;
  };

  const program = new Command();
  program
    .name("sns")
    .description("SNS Agent CLI")
    .version("0.0.0-test")
    .option("--json", "Output as JSON")
    .option("--api-url <url>", "API base URL")
    .option("--api-key <key>", "API key")
    .enablePositionalOptions()
    .exitOverride();

  registerAccountsCommand(program);
  registerPostCommand(program);
  registerScheduleCommand(program);
  registerUsageCommand(program);

  process.exitCode = 0;

  try {
    await program.parseAsync(["node", "sns", ...argv]);
  } catch (err) {
    const code = (err as { code?: string } | undefined)?.code;
    if (code !== "commander.helpDisplayed" && code !== "commander.version") {
      stderrChunks.push(String((err as Error).message ?? err));
      if (process.exitCode === undefined || process.exitCode === 0) {
        process.exitCode = 1;
      }
    }
  }

  const exitCode = process.exitCode ?? 0;
  console.log = origLog;
  console.error = origError;
  (process.stdout as unknown as { write: typeof origStdoutWrite }).write = origStdoutWrite;
  (process.stderr as unknown as { write: typeof origStderrWrite }).write = origStderrWrite;
  process.exitCode = origExitCode;

  return {
    stdout: stdoutChunks.join(""),
    stderr: stderrChunks.join(""),
    exitCode,
  };
}

// ───────────────────────────────────────────
// Test suite
// ───────────────────────────────────────────

beforeAll(async () => {
  await startMockServer([
    {
      method: "GET",
      path: "/api/accounts",
      respond: () => ({
        status: 200,
        body: {
          data: [
            {
              id: "sa-1",
              workspaceId: "ws-1",
              platform: "x",
              displayName: "Mock X",
              externalAccountId: "ext-1",
              status: "active",
              tokenExpiresAt: new Date(Date.now() + 86400000).toISOString(),
              capabilities: null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
        },
      }),
    },
    {
      method: "POST",
      path: "/api/posts",
      respond: (_req, body) => {
        const parsed = body ? (JSON.parse(body) as Record<string, unknown>) : {};
        return {
          status: 201,
          body: {
            data: {
              id: "post-1",
              workspaceId: "ws-1",
              socialAccountId: parsed.socialAccountId ?? "sa-1",
              platform: "x",
              status: "draft",
              contentText: parsed.contentText ?? "",
              contentMedia: null,
              platformPostId: null,
              validationResult: null,
              idempotencyKey: null,
              createdBy: "u-1",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              publishedAt: null,
            },
          },
        };
      },
    },
    {
      method: "POST",
      path: "/api/schedules",
      respond: (_req, body) => {
        const parsed = body ? (JSON.parse(body) as Record<string, unknown>) : {};
        return {
          status: 201,
          body: {
            data: {
              id: "job-1",
              workspaceId: "ws-1",
              postId: parsed.postId ?? "post-1",
              scheduledAt: parsed.scheduledAt,
              status: "pending",
              attemptCount: 0,
              maxAttempts: 3,
              createdAt: new Date().toISOString(),
            },
          },
        };
      },
    },
    {
      method: "POST",
      path: "/api/schedules/run-due",
      respond: (_req, body) => {
        const parsed = body ? (JSON.parse(body) as Record<string, unknown>) : {};
        return {
          status: 200,
          body: {
            data: {
              processedAt: new Date().toISOString(),
              scanned: 1,
              processed: 1,
              skipped: 0,
              succeeded: 1,
              retrying: 0,
              failed: 0,
              jobs: [
                {
                  id: "job-1",
                  postId: "post-1",
                  beforeStatus: "pending",
                  afterStatus: "succeeded",
                  willRetry: false,
                  recoveredStaleLock: false,
                },
              ],
              requestedLimit: parsed.limit ?? null,
            },
          },
        };
      },
    },
    {
      method: "GET",
      path: /^\/api\/schedules\/[^/]+$/,
      respond: () => ({
        status: 200,
        body: {
          data: {
            id: "job-1",
            workspaceId: "ws-1",
            postId: "post-1",
            scheduledAt: new Date("2026-04-20T09:00:00+09:00").toISOString(),
            status: "failed",
            lockedAt: null,
            startedAt: new Date("2026-04-20T09:00:01+09:00").toISOString(),
            completedAt: new Date("2026-04-20T09:00:03+09:00").toISOString(),
            attemptCount: 3,
            maxAttempts: 3,
            lastError: "Invalid X credentials",
            nextRetryAt: null,
            createdAt: new Date("2026-04-19T09:00:00+09:00").toISOString(),
          },
          detail: {
            post: {
              id: "post-1",
              status: "failed",
              platform: "x",
              socialAccountId: "sa-1",
              contentText: "mock scheduled post",
              createdBy: "user-1",
            },
            retryPolicy: {
              maxAttempts: 3,
              backoffSeconds: [30, 120, 480],
              retryableRule: "temporary failures are retried automatically",
              nonRetryableRule: "validation/auth/resource issues stop immediately",
            },
            notificationTarget: {
              type: "post_creator",
              actorId: "user-1",
              label: "投稿作成者 (user-1)",
              reason: "owner should inspect credentials",
            },
            latestExecution: {
              id: "log-1",
              action: "schedule.execution.failed",
              status: "failed",
              createdAt: new Date("2026-04-20T09:00:03+09:00").toISOString(),
              actorId: "scheduler",
              actorType: "system",
              message: "stopped without retry",
              error: "Invalid X credentials",
              willRetry: false,
              retryable: false,
              retryRule: "non_retryable",
              classificationReason: "auth issue",
              attemptCount: 3,
              maxAttempts: 3,
              nextRetryAt: null,
              notificationTarget: {
                type: "post_creator",
                actorId: "user-1",
                label: "投稿作成者 (user-1)",
                reason: "owner should inspect credentials",
              },
            },
            executionLogs: [
              {
                id: "log-1",
                action: "schedule.execution.failed",
                status: "failed",
                createdAt: new Date("2026-04-20T09:00:03+09:00").toISOString(),
                actorId: "scheduler",
                actorType: "system",
                message: "stopped without retry",
                error: "Invalid X credentials",
                willRetry: false,
                retryable: false,
                retryRule: "non_retryable",
                classificationReason: "auth issue",
                attemptCount: 3,
                maxAttempts: 3,
                nextRetryAt: null,
                notificationTarget: {
                  type: "post_creator",
                  actorId: "user-1",
                  label: "投稿作成者 (user-1)",
                  reason: "owner should inspect credentials",
                },
              },
            ],
            recommendedAction: "投稿作成者が認証状態を確認してください。",
          },
        },
      }),
    },
    {
      method: "GET",
      path: /^\/api\/usage(\?|$)/,
      respond: () => ({
        status: 200,
        body: {
          data: [
            {
              period: "2026-04",
              platform: "x",
              requestCount: 10,
              successCount: 10,
              failureCount: 0,
              successRate: 1,
              estimatedCost: 0.5,
            },
          ],
          meta: {
            period: "monthly",
            from: new Date("2026-04-01").toISOString(),
            to: new Date("2026-05-01").toISOString(),
          },
        },
      }),
    },
  ]);
});

afterAll(async () => {
  await stopMockServer();
});

beforeEach(() => {
  routeHits = [];
});

describe("CLI integration", () => {
  it("a. `sns accounts list --json` returns JSON and exit code 0", async () => {
    const res = await runCli([
      "--api-url",
      `http://127.0.0.1:${mockPort}`,
      "--api-key",
      "test",
      "--json",
      "accounts",
      "list",
    ]);
    expect(res.exitCode).toBe(0);
    // --json mode: stdout must be parseable
    const parsed = JSON.parse(res.stdout) as { data: Array<{ platform: string }> } | unknown;
    // formatter shape may differ; accept either array or {data}
    if (Array.isArray(parsed)) {
      expect(parsed.length).toBeGreaterThan(0);
    } else if (parsed && typeof parsed === "object" && "data" in parsed) {
      const d = (parsed as { data: unknown }).data;
      expect(Array.isArray(d) || typeof d === "object").toBe(true);
    }
    // サーバーに GET /api/accounts が届いている
    expect(routeHits.some((h) => h.method === "GET" && h.url.startsWith("/api/accounts"))).toBe(
      true,
    );
  });

  it("b. `sns post create` creates a post", async () => {
    // --account は hex 16 文字以上で looksLikeId を通すと accounts.list の解決をスキップする
    const res = await runCli([
      "--api-url",
      `http://127.0.0.1:${mockPort}`,
      "--api-key",
      "test",
      "--json",
      "post",
      "create",
      "--platform",
      "x",
      "--account",
      "0123456789abcdef0123456789abcdef",
      "--text",
      "Hello from CLI test",
    ]);
    expect(res.exitCode).toBe(0);
    expect(routeHits.some((h) => h.method === "POST" && h.url.startsWith("/api/posts"))).toBe(true);
  });

  it("b-2. `sns post create --at` creates a draft and schedules it", async () => {
    const futureAt = new Date(Date.now() + 86400000).toISOString();
    const res = await runCli([
      "--api-url",
      `http://127.0.0.1:${mockPort}`,
      "--api-key",
      "test",
      "--json",
      "post",
      "create",
      "--platform",
      "x",
      "--account",
      "0123456789abcdef0123456789abcdef",
      "--text",
      "Scheduled from CLI test",
      "--at",
      futureAt,
    ]);

    expect(res.exitCode).toBe(0);
    expect(routeHits.some((h) => h.method === "POST" && h.url.startsWith("/api/posts"))).toBe(true);
    expect(routeHits.some((h) => h.method === "POST" && h.url.startsWith("/api/schedules"))).toBe(
      true,
    );
  });

  it("b-3. `sns post create` forwards quote/thread metadata for X", async () => {
    const res = await runCli([
      "--api-url",
      `http://127.0.0.1:${mockPort}`,
      "--api-key",
      "test",
      "--json",
      "post",
      "create",
      "--platform",
      "x",
      "--account",
      "0123456789abcdef0123456789abcdef",
      "--quote-post-id",
      "tweet-42",
      "--thread-segment",
      "follow-up 1",
      "--thread-segment",
      "follow-up 2",
    ]);

    expect(res.exitCode).toBe(0);
    const postRequest = routeHits.find(
      (h) => h.method === "POST" && h.url.startsWith("/api/posts"),
    );
    expect(postRequest).toBeDefined();
    const parsed = JSON.parse(postRequest?.body ?? "{}") as {
      providerMetadata?: {
        x?: {
          quotePostId?: string | null;
          threadPosts?: Array<{ contentText: string }>;
        };
      };
    };
    expect(parsed.providerMetadata?.x?.quotePostId).toBe("tweet-42");
    expect(parsed.providerMetadata?.x?.threadPosts).toEqual([
      { contentText: "follow-up 1" },
      { contentText: "follow-up 2" },
    ]);
  });

  it("c. `sns schedule create` creates a schedule", async () => {
    const futureAt = new Date(Date.now() + 86400000).toISOString();
    const res = await runCli([
      "--api-url",
      `http://127.0.0.1:${mockPort}`,
      "--api-key",
      "test",
      "--json",
      "schedule",
      "create",
      "--post",
      "post-1",
      "--at",
      futureAt,
    ]);
    expect(res.exitCode).toBe(0);
    expect(routeHits.some((h) => h.method === "POST" && h.url.startsWith("/api/schedules"))).toBe(
      true,
    );
  });

  it("d. `sns usage report --json` returns usage JSON", async () => {
    const res = await runCli([
      "--api-url",
      `http://127.0.0.1:${mockPort}`,
      "--api-key",
      "test",
      "--json",
      "usage",
      "report",
      "--range",
      "monthly",
    ]);
    expect(res.exitCode).toBe(0);
    expect(routeHits.some((h) => h.method === "GET" && h.url.startsWith("/api/usage"))).toBe(true);
  });

  it("e. `sns schedule run-due --limit 2` triggers manual dispatcher run", async () => {
    const res = await runCli([
      "--api-url",
      `http://127.0.0.1:${mockPort}`,
      "--api-key",
      "test",
      "--json",
      "schedule",
      "run-due",
      "--limit",
      "2",
    ]);
    expect(res.exitCode).toBe(0);
    expect(
      routeHits.some((h) => h.method === "POST" && h.url.startsWith("/api/schedules/run-due")),
    ).toBe(true);
  });

  it("e-2. `sns schedule show job-1` fetches enriched schedule detail", async () => {
    const res = await runCli([
      "--api-url",
      `http://127.0.0.1:${mockPort}`,
      "--api-key",
      "test",
      "schedule",
      "show",
      "job-1",
    ]);
    expect(res.exitCode).toBe(0);
    expect(routeHits.some((h) => h.method === "GET" && h.url === "/api/schedules/job-1")).toBe(
      true,
    );
    expect(res.stdout).toContain("Operations");
    expect(res.stdout).toContain("Execution logs");
  });

  it("e-3. `sns schedule logs job-1 --json` returns execution logs", async () => {
    const res = await runCli([
      "--api-url",
      `http://127.0.0.1:${mockPort}`,
      "--api-key",
      "test",
      "--json",
      "schedule",
      "logs",
      "job-1",
    ]);
    expect(res.exitCode).toBe(0);
    const parsed = JSON.parse(res.stdout) as { data: Array<{ status: string }> };
    expect(Array.isArray(parsed.data)).toBe(true);
    expect(parsed.data[0]?.status).toBe("failed");
  });

  it("f. unknown command exits with code 1", async () => {
    const res = await runCli([
      "--api-url",
      `http://127.0.0.1:${mockPort}`,
      "--api-key",
      "test",
      "bogus-command-xyz",
    ]);
    expect(res.exitCode).toBe(1);
  });
});
