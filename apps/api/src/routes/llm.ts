/**
 * LLM ルーティングルート (Task 5001)
 * design.md セクション 4.2: /api/llm/routes
 *
 * - GET    /api/llm/routes       : ルート一覧         (llm:read, admin+)
 * - POST   /api/llm/routes       : ルート作成         (llm:manage, admin+)
 * - PATCH  /api/llm/routes/:id   : ルート更新         (llm:manage, admin+)
 * - DELETE /api/llm/routes/:id   : ルート削除         (llm:manage, admin+)
 *
 * 仕様:
 *  - platform / action が NULL の行は「デフォルトルート」を表す
 *  - priority は降順で優先度付けに用いる
 *  - fallback_provider + fallback_model はオプション
 */
import { Hono } from "hono";
import {
  ValidationError,
  NotFoundError,
  getLlmProviderStatus,
  disconnectLlmProvider,
} from "@sns-agent/core";
import type { LlmRoute, LlmProviderStatusResult } from "@sns-agent/core";
import { DrizzleLlmRouteRepository, DrizzleLlmProviderCredentialRepository } from "@sns-agent/db";
import { requirePermission } from "../middleware/rbac.js";
import type { AppVariables } from "../types.js";

const llm = new Hono<{ Variables: AppVariables }>();

// ───────────────────────────────────────────
// シリアライザ
// ───────────────────────────────────────────

function serializeRoute(route: LlmRoute): Record<string, unknown> {
  return {
    id: route.id,
    workspaceId: route.workspaceId,
    platform: route.platform,
    action: route.action,
    provider: route.provider,
    model: route.model,
    temperature: route.temperature,
    maxTokens: route.maxTokens,
    fallbackProvider: route.fallbackProvider,
    fallbackModel: route.fallbackModel,
    priority: route.priority,
    createdAt: route.createdAt.toISOString(),
    updatedAt: route.updatedAt.toISOString(),
  };
}

function serializeProviderStatus(status: LlmProviderStatusResult): Record<string, unknown> {
  return {
    provider: status.provider,
    status: status.status,
    connected: status.connected,
    requiresReauth: status.requiresReauth,
    reason: status.reason,
    expiresAt: status.expiresAt ? status.expiresAt.toISOString() : null,
    scopes: status.scopes,
    subject: status.subject,
    metadata: status.metadata,
    updatedAt: status.updatedAt ? status.updatedAt.toISOString() : null,
  };
}

// ───────────────────────────────────────────
// バリデーション
// ───────────────────────────────────────────

interface CreateBody {
  platform?: string | null;
  action?: string | null;
  provider?: string;
  model?: string;
  temperature?: number | null;
  maxTokens?: number | null;
  fallbackProvider?: string | null;
  fallbackModel?: string | null;
  priority?: number;
}

function validateCreateBody(body: unknown): {
  platform: string | null;
  action: string | null;
  provider: string;
  model: string;
  temperature: number | null;
  maxTokens: number | null;
  fallbackProvider: string | null;
  fallbackModel: string | null;
  priority: number;
} {
  if (typeof body !== "object" || body === null) {
    throw new ValidationError("Request body must be a JSON object");
  }
  const b = body as CreateBody;
  if (typeof b.provider !== "string" || b.provider.trim() === "") {
    throw new ValidationError("provider is required");
  }
  if (typeof b.model !== "string" || b.model.trim() === "") {
    throw new ValidationError("model is required");
  }
  if (
    b.temperature !== undefined &&
    b.temperature !== null &&
    (typeof b.temperature !== "number" || b.temperature < 0 || b.temperature > 2)
  ) {
    throw new ValidationError("temperature must be a number between 0 and 2");
  }
  if (
    b.maxTokens !== undefined &&
    b.maxTokens !== null &&
    (typeof b.maxTokens !== "number" || b.maxTokens <= 0 || !Number.isInteger(b.maxTokens))
  ) {
    throw new ValidationError("maxTokens must be a positive integer");
  }
  if (
    b.priority !== undefined &&
    (typeof b.priority !== "number" || !Number.isInteger(b.priority))
  ) {
    throw new ValidationError("priority must be an integer");
  }
  // fallback: 両方指定 or 両方未指定
  const hasFbProv = b.fallbackProvider !== undefined && b.fallbackProvider !== null;
  const hasFbModel = b.fallbackModel !== undefined && b.fallbackModel !== null;
  if (hasFbProv !== hasFbModel) {
    throw new ValidationError(
      "fallbackProvider and fallbackModel must be specified together (or both omitted)",
    );
  }

  return {
    platform: typeof b.platform === "string" && b.platform.length > 0 ? b.platform : null,
    action: typeof b.action === "string" && b.action.length > 0 ? b.action : null,
    provider: b.provider,
    model: b.model,
    temperature: typeof b.temperature === "number" ? b.temperature : null,
    maxTokens: typeof b.maxTokens === "number" ? b.maxTokens : null,
    fallbackProvider: hasFbProv ? (b.fallbackProvider as string) : null,
    fallbackModel: hasFbModel ? (b.fallbackModel as string) : null,
    priority: typeof b.priority === "number" ? b.priority : 0,
  };
}

