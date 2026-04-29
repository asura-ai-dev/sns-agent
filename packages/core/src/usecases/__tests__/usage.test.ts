/**
 * 使用量ユースケースのテスト (Task 4003)
 *
 * recordUsage / getUsageReport / getUsageSummary
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { UsageRecord } from "../../domain/entities.js";
import type { UsageRepository, UsageAggregation } from "../../interfaces/repositories.js";
import {
  recordUsage,
  getUsageReport,
  getUsageSummary,
  formatPeriodKey,
  getMonthStart,
  getMonthEnd,
} from "../usage.js";
import type { UsageUsecaseDeps } from "../usage.js";
import { ValidationError } from "../../errors/domain-error.js";

// ───────────────────────────────────────────
// モック UsageRepository
// ───────────────────────────────────────────
function createMockUsageRepo(initial: UsageRecord[] = []): UsageRepository & {
  records: UsageRecord[];
} {
  const records: UsageRecord[] = [...initial];
  return {
    records,
    async record(input) {
      const rec: UsageRecord = {
        ...input,
        id: `u-${records.length + 1}`,
        createdAt: new Date(),
      };
      records.push(rec);
      return rec;
    },
    async aggregate(workspaceId, options) {
      const filtered = records.filter(
        (r) =>
          r.workspaceId === workspaceId &&
          r.recordedAt >= options.startDate &&
          r.recordedAt < options.endDate &&
          (!options.platform || r.platform === options.platform) &&
          (!options.endpoint || r.endpoint === options.endpoint) &&
          (!(options as { gateId?: string }).gateId ||
            (r as UsageRecord & { gateId?: string | null }).gateId ===
              (options as { gateId?: string }).gateId),
      );
      const dimension = (options as { dimension?: "platform" | "endpoint" | "gate" }).dimension;
      const byDimension = new Map<string, UsageAggregation>();
      for (const r of filtered) {
        const gateId = (r as UsageRecord & { gateId?: string | null }).gateId ?? null;
        const dimensionValue =
          dimension === "endpoint" ? r.endpoint : dimension === "gate" ? gateId : r.platform;
        if (!dimensionValue) continue;
        const prev = byDimension.get(dimensionValue) ?? {
          platform: r.platform,
          ...(dimension === "endpoint" ? { endpoint: dimensionValue } : {}),
          ...(dimension === "gate" ? { gateId: dimensionValue } : {}),
          totalRequests: 0,
          successCount: 0,
          failureCount: 0,
          totalCostUsd: 0,
        };
        prev.totalRequests += r.requestCount;
        if (r.success) prev.successCount += r.requestCount;
        else prev.failureCount += r.requestCount;
        prev.totalCostUsd += r.estimatedCostUsd ?? 0;
        byDimension.set(dimensionValue, prev);
      }
      return Array.from(byDimension.values());
    },
  };
}

function createDeps(repo: UsageRepository): UsageUsecaseDeps {
  return { usageRepo: repo };
}

// ───────────────────────────────────────────
// recordUsage
// ───────────────────────────────────────────
describe("recordUsage", () => {
  it("should insert a usage record with defaults", async () => {
    const repo = createMockUsageRepo();
    const deps = createDeps(repo);
    const rec = await recordUsage(deps, {
      workspaceId: "ws-1",
      platform: "x",
      endpoint: "tweet.create",
      actorId: "user-1",
      actorType: "user",
      success: true,
      estimatedCostUsd: 0.001,
    });
    expect(rec.id).toBeTruthy();
    expect(rec.requestCount).toBe(1);
    expect(rec.platform).toBe("x");
    expect(rec.success).toBe(true);
    expect(repo.records).toHaveLength(1);
  });

  it("should preserve optional X usage dimension metadata", async () => {
    const repo = createMockUsageRepo();
    const deps = createDeps(repo);
    const rec = await recordUsage(deps, {
      workspaceId: "ws-1",
      platform: "x",
      endpoint: "engagement.gate.deliver",
      actorId: "user-1",
      actorType: "user",
      success: true,
      estimatedCostUsd: 0.002,
      gateId: "gate-1",
      feature: "engagement_gate",
    } as Parameters<typeof recordUsage>[1] & { gateId: string; feature: string });

    expect(rec).toMatchObject({
      gateId: "gate-1",
      feature: "engagement_gate",
    });
    expect(repo.records[0]).toMatchObject({
      gateId: "gate-1",
      feature: "engagement_gate",
    });
  });

  it("should reject missing workspaceId", async () => {
    const repo = createMockUsageRepo();
    const deps = createDeps(repo);
    await expect(
      recordUsage(deps, {
        workspaceId: "",
        platform: "x",
        endpoint: "tweet.create",
        actorId: null,
        actorType: "user",
        success: true,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

// ───────────────────────────────────────────
// getUsageReport
// ───────────────────────────────────────────
describe("getUsageReport", () => {
  const now = new Date("2026-03-15T12:00:00.000Z");

  beforeEach(() => {
    // nothing
  });

  it("should aggregate by daily buckets and platform", async () => {
    const repo = createMockUsageRepo();
    const deps = createDeps(repo);
    // 同じ日に 2 件 (x), 別の日に 1 件 (line)
    await recordUsage(deps, {
      workspaceId: "ws-1",
      platform: "x",
      endpoint: "tweet.create",
      actorId: null,
      actorType: "user",
      success: true,
      estimatedCostUsd: 0.001,
      recordedAt: new Date("2026-03-14T10:00:00.000Z"),
    });
    await recordUsage(deps, {
      workspaceId: "ws-1",
      platform: "x",
      endpoint: "tweet.create",
      actorId: null,
      actorType: "user",
      success: false,
      estimatedCostUsd: 0.001,
      recordedAt: new Date("2026-03-14T11:00:00.000Z"),
    });
    await recordUsage(deps, {
      workspaceId: "ws-1",
      platform: "line",
      endpoint: "messaging.push",
      actorId: null,
      actorType: "user",
      success: true,
      estimatedCostUsd: 0.0001,
      recordedAt: new Date("2026-03-15T09:00:00.000Z"),
    });

    const report = await getUsageReport(deps, "ws-1", {
      period: "daily",
      from: new Date("2026-03-13T00:00:00.000Z"),
      to: new Date("2026-03-16T00:00:00.000Z"),
    });

    expect(report.period).toBe("daily");
    // entries contain buckets with data
    const keys = report.data.map((d) => `${d.period}:${d.platform}`);
    expect(keys).toContain("2026-03-14:x");
    expect(keys).toContain("2026-03-15:line");
    const xEntry = report.data.find((d) => d.period === "2026-03-14" && d.platform === "x");
    expect(xEntry?.requestCount).toBe(2);
    expect(xEntry?.successCount).toBe(1);
    expect(xEntry?.failureCount).toBe(1);
    expect(xEntry?.successRate).toBeCloseTo(0.5);
  });

  it("should filter by platform", async () => {
    const repo = createMockUsageRepo();
    const deps = createDeps(repo);
    await recordUsage(deps, {
      workspaceId: "ws-1",
      platform: "x",
      endpoint: "tweet.create",
      actorId: null,
      actorType: "user",
      success: true,
      estimatedCostUsd: 0.001,
      recordedAt: new Date("2026-03-14T10:00:00.000Z"),
    });
    await recordUsage(deps, {
      workspaceId: "ws-1",
      platform: "line",
      endpoint: "messaging.push",
      actorId: null,
      actorType: "user",
      success: true,
      estimatedCostUsd: 0.0001,
      recordedAt: new Date("2026-03-14T11:00:00.000Z"),
    });
    const report = await getUsageReport(deps, "ws-1", {
      period: "daily",
      platform: "x",
      from: new Date("2026-03-13T00:00:00.000Z"),
      to: new Date("2026-03-16T00:00:00.000Z"),
    });
    const platforms = new Set(report.data.map((d) => d.platform));
    expect(platforms).toEqual(new Set(["x"]));
  });

  it("should aggregate daily usage by endpoint dimension", async () => {
    const repo = createMockUsageRepo();
    const deps = createDeps(repo);
    await recordUsage(deps, {
      workspaceId: "ws-1",
      platform: "x",
      endpoint: "inbox.reply",
      actorId: null,
      actorType: "user",
      success: true,
      estimatedCostUsd: 0.001,
      recordedAt: new Date("2026-03-14T10:00:00.000Z"),
    });
    await recordUsage(deps, {
      workspaceId: "ws-1",
      platform: "x",
      endpoint: "inbox.reply",
      actorId: null,
      actorType: "user",
      success: false,
      estimatedCostUsd: 0.001,
      recordedAt: new Date("2026-03-14T11:00:00.000Z"),
    });
    await recordUsage(deps, {
      workspaceId: "ws-1",
      platform: "x",
      endpoint: "inbox.list",
      actorId: null,
      actorType: "user",
      success: true,
      estimatedCostUsd: 0.0005,
      recordedAt: new Date("2026-03-14T12:00:00.000Z"),
    });

    const report = await getUsageReport(deps, "ws-1", {
      period: "daily",
      platform: "x",
      from: new Date("2026-03-14T00:00:00.000Z"),
      to: new Date("2026-03-15T00:00:00.000Z"),
      dimension: "endpoint",
    } as Parameters<typeof getUsageReport>[2] & { dimension: "endpoint" });

    const replyEntry = report.data.find(
      (d) =>
        d.period === "2026-03-14" &&
        d.platform === "x" &&
        (d as typeof d & { endpoint?: string }).endpoint === "inbox.reply",
    );
    expect(replyEntry).toMatchObject({
      endpoint: "inbox.reply",
      requestCount: 2,
      successCount: 1,
      failureCount: 1,
      successRate: 0.5,
    });
    expect(
      report.data.some((d) => (d as typeof d & { endpoint?: string }).endpoint === "inbox.list"),
    ).toBe(true);
  });

  it("should aggregate daily usage by gate dimension", async () => {
    const repo = createMockUsageRepo([
      {
        id: "usage-1",
        workspaceId: "ws-1",
        platform: "x",
        endpoint: "engagement.gate.deliver",
        actorId: null,
        actorType: "agent",
        requestCount: 2,
        success: true,
        estimatedCostUsd: 0.004,
        recordedAt: new Date("2026-03-14T10:00:00.000Z"),
        createdAt: new Date("2026-03-14T10:00:00.000Z"),
        gateId: "gate-1",
        feature: "engagement_gate",
      } as UsageRecord & { gateId: string; feature: string },
      {
        id: "usage-2",
        workspaceId: "ws-1",
        platform: "x",
        endpoint: "engagement.gate.deliver",
        actorId: null,
        actorType: "agent",
        requestCount: 1,
        success: false,
        estimatedCostUsd: 0.002,
        recordedAt: new Date("2026-03-14T11:00:00.000Z"),
        createdAt: new Date("2026-03-14T11:00:00.000Z"),
        gateId: "gate-2",
        feature: "engagement_gate",
      } as UsageRecord & { gateId: string; feature: string },
    ]);
    const deps = createDeps(repo);

    const report = await getUsageReport(deps, "ws-1", {
      period: "daily",
      platform: "x",
      from: new Date("2026-03-14T00:00:00.000Z"),
      to: new Date("2026-03-15T00:00:00.000Z"),
      dimension: "gate",
    } as Parameters<typeof getUsageReport>[2] & { dimension: "gate" });

    expect(report.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          period: "2026-03-14",
          platform: "x",
          gateId: "gate-1",
          requestCount: 2,
          successCount: 2,
        }),
        expect.objectContaining({
          period: "2026-03-14",
          platform: "x",
          gateId: "gate-2",
          requestCount: 1,
          failureCount: 1,
        }),
      ]),
    );
  });

  it("should support monthly period", async () => {
    const repo = createMockUsageRepo();
    const deps = createDeps(repo);
    await recordUsage(deps, {
      workspaceId: "ws-1",
      platform: "openai",
      endpoint: "gpt-4o",
      actorId: null,
      actorType: "agent",
      success: true,
      estimatedCostUsd: 0.05,
      recordedAt: new Date("2026-02-10T00:00:00.000Z"),
    });
    await recordUsage(deps, {
      workspaceId: "ws-1",
      platform: "openai",
      endpoint: "gpt-4o",
      actorId: null,
      actorType: "agent",
      success: true,
      estimatedCostUsd: 0.05,
      recordedAt: new Date("2026-03-10T00:00:00.000Z"),
    });

    const report = await getUsageReport(deps, "ws-1", {
      period: "monthly",
      from: new Date("2026-01-01T00:00:00.000Z"),
      to: new Date("2026-04-01T00:00:00.000Z"),
    });
    const feb = report.data.find((d) => d.period === "2026-02");
    const mar = report.data.find((d) => d.period === "2026-03");
    expect(feb?.requestCount).toBe(1);
    expect(mar?.requestCount).toBe(1);
  });

  it("should reject from > to", async () => {
    const repo = createMockUsageRepo();
    const deps = createDeps(repo);
    await expect(
      getUsageReport(deps, "ws-1", {
        period: "daily",
        from: new Date("2026-03-20T00:00:00.000Z"),
        to: new Date("2026-03-10T00:00:00.000Z"),
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

// ───────────────────────────────────────────
// getUsageSummary
// ───────────────────────────────────────────
describe("getUsageSummary", () => {
  it("should return this-month totals grouped by platform", async () => {
    const now = new Date("2026-04-15T12:00:00.000Z");
    const repo = createMockUsageRepo();
    const deps = createDeps(repo);
    // within month
    await recordUsage(deps, {
      workspaceId: "ws-1",
      platform: "x",
      endpoint: "tweet.create",
      actorId: null,
      actorType: "user",
      success: true,
      estimatedCostUsd: 0.001,
      recordedAt: new Date("2026-04-10T00:00:00.000Z"),
    });
    await recordUsage(deps, {
      workspaceId: "ws-1",
      platform: "x",
      endpoint: "tweet.create",
      actorId: null,
      actorType: "user",
      success: false,
      estimatedCostUsd: 0.001,
      recordedAt: new Date("2026-04-11T00:00:00.000Z"),
    });
    await recordUsage(deps, {
      workspaceId: "ws-1",
      platform: "line",
      endpoint: "messaging.push",
      actorId: null,
      actorType: "user",
      success: true,
      estimatedCostUsd: 0.0001,
      recordedAt: new Date("2026-04-12T00:00:00.000Z"),
    });
    // outside month (previous)
    await recordUsage(deps, {
      workspaceId: "ws-1",
      platform: "x",
      endpoint: "tweet.create",
      actorId: null,
      actorType: "user",
      success: true,
      estimatedCostUsd: 0.001,
      recordedAt: new Date("2026-03-30T00:00:00.000Z"),
    });

    const summary = await getUsageSummary(deps, "ws-1", now);
    expect(summary.totalRequests).toBe(3);
    expect(summary.byPlatform.x?.totalRequests).toBe(2);
    expect(summary.byPlatform.line?.totalRequests).toBe(1);
    // 2 out of 3 succeeded
    expect(summary.successRate).toBeCloseTo(2 / 3);
    expect(summary.totalCost).toBeCloseTo(0.001 + 0.001 + 0.0001, 6);
    expect(summary.range.from.toISOString()).toBe("2026-04-01T00:00:00.000Z");
    expect(summary.range.to.toISOString()).toBe("2026-05-01T00:00:00.000Z");
  });

  it("should return zeros when no data", async () => {
    const repo = createMockUsageRepo();
    const deps = createDeps(repo);
    const summary = await getUsageSummary(deps, "ws-1", new Date("2026-04-15T00:00:00.000Z"));
    expect(summary.totalRequests).toBe(0);
    expect(summary.totalCost).toBe(0);
    expect(summary.successRate).toBe(0);
    expect(summary.byPlatform).toEqual({});
  });
});

// ───────────────────────────────────────────
// helpers
// ───────────────────────────────────────────
describe("period helpers", () => {
  it("formatPeriodKey daily", () => {
    expect(formatPeriodKey(new Date("2026-03-14T00:00:00.000Z"), "daily")).toBe("2026-03-14");
  });
  it("formatPeriodKey monthly", () => {
    expect(formatPeriodKey(new Date("2026-03-14T00:00:00.000Z"), "monthly")).toBe("2026-03");
  });
  it("formatPeriodKey weekly returns YYYY-Www", () => {
    const key = formatPeriodKey(new Date("2026-03-14T00:00:00.000Z"), "weekly");
    expect(key).toMatch(/^2026-W\d{2}$/);
  });
  it("getMonthStart/getMonthEnd", () => {
    const now = new Date("2026-04-15T12:34:56.000Z");
    expect(getMonthStart(now).toISOString()).toBe("2026-04-01T00:00:00.000Z");
    expect(getMonthEnd(now).toISOString()).toBe("2026-05-01T00:00:00.000Z");
  });
});
