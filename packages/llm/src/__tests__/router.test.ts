/**
 * Router unit tests
 *
 * resolveLlmRoute の priority 解決、executeLlmCall の fallback 経路、
 * usage 記録の連携を検証する。
 */
import { describe, it, expect, vi } from "vitest";
import { LlmError } from "@sns-agent/core";
import type { LlmRoute, LlmRouteRepository, UsageRecord } from "@sns-agent/core";
import type { LlmAdapter, ChatMessage, ChatResponse } from "../types.js";
import { resolveLlmRoute, executeLlmCall } from "../router.js";

// ───────────────────────────────────────────
// テスト用 Repository モック
// ───────────────────────────────────────────

function makeRoute(overrides: Partial<LlmRoute>): LlmRoute {
  const now = new Date();
  return {
    id: overrides.id ?? "r1",
    workspaceId: "w1",
    platform: null,
    action: null,
    provider: "openai",
    model: "gpt-4o-mini",
    temperature: null,
    maxTokens: null,
    fallbackProvider: null,
    fallbackModel: null,
    priority: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeRepo(routes: LlmRoute[]): LlmRouteRepository {
  return {
    findByWorkspace: async () => routes,
    resolve: async () => null,
    create: async () => routes[0],
    update: async () => routes[0],
    delete: async () => {},
  };
}

// ───────────────────────────────────────────
// resolveLlmRoute
// ───────────────────────────────────────────

describe("resolveLlmRoute", () => {
  it("returns null when no routes exist", async () => {
    const repo = makeRepo([]);
    const result = await resolveLlmRoute(repo, "w1");
    expect(result).toBeNull();
  });

  it("picks the default route when no platform/action specified", async () => {
    const defaultRoute = makeRoute({ id: "default", provider: "openai", model: "gpt-4o-mini" });
    const repo = makeRepo([defaultRoute]);
    const result = await resolveLlmRoute(repo, "w1");
    expect(result?.route.id).toBe("default");
    expect(result?.primary.provider).toBe("openai");
  });

  it("prefers platform+action over platform-only over default", async () => {
    const defaultRoute = makeRoute({ id: "default", model: "default-model" });
    const platformRoute = makeRoute({
      id: "platform",
      platform: "x",
      model: "platform-model",
    });
    const exactRoute = makeRoute({
      id: "exact",
      platform: "x",
      action: "post.create",
      model: "exact-model",
    });
    const repo = makeRepo([defaultRoute, platformRoute, exactRoute]);

    const r1 = await resolveLlmRoute(repo, "w1", { platform: "x", action: "post.create" });
    expect(r1?.route.id).toBe("exact");

    const r2 = await resolveLlmRoute(repo, "w1", { platform: "x", action: "other" });
    expect(r2?.route.id).toBe("platform");

    const r3 = await resolveLlmRoute(repo, "w1", { platform: "line" });
    expect(r3?.route.id).toBe("default");
  });

  it("breaks ties by priority descending", async () => {
    const lowPri = makeRoute({ id: "low", platform: "x", priority: 1, model: "low" });
    const highPri = makeRoute({ id: "high", platform: "x", priority: 10, model: "high" });
    const repo = makeRepo([lowPri, highPri]);
    const result = await resolveLlmRoute(repo, "w1", { platform: "x" });
    expect(result?.route.id).toBe("high");
  });

  it("excludes routes whose platform/action does not match", async () => {
    const lineRoute = makeRoute({ id: "line", platform: "line", model: "line-model" });
    const defaultRoute = makeRoute({ id: "default", model: "default-model" });
    const repo = makeRepo([lineRoute, defaultRoute]);
    const result = await resolveLlmRoute(repo, "w1", { platform: "x" });
    expect(result?.route.id).toBe("default");
  });

  it("returns fallback info when route has fallback_provider + fallback_model", async () => {
    const route = makeRoute({
      id: "r",
      provider: "openai",
      model: "gpt-4o",
      fallbackProvider: "anthropic",
      fallbackModel: "claude-3-5-sonnet-latest",
    });
    const repo = makeRepo([route]);
    const result = await resolveLlmRoute(repo, "w1");
    expect(result?.fallback).toEqual({
      provider: "anthropic",
      model: "claude-3-5-sonnet-latest",
    });
  });

  it("returns null fallback when only one of fallback_provider / fallback_model is set", async () => {
    const route = makeRoute({
      id: "r",
      fallbackProvider: "anthropic",
      fallbackModel: null,
    });
    const repo = makeRepo([route]);
    const result = await resolveLlmRoute(repo, "w1");
    expect(result?.fallback).toBeNull();
  });
});

// ───────────────────────────────────────────
// executeLlmCall
// ───────────────────────────────────────────

function makeMockAdapter(
  provider: string,
  handler: (messages: ChatMessage[]) => Promise<ChatResponse>,
): LlmAdapter {
  return {
    provider,
    chat: vi.fn(handler),
    stream: () => {
      throw new Error("not used in test");
    },
  };
}

function makeRecordingUsageRepo(): {
  usageRepo: {
    record: (u: Omit<UsageRecord, "id" | "createdAt">) => Promise<UsageRecord>;
    aggregate: () => Promise<never[]>;
  };
  records: Array<Omit<UsageRecord, "id" | "createdAt">>;
} {
  const records: Array<Omit<UsageRecord, "id" | "createdAt">> = [];
  return {
    records,
    usageRepo: {
      record: async (input) => {
        records.push(input);
        const now = new Date();
        return { id: `u${records.length}`, createdAt: now, ...input };
      },
      aggregate: async () => [],
    },
  };
}

describe("executeLlmCall", () => {
  const messages: ChatMessage[] = [{ role: "user", content: "hello" }];

  it("calls primary adapter and records success usage", async () => {
    const openAi = makeMockAdapter("openai", async () => ({
      content: "hi there",
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      model: "gpt-4o-mini",
    }));
    const { usageRepo, records } = makeRecordingUsageRepo();
    const route = makeRoute({
      provider: "openai",
      model: "gpt-4o-mini",
      temperature: 0.2,
    });

    const response = await executeLlmCall(
      {
        usageRepo,
        adapters: { openai: openAi },
        actor: { workspaceId: "w1", actorId: "u1", actorType: "user" },
      },
      {
        route,
        primary: {
          provider: "openai",
          model: "gpt-4o-mini",
          temperature: 0.2,
          maxTokens: null,
        },
        fallback: null,
      },
      messages,
    );

    expect(response.content).toBe("hi there");
    expect(records).toHaveLength(1);
    expect(records[0].platform).toBe("openai");
    expect(records[0].endpoint).toBe("gpt-4o-mini");
    expect(records[0].success).toBe(true);
    expect(records[0].estimatedCostUsd).toBeGreaterThan(0);
    expect(openAi.chat).toHaveBeenCalledOnce();
  });

  it("falls back to secondary adapter when primary throws", async () => {
    const primary = makeMockAdapter("openai", async () => {
      throw new LlmError("LLM_API_ERROR", "primary failed", "openai");
    });
    const fallback = makeMockAdapter("anthropic", async () => ({
      content: "from fallback",
      usage: { promptTokens: 8, completionTokens: 4, totalTokens: 12 },
      model: "claude-3-5-haiku",
    }));
    const { usageRepo, records } = makeRecordingUsageRepo();

    const response = await executeLlmCall(
      {
        usageRepo,
        adapters: { openai: primary, anthropic: fallback },
        actor: { workspaceId: "w1", actorId: null, actorType: "agent" },
      },
      {
        route: makeRoute({}),
        primary: { provider: "openai", model: "gpt-4o", temperature: null, maxTokens: null },
        fallback: { provider: "anthropic", model: "claude-3-5-haiku" },
      },
      messages,
    );

    expect(response.content).toBe("from fallback");
    // 2 records: primary failure + fallback success
    expect(records).toHaveLength(2);
    expect(records[0].success).toBe(false);
    expect(records[0].platform).toBe("openai");
    expect(records[1].success).toBe(true);
    expect(records[1].platform).toBe("anthropic");
  });

  it("throws when primary fails and no fallback is configured", async () => {
    const primary = makeMockAdapter("openai", async () => {
      throw new LlmError("LLM_API_ERROR", "primary failed", "openai");
    });
    const { usageRepo, records } = makeRecordingUsageRepo();

    await expect(
      executeLlmCall(
        {
          usageRepo,
          adapters: { openai: primary },
          actor: { workspaceId: "w1", actorId: "u1", actorType: "user" },
        },
        {
          route: makeRoute({}),
          primary: { provider: "openai", model: "gpt-4o", temperature: null, maxTokens: null },
          fallback: null,
        },
        messages,
      ),
    ).rejects.toBeInstanceOf(LlmError);

    expect(records).toHaveLength(1);
    expect(records[0].success).toBe(false);
  });

  it("throws when both primary and fallback fail", async () => {
    const primary = makeMockAdapter("openai", async () => {
      throw new LlmError("LLM_API_ERROR", "primary failed", "openai");
    });
    const fallback = makeMockAdapter("anthropic", async () => {
      throw new LlmError("LLM_API_ERROR", "fallback failed", "anthropic");
    });
    const { usageRepo, records } = makeRecordingUsageRepo();

    await expect(
      executeLlmCall(
        {
          usageRepo,
          adapters: { openai: primary, anthropic: fallback },
          actor: { workspaceId: "w1", actorId: "u1", actorType: "user" },
        },
        {
          route: makeRoute({}),
          primary: { provider: "openai", model: "gpt-4o", temperature: null, maxTokens: null },
          fallback: { provider: "anthropic", model: "claude-3-5-haiku" },
        },
        messages,
      ),
    ).rejects.toBeInstanceOf(LlmError);

    expect(records).toHaveLength(2);
    expect(records.every((r) => r.success === false)).toBe(true);
  });

  it("throws LLM_UNSUPPORTED_PROVIDER when adapter is missing", async () => {
    const { usageRepo } = makeRecordingUsageRepo();

    await expect(
      executeLlmCall(
        {
          usageRepo,
          adapters: {},
          actor: { workspaceId: "w1", actorId: "u1", actorType: "user" },
        },
        {
          route: makeRoute({}),
          primary: { provider: "openai", model: "gpt-4o", temperature: null, maxTokens: null },
          fallback: null,
        },
        messages,
      ),
    ).rejects.toMatchObject({ code: "LLM_UNSUPPORTED_PROVIDER" });
  });
});
