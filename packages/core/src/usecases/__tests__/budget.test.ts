/**
 * 予算ポリシーユースケース & 評価ロジックのテスト (Task 4004)
 *
 * - evaluateBudgetPolicy: scope 優先度、80% warn、block/require-approval/warn
 * - listPolicies / createPolicy / updatePolicy / deletePolicy
 * - getBudgetStatus
 */
import { describe, it, expect } from "vitest";
import type { BudgetPolicy, UsageRecord } from "../../domain/entities.js";
import type {
  BudgetPolicyRepository,
  UsageAggregation,
  UsageRepository,
} from "../../interfaces/repositories.js";
import { evaluateBudgetPolicy } from "../../policies/budget.js";
import {
  createPolicy,
  deletePolicy,
  getBudgetStatus,
  listPolicies,
  updatePolicy,
} from "../budget.js";
import type { BudgetUsecaseDeps } from "../budget.js";
import { NotFoundError, ValidationError } from "../../errors/domain-error.js";

// ───────────────────────────────────────────
// in-memory mocks
// ───────────────────────────────────────────

class InMemoryBudgetPolicyRepo implements BudgetPolicyRepository {
  items: BudgetPolicy[] = [];
  private counter = 0;

  async findById(id: string) {
    return this.items.find((i) => i.id === id) ?? null;
  }

  async findByWorkspace(workspaceId: string) {
    return this.items.filter((i) => i.workspaceId === workspaceId);
  }

  async create(input: Omit<BudgetPolicy, "id" | "createdAt" | "updatedAt">) {
    const now = new Date();
    const entity: BudgetPolicy = {
      ...input,
      id: `bp-${++this.counter}`,
      createdAt: now,
      updatedAt: now,
    };
    this.items.push(entity);
    return entity;
  }

  async update(id: string, data: Partial<BudgetPolicy>) {
    const idx = this.items.findIndex((i) => i.id === id);
    if (idx < 0) throw new Error(`not found: ${id}`);
    this.items[idx] = { ...this.items[idx], ...data, updatedAt: new Date() };
    return this.items[idx];
  }

  async delete(id: string) {
    this.items = this.items.filter((i) => i.id !== id);
  }
}

class InMemoryUsageRepo implements UsageRepository {
  records: UsageRecord[] = [];
  private counter = 0;

  async record(input: Omit<UsageRecord, "id" | "createdAt">) {
    const entity: UsageRecord = {
      ...input,
      id: `u-${++this.counter}`,
      createdAt: new Date(),
    };
    this.records.push(entity);
    return entity;
  }

  async aggregate(
    workspaceId: string,
    options: { platform?: string; endpoint?: string; startDate: Date; endDate: Date },
  ): Promise<UsageAggregation[]> {
    const rows = this.records.filter(
      (r) =>
        r.workspaceId === workspaceId &&
        r.recordedAt >= options.startDate &&
        r.recordedAt < options.endDate &&
        (!options.platform || r.platform === options.platform) &&
        (!options.endpoint || r.endpoint === options.endpoint),
    );
    const byPlatform = new Map<string, UsageAggregation>();
    for (const r of rows) {
      const prev = byPlatform.get(r.platform) ?? {
        platform: r.platform,
        totalRequests: 0,
        successCount: 0,
        failureCount: 0,
        totalCostUsd: 0,
      };
      prev.totalRequests += r.requestCount;
      if (r.success) prev.successCount += r.requestCount;
      else prev.failureCount += r.requestCount;
      prev.totalCostUsd += r.estimatedCostUsd ?? 0;
      byPlatform.set(r.platform, prev);
    }
    return Array.from(byPlatform.values());
  }
}

function createDeps(): BudgetUsecaseDeps & {
  budgetPolicyRepo: InMemoryBudgetPolicyRepo;
  usageRepo: InMemoryUsageRepo;
} {
  return {
    budgetPolicyRepo: new InMemoryBudgetPolicyRepo(),
    usageRepo: new InMemoryUsageRepo(),
  };
}

