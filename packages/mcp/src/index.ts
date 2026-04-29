#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { X_HARNESS_MCP_TOOLS, createClientFromEnv, createToolCaller } from "./tools.js";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

function response(id: JsonRpcRequest["id"], result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function errorResponse(id: JsonRpcRequest["id"], code: number, message: string) {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code, message },
  };
}

export async function handleJsonRpcMessage(
  request: JsonRpcRequest,
  callTool?: ReturnType<typeof createToolCaller>,
) {
  try {
    if (request.method === "initialize") {
      return response(request.id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "@sns-agent/mcp", version: "0.0.0" },
      });
    }
    if (request.method === "notifications/initialized") {
      return null;
    }
    if (request.method === "ping") {
      return response(request.id, {});
    }
    if (request.method === "tools/list") {
      return response(request.id, { tools: X_HARNESS_MCP_TOOLS });
    }
    if (request.method === "tools/call") {
      const resolvedCallTool = callTool ?? createToolCaller(createClientFromEnv());
      const params = request.params ?? {};
      const name = typeof params.name === "string" ? params.name : "";
      const args =
        params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments)
          ? (params.arguments as Record<string, unknown>)
          : {};
      const result = await resolvedCallTool(name, args);
      return response(request.id, {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      });
    }
    return errorResponse(request.id, -32601, `Method not found: ${request.method}`);
  } catch (error) {
    return errorResponse(
      request.id,
      -32000,
      error instanceof Error ? error.message : "Unknown MCP server error",
    );
  }
}

function writeMessage(message: unknown): void {
  const body = JSON.stringify(message);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
}

export function startStdioServer(): void {
  let buffer = Buffer.alloc(0);

  process.stdin.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);

    while (buffer.length > 0) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;

      const header = buffer.subarray(0, headerEnd).toString("utf8");
      const lengthLine = header
        .split("\r\n")
        .find((line) => line.toLowerCase().startsWith("content-length:"));
      const contentLength = Number.parseInt(lengthLine?.split(":")[1]?.trim() ?? "", 10);
      if (!Number.isFinite(contentLength)) {
        buffer = Buffer.alloc(0);
        writeMessage(errorResponse(null, -32700, "Missing Content-Length header"));
        return;
      }

      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + contentLength;
      if (buffer.length < bodyEnd) return;

      const rawBody = buffer.subarray(bodyStart, bodyEnd).toString("utf8");
      buffer = buffer.subarray(bodyEnd);

      void handleJsonRpcMessage(JSON.parse(rawBody) as JsonRpcRequest).then((message) => {
        if (message) writeMessage(message);
      });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startStdioServer();
}

export { X_HARNESS_MCP_TOOLS, createClientFromEnv, createToolCaller } from "./tools.js";
