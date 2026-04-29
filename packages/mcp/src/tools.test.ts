import { afterEach, describe, expect, it, vi } from "vitest";
import {
  X_HARNESS_MCP_TOOLS,
  createClientFromEnv,
  createToolCaller,
  type McpApiClient,
} from "./tools.js";
import { handleJsonRpcMessage } from "./index.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("X Harness MCP tool surface", () => {
  it("documents at least the 30-tool parity surface with argument schemas", () => {
    const names = X_HARNESS_MCP_TOOLS.map((tool) => tool.name);

    expect(names).toHaveLength(new Set(names).size);
    expect(names.length).toBeGreaterThanOrEqual(30);
    expect(names).toEqual(
      expect.arrayContaining([
        "posts_create",
        "dm_reply",
        "users_accounts_list",
        "followers_sync",
        "gates_verify",
        "campaigns_create",
        "staff_approvals_list",
        "sequences_create",
        "usage_summary",
      ]),
    );

    for (const tool of X_HARNESS_MCP_TOOLS) {
      expect(tool.inputSchema).toMatchObject({
        type: "object",
        properties: expect.any(Object),
      });
    }
  });

  it("validates required arguments before calling the API", async () => {
    const client: McpApiClient = {
      request: vi.fn(),
    };
    const callTool = createToolCaller(client);

    await expect(callTool("gates_verify", { username: "alice" })).rejects.toThrow(
      "gateId is required",
    );
    expect(client.request).not.toHaveBeenCalled();
  });

  it("calls API routes through the SDK client contract", async () => {
    const client: McpApiClient = {
      request: vi.fn(async () => ({ data: { eligible: true } })),
    };
    const callTool = createToolCaller(client);

    const result = await callTool("gates_verify", {
      gateId: "gate-1",
      username: "alice",
    });

    expect(result).toEqual({ data: { eligible: true } });
    expect(client.request).toHaveBeenCalledWith("GET", "/api/engagement-gates/gate-1/verify", {
      params: { username: "alice" },
    });
  });

  it("keeps route query defaults when optional arguments are omitted", async () => {
    const client: McpApiClient = {
      request: vi.fn(async () => ({ data: [] })),
    };
    const callTool = createToolCaller(client);

    await callTool("dm_threads_list", {});

    expect(client.request).toHaveBeenCalledWith("GET", "/api/inbox", {
      params: { platform: "x" },
      body: undefined,
    });
  });

  it("posts step sequence messages using the API contentText contract", async () => {
    const client: McpApiClient = {
      request: vi.fn(async () => ({ data: { id: "sequence-1" } })),
    };
    const callTool = createToolCaller(client);

    await callTool("sequences_create", {
      socialAccountId: "acct-1",
      name: "Warmup",
      messages: [{ delaySeconds: 60, actionType: "dm", contentText: "hello" }],
    });

    expect(client.request).toHaveBeenCalledWith("POST", "/api/step-sequences", {
      params: {},
      body: {
        socialAccountId: "acct-1",
        name: "Warmup",
        messages: [{ delaySeconds: 60, actionType: "dm", contentText: "hello" }],
      },
    });
  });

  it("handles discovery methods without creating the env-backed API client", async () => {
    vi.stubEnv("SNS_AGENT_API_URL", "");
    vi.stubEnv("SNS_API_URL", "");
    vi.stubEnv("SNS_AGENT_API_KEY", "");
    vi.stubEnv("SNS_API_KEY", "");

    await expect(handleJsonRpcMessage({ jsonrpc: "2.0", id: 1, method: "initialize" })).resolves
      .toMatchObject({
        result: { capabilities: { tools: {} } },
      });
    await expect(handleJsonRpcMessage({ jsonrpc: "2.0", id: 2, method: "ping" })).resolves
      .toMatchObject({
        result: {},
      });
    await expect(handleJsonRpcMessage({ jsonrpc: "2.0", id: 3, method: "tools/list" })).resolves
      .toMatchObject({
        result: { tools: X_HARNESS_MCP_TOOLS },
      });
  });

  it("requires env-backed API configuration only when a default tool call is executed", async () => {
    vi.stubEnv("SNS_AGENT_API_URL", "");
    vi.stubEnv("SNS_API_URL", "");
    vi.stubEnv("SNS_AGENT_API_KEY", "");
    vi.stubEnv("SNS_API_KEY", "");

    await expect(
      handleJsonRpcMessage({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "usage_summary", arguments: {} },
      }),
    ).resolves.toMatchObject({
      error: { code: -32000, message: "SNS_AGENT_API_URL is required" },
    });
  });

  it("builds the SDK client from MCP environment variables", () => {
    const client = createClientFromEnv({
      SNS_AGENT_API_URL: "http://localhost:3001",
      SNS_AGENT_API_KEY: "test-key",
    });

    expect(typeof client.request).toBe("function");
  });
});