// ───────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────

async function seedUsage(
  repo: InMemoryUsageRepo,
  entries: Array<{
    platform: string;
    endpoint: string;
    cost: number;
    recordedAt: Date;
  }>,
) {
  for (const e of entries) {
    await repo.record({
      workspaceId: "ws-1",
      platform: e.platform,
      endpoint: e.endpoint,
      actorId: "user-1",
      actorType: "user",
      requestCount: 1,
      success: true,
      estimatedCostUsd: e.cost,
      recordedAt: e.recordedAt,
    });
  }
}

// ───────────────────────────────────────────
// evaluateBudgetPolicy
// ───────────────────────────────────────────

describe("evaluateBudgetPolicy", () => {
  const now = new Date("2026-04-10T12:00:00Z");

  it("returns allowed=true with no policies", async () => {
    const deps = createDeps();
    const ev = await evaluateBudgetPolicy(deps, {
      workspaceId: "ws-1",
      platform: "x",
      endpoint: "post.publish",
      additionalCost: 0.01,
      now,
    });
    expect(ev.allowed).toBe(true);
    expect(ev.action).toBe("warn");
    expect(ev.matchedPolicy).toBeNull();
    expect(ev.warning).toBe(false);
  });

  it("prefers endpoint scope over platform over workspace", async () => {
    const deps = createDeps();
    await deps.budgetPolicyRepo.create({
      workspaceId: "ws-1",
      scopeType: "workspace",
      scopeValue: null,
      period: "monthly",
      limitAmountUsd: 100,
      actionOnExceed: "warn",
    });
    await deps.budgetPolicyRepo.create({
      workspaceId: "ws-1",
      scopeType: "platform",
      scopeValue: "x",
      period: "monthly",
      limitAmountUsd: 50,
      actionOnExceed: "warn",
    });
    await deps.budgetPolicyRepo.create({
      workspaceId: "ws-1",
      scopeType: "endpoint",
      scopeValue: "post.publish",
      period: "monthly",
      limitAmountUsd: 10,
      actionOnExceed: "block",
    });

    const ev = await evaluateBudgetPolicy(deps, {
      workspaceId: "ws-1",
      platform: "x",
      endpoint: "post.publish",
      additionalCost: 0.001,
      now,
    });
    expect(ev.matchedPolicy?.scopeType).toBe("endpoint");
    expect(ev.limit).toBe(10);
  });

  it("blocks when projected > limit with action=block", async () => {
    const deps = createDeps();
    await deps.budgetPolicyRepo.create({
      workspaceId: "ws-1",
      scopeType: "workspace",
      scopeValue: null,
      period: "monthly",
      limitAmountUsd: 1,
      actionOnExceed: "block",
    });
    await seedUsage(deps.usageRepo, [
      {
        platform: "x",
        endpoint: "post.publish",
        cost: 0.9,
        recordedAt: new Date("2026-04-05T00:00:00Z"),
      },
    ]);

    const ev = await evaluateBudgetPolicy(deps, {
      workspaceId: "ws-1",
      platform: "x",
      endpoint: "post.publish",
      additionalCost: 0.5,
      now,
    });
    expect(ev.allowed).toBe(false);
    expect(ev.action).toBe("block");
    expect(ev.consumed).toBeCloseTo(0.9, 4);
    expect(ev.projected).toBeCloseTo(1.4, 4);
    expect(ev.percentage).toBeGreaterThan(1);
    expect(ev.warning).toBe(true);
  });

  it("returns require-approval when policy says so", async () => {
    const deps = createDeps();
    await deps.budgetPolicyRepo.create({
      workspaceId: "ws-1",
      scopeType: "workspace",
      scopeValue: null,
      period: "monthly",
      limitAmountUsd: 1,
      actionOnExceed: "require-approval",
    });
    await seedUsage(deps.usageRepo, [
      {
        platform: "x",
        endpoint: "post.publish",
        cost: 1.1,
        recordedAt: new Date("2026-04-05T00:00:00Z"),
      },
    ]);

    const ev = await evaluateBudgetPolicy(deps, {
      workspaceId: "ws-1",
      platform: "x",
      endpoint: "post.publish",
      additionalCost: 0.0,
      now,
    });
    expect(ev.allowed).toBe(true);
    expect(ev.action).toBe("require-approval");
  });

  it("warns at 80% even when policy action is block (not yet exceeded)", async () => {
    const deps = createDeps();
    await deps.budgetPolicyRepo.create({
      workspaceId: "ws-1",
      scopeType: "workspace",
      scopeValue: null,
      period: "monthly",
      limitAmountUsd: 10,
      actionOnExceed: "block",
    });
    await seedUsage(deps.usageRepo, [
      {
        platform: "x",
        endpoint: "post.publish",
        cost: 8.0,
        recordedAt: new Date("2026-04-05T00:00:00Z"),
      },
    ]);

    const ev = await evaluateBudgetPolicy(deps, {
      workspaceId: "ws-1",
      platform: "x",
      endpoint: "post.publish",
      additionalCost: 0.1,
      now,
    });
    expect(ev.allowed).toBe(true);
    expect(ev.action).toBe("warn");
    expect(ev.warning).toBe(true);
    expect(ev.percentage).toBeCloseTo(0.81, 2);
  });

  it("ignores usage outside current period", async () => {
    const deps = createDeps();
    await deps.budgetPolicyRepo.create({
      workspaceId: "ws-1",
      scopeType: "workspace",
      scopeValue: null,
      period: "monthly",
      limitAmountUsd: 10,
      actionOnExceed: "block",
    });
    // 先月の消費は含めない
    await seedUsage(deps.usageRepo, [
      {
        platform: "x",
        endpoint: "post.publish",
        cost: 50,
        recordedAt: new Date("2026-03-15T00:00:00Z"),
      },
    ]);

    const ev = await evaluateBudgetPolicy(deps, {
      workspaceId: "ws-1",
      platform: "x",
      endpoint: "post.publish",
      additionalCost: 0.0,
      now,
    });
    expect(ev.consumed).toBe(0);
    expect(ev.warning).toBe(false);
  });
});