function validateUpdateBody(body: unknown): Partial<LlmRoute> {
  if (typeof body !== "object" || body === null) {
    throw new ValidationError("Request body must be a JSON object");
  }
  const b = body as CreateBody;
  const patch: Partial<LlmRoute> = {};

  if (b.platform !== undefined) {
    patch.platform = typeof b.platform === "string" && b.platform.length > 0 ? b.platform : null;
  }
  if (b.action !== undefined) {
    patch.action = typeof b.action === "string" && b.action.length > 0 ? b.action : null;
  }
  if (b.provider !== undefined) {
    if (typeof b.provider !== "string" || b.provider.trim() === "") {
      throw new ValidationError("provider must be a non-empty string");
    }
    patch.provider = b.provider;
  }
  if (b.model !== undefined) {
    if (typeof b.model !== "string" || b.model.trim() === "") {
      throw new ValidationError("model must be a non-empty string");
    }
    patch.model = b.model;
  }
  if (b.temperature !== undefined) {
    if (
      b.temperature !== null &&
      (typeof b.temperature !== "number" || b.temperature < 0 || b.temperature > 2)
    ) {
      throw new ValidationError("temperature must be a number between 0 and 2");
    }
    patch.temperature = b.temperature;
  }
  if (b.maxTokens !== undefined) {
    if (
      b.maxTokens !== null &&
      (typeof b.maxTokens !== "number" || b.maxTokens <= 0 || !Number.isInteger(b.maxTokens))
    ) {
      throw new ValidationError("maxTokens must be a positive integer");
    }
    patch.maxTokens = b.maxTokens;
  }
  if (b.fallbackProvider !== undefined) {
    patch.fallbackProvider = b.fallbackProvider;
  }
  if (b.fallbackModel !== undefined) {
    patch.fallbackModel = b.fallbackModel;
  }
  if (b.priority !== undefined) {
    if (typeof b.priority !== "number" || !Number.isInteger(b.priority)) {
      throw new ValidationError("priority must be an integer");
    }
    patch.priority = b.priority;
  }
  return patch;
}

// ───────────────────────────────────────────
// GET /api/llm/providers/openai-codex/status - 接続状態
// ───────────────────────────────────────────
llm.get("/providers/openai-codex/status", requirePermission("llm:read"), async (c) => {
  const actor = c.get("actor");
  const db = c.get("db");
  const credentialRepo = new DrizzleLlmProviderCredentialRepository(db);
  const status = await getLlmProviderStatus(
    { credentialRepo },
    { workspaceId: actor.workspaceId, provider: "openai-codex" },
  );
  return c.json({ data: serializeProviderStatus(status) });
});

// ───────────────────────────────────────────
// DELETE /api/llm/providers/openai-codex/disconnect - 接続解除
// ───────────────────────────────────────────
llm.delete("/providers/openai-codex/disconnect", requirePermission("llm:manage"), async (c) => {
  const actor = c.get("actor");
  const db = c.get("db");
  const credentialRepo = new DrizzleLlmProviderCredentialRepository(db);
  const status = await disconnectLlmProvider(
    { credentialRepo },
    { workspaceId: actor.workspaceId, provider: "openai-codex" },
  );
  return c.json({ data: serializeProviderStatus(status) });
});

// ───────────────────────────────────────────
// GET /api/llm/routes - 一覧
// ───────────────────────────────────────────
llm.get("/routes", requirePermission("llm:read"), async (c) => {
  const actor = c.get("actor");
  const db = c.get("db");
  const repo = new DrizzleLlmRouteRepository(db);
  const routes = await repo.findByWorkspace(actor.workspaceId);
  return c.json({ data: routes.map(serializeRoute) });
});

// ───────────────────────────────────────────
// POST /api/llm/routes - 作成
// ───────────────────────────────────────────
llm.post("/routes", requirePermission("llm:manage"), async (c) => {
  const actor = c.get("actor");
  const db = c.get("db");
  const repo = new DrizzleLlmRouteRepository(db);

  const body = await c.req.json().catch(() => {
    throw new ValidationError("Invalid JSON body");
  });
  const input = validateCreateBody(body);

  const created = await repo.create({
    workspaceId: actor.workspaceId,
    platform: input.platform,
    action: input.action,
    provider: input.provider,
    model: input.model,
    temperature: input.temperature,
    maxTokens: input.maxTokens,
    fallbackProvider: input.fallbackProvider,
    fallbackModel: input.fallbackModel,
    priority: input.priority,
  });

  return c.json({ data: serializeRoute(created) }, 201);
});

// ───────────────────────────────────────────
// PATCH /api/llm/routes/:id - 更新
// ───────────────────────────────────────────
llm.patch("/routes/:id", requirePermission("llm:manage"), async (c) => {
  const actor = c.get("actor");
  const db = c.get("db");
  const repo = new DrizzleLlmRouteRepository(db);
  const id = c.req.param("id");

  // workspace スコープで所有確認 (別 workspace の route を触れないよう防御)
  const existing = await repo.findByWorkspace(actor.workspaceId);
  const target = existing.find((r) => r.id === id);
  if (!target) {
    throw new NotFoundError("LlmRoute", id);
  }

  const body = await c.req.json().catch(() => {
    throw new ValidationError("Invalid JSON body");
  });
  const patch = validateUpdateBody(body);

  const updated = await repo.update(id, patch);
  return c.json({ data: serializeRoute(updated) });
});

// ───────────────────────────────────────────
// DELETE /api/llm/routes/:id - 削除
// ───────────────────────────────────────────
llm.delete("/routes/:id", requirePermission("llm:manage"), async (c) => {
  const actor = c.get("actor");
  const db = c.get("db");
  const repo = new DrizzleLlmRouteRepository(db);
  const id = c.req.param("id");

  // workspace スコープで所有確認
  const existing = await repo.findByWorkspace(actor.workspaceId);
  const target = existing.find((r) => r.id === id);
  if (!target) {
    throw new NotFoundError("LlmRoute", id);
  }

  await repo.delete(id);
  return c.body(null, 204);
});

export { llm };