// ───────────────────────────────────────────
// listPolicies / createPolicy / updatePolicy / deletePolicy
// ───────────────────────────────────────────

describe("listPolicies", () => {
  it("returns policies for the workspace", async () => {
    const deps = createDeps();
    await deps.budgetPolicyRepo.create({
      workspaceId: "ws-1",
      scopeType: "workspace",
      scopeValue: null,
      period: "monthly",
      limitAmountUsd: 10,
      actionOnExceed: "warn",
    });
    await deps.budgetPolicyRepo.create({
      workspaceId: "ws-2",
      scopeType: "workspace",
      scopeValue: null,
      period: "monthly",
      limitAmountUsd: 10,
      actionOnExceed: "warn",
    });
    const list = await listPolicies(deps, "ws-1");
    expect(list).toHaveLength(1);
    expect(list[0].workspaceId).toBe("ws-1");
  });
});

describe("createPolicy", () => {
  it("creates a workspace-scoped policy with scopeValue=null", async () => {
    const deps = createDeps();
    const created = await createPolicy(deps, {
      workspaceId: "ws-1",
      scopeType: "workspace",
      period: "monthly",
      limitAmountUsd: 5,
      actionOnExceed: "warn",
    });
    expect(created.scopeValue).toBeNull();
  });

  it("requires scopeValue for platform scope", async () => {
    const deps = createDeps();
    await expect(
      createPolicy(deps, {
        workspaceId: "ws-1",
        scopeType: "platform",
        period: "monthly",
        limitAmountUsd: 5,
        actionOnExceed: "warn",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects non-positive limit", async () => {
    const deps = createDeps();
    await expect(
      createPolicy(deps, {
        workspaceId: "ws-1",
        scopeType: "workspace",
        period: "monthly",
        limitAmountUsd: 0,
        actionOnExceed: "warn",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("updatePolicy", () => {
  it("updates limit for owned policy", async () => {
    const deps = createDeps();
    const created = await createPolicy(deps, {
      workspaceId: "ws-1",
      scopeType: "workspace",
      period: "monthly",
      limitAmountUsd: 5,
      actionOnExceed: "warn",
    });
    const updated = await updatePolicy(deps, "ws-1", created.id, {
      limitAmountUsd: 20,
    });
    expect(updated.limitAmountUsd).toBe(20);
  });

  it("throws NotFoundError for foreign workspace", async () => {
    const deps = createDeps();
    const created = await createPolicy(deps, {
      workspaceId: "ws-1",
      scopeType: "workspace",
      period: "monthly",
      limitAmountUsd: 5,
      actionOnExceed: "warn",
    });
    await expect(
      updatePolicy(deps, "ws-2", created.id, { limitAmountUsd: 20 }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("deletePolicy", () => {
  it("removes the policy", async () => {
    const deps = createDeps();
    const created = await createPolicy(deps, {
      workspaceId: "ws-1",
      scopeType: "workspace",
      period: "monthly",
      limitAmountUsd: 5,
      actionOnExceed: "warn",
    });
    await deletePolicy(deps, "ws-1", created.id);
    const list = await listPolicies(deps, "ws-1");
    expect(list).toHaveLength(0);
  });

  it("throws NotFoundError for foreign workspace", async () => {
    const deps = createDeps();
    const created = await createPolicy(deps, {
      workspaceId: "ws-1",
      scopeType: "workspace",
      period: "monthly",
      limitAmountUsd: 5,
      actionOnExceed: "warn",
    });
    await expect(deletePolicy(deps, "ws-2", created.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

// ───────────────────────────────────────────
// getBudgetStatus
// ───────────────────────────────────────────

describe("getBudgetStatus", () => {
  const now = new Date("2026-04-10T12:00:00Z");

  it("returns consumed / limit / percentage for each policy", async () => {
    const deps = createDeps();
    await deps.budgetPolicyRepo.create({
      workspaceId: "ws-1",
      scopeType: "platform",
      scopeValue: "x",
      period: "monthly",
      limitAmountUsd: 10,
      actionOnExceed: "warn",
    });
    await seedUsage(deps.usageRepo, [
      {
        platform: "x",
        endpoint: "post.publish",
        cost: 8.0,
        recordedAt: new Date("2026-04-05T00:00:00Z"),
      },
      {
        platform: "line",
        endpoint: "message.push",
        cost: 5.0,
        recordedAt: new Date("2026-04-06T00:00:00Z"),
      },
    ]);

    const result = await getBudgetStatus(deps, "ws-1", now);
    expect(result.data).toHaveLength(1);
    const entry = result.data[0];
    expect(entry.consumed).toBeCloseTo(8.0, 4);
    expect(entry.limit).toBe(10);
    expect(entry.percentage).toBeCloseTo(0.8, 2);
    expect(entry.warning).toBe(true);
    expect(entry.exceeded).toBe(false);
  });

  it("marks exceeded=true when consumed >= limit", async () => {
    const deps = createDeps();
    await deps.budgetPolicyRepo.create({
      workspaceId: "ws-1",
      scopeType: "workspace",
      scopeValue: null,
      period: "monthly",
      limitAmountUsd: 5,
      actionOnExceed: "block",
    });
    await seedUsage(deps.usageRepo, [
      {
        platform: "x",
        endpoint: "post.publish",
        cost: 6.0,
        recordedAt: new Date("2026-04-05T00:00:00Z"),
      },
    ]);

    const result = await getBudgetStatus(deps, "ws-1", now);
    expect(result.data[0].exceeded).toBe(true);
    expect(result.data[0].warning).toBe(false);
  });
});
