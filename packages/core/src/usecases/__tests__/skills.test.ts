/**
 * Skills ユースケースのテスト (Task 5003)
 */
import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import type { SkillPackage } from "../../domain/entities.js";
import type { SkillPackageRepository } from "../../interfaces/repositories.js";
import {
  listSkillPackages,
  generateSkillPackage,
  enableSkillPackage,
  disableSkillPackage,
  getSkillManifest,
  getActiveSkills,
  type SkillsUsecaseDeps,
  type SkillManifestLike,
} from "../skills.js";
import { ValidationError, NotFoundError } from "../../errors/domain-error.js";

// ───────────────────────────────────────────
// in-memory repo
// ───────────────────────────────────────────

class InMemorySkillPackageRepo implements SkillPackageRepository {
  items: SkillPackage[] = [];

  async findById(id: string) {
    return this.items.find((p) => p.id === id) ?? null;
  }
  async findByWorkspace(workspaceId: string, onlyEnabled = false) {
    return this.items.filter((p) => p.workspaceId === workspaceId && (!onlyEnabled || p.enabled));
  }
  async findByName(workspaceId: string, name: string) {
    return this.items.find((p) => p.workspaceId === workspaceId && p.name === name) ?? null;
  }
  async create(pkg: Omit<SkillPackage, "id" | "createdAt" | "updatedAt">) {
    const created: SkillPackage = {
      ...pkg,
      id: randomUUID(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.items.push(created);
    return created;
  }
  async update(id: string, data: Partial<SkillPackage>) {
    const idx = this.items.findIndex((p) => p.id === id);
    if (idx < 0) throw new Error("not found");
    const updated = { ...this.items[idx], ...data, updatedAt: new Date() };
    this.items[idx] = updated;
    return updated;
  }
  async delete(id: string) {
    this.items = this.items.filter((p) => p.id !== id);
  }
}

function fakeManifest(platform: string, llmProvider: string): SkillManifestLike {
  return {
    name: `sns-agent-${platform}-${llmProvider}`,
    version: "0.1.0",
    platform,
    provider: llmProvider,
    description: "test",
    actions: [
      {
        name: "post.list",
        description: "list",
        parameters: { type: "object", properties: {}, required: [] },
        permissions: ["post:read"],
        requiredCapabilities: [],
        readOnly: true,
      },
    ],
  };
}

let repo: InMemorySkillPackageRepo;
let deps: SkillsUsecaseDeps;
let builderCalls: Array<{ platform: string; llmProvider: string }>;

beforeEach(() => {
  repo = new InMemorySkillPackageRepo();
  builderCalls = [];
  deps = {
    skillPackageRepo: repo,
    manifestBuilder: (input) => {
      builderCalls.push(input);
      return fakeManifest(input.platform, input.llmProvider);
    },
  };
});

// ───────────────────────────────────────────
// listSkillPackages
// ───────────────────────────────────────────

describe("listSkillPackages", () => {
  it("returns packages for the workspace", async () => {
    await repo.create({
      workspaceId: "ws1",
      name: "sns-agent-x-openai",
      version: "0.1.0",
      platform: "x",
      llmProvider: "openai",
      manifest: {},
      enabled: false,
    });
    await repo.create({
      workspaceId: "ws2",
      name: "sns-agent-x-openai",
      version: "0.1.0",
      platform: "x",
      llmProvider: "openai",
      manifest: {},
      enabled: false,
    });
    const list = await listSkillPackages(deps, "ws1");
    expect(list).toHaveLength(1);
    expect(list[0].workspaceId).toBe("ws1");
  });

  it("filters by enabled when onlyEnabled=true", async () => {
    await repo.create({
      workspaceId: "ws1",
      name: "a",
      version: "0.1.0",
      platform: "x",
      llmProvider: "openai",
      manifest: {},
      enabled: true,
    });
    await repo.create({
      workspaceId: "ws1",
      name: "b",
      version: "0.1.0",
      platform: "x",
      llmProvider: "openai",
      manifest: {},
      enabled: false,
    });
    expect(await listSkillPackages(deps, "ws1", { onlyEnabled: true })).toHaveLength(1);
    expect(await listSkillPackages(deps, "ws1")).toHaveLength(2);
  });

  it("throws on empty workspaceId", async () => {
    await expect(listSkillPackages(deps, "")).rejects.toBeInstanceOf(ValidationError);
  });
});

// ───────────────────────────────────────────
// generateSkillPackage
// ───────────────────────────────────────────

describe("generateSkillPackage usecase", () => {
  it("creates a new package via manifestBuilder", async () => {
    const created = await generateSkillPackage(deps, {
      workspaceId: "ws1",
      platform: "x",
      llmProvider: "openai",
    });
    expect(created.name).toBe("sns-agent-x-openai");
    expect(created.workspaceId).toBe("ws1");
    expect(created.enabled).toBe(false);
    expect(created.manifest).toBeDefined();
    expect(builderCalls).toEqual([{ platform: "x", llmProvider: "openai" }]);
  });

  it("updates existing package idempotently and preserves enabled state", async () => {
    const first = await generateSkillPackage(deps, {
      workspaceId: "ws1",
      platform: "x",
      llmProvider: "openai",
    });
    // 有効化
    await enableSkillPackage(deps, { packageId: first.id, workspaceId: "ws1" });
    // 再度生成 → 同じ id で更新される + enabled は維持
    const second = await generateSkillPackage(deps, {
      workspaceId: "ws1",
      platform: "x",
      llmProvider: "openai",
    });
    expect(second.id).toBe(first.id);
    expect(second.enabled).toBe(true);
    // repo に 1 件しかない
    expect(await listSkillPackages(deps, "ws1")).toHaveLength(1);
  });

  it("throws on missing platform / llmProvider", async () => {
    await expect(
      generateSkillPackage(deps, {
        workspaceId: "ws1",
        platform: "",
        llmProvider: "openai",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      generateSkillPackage(deps, {
        workspaceId: "ws1",
        platform: "x",
        llmProvider: "",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws when manifestBuilder returns invalid output", async () => {
    const badDeps: SkillsUsecaseDeps = {
      skillPackageRepo: repo,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      manifestBuilder: () => ({}) as any,
    };
    await expect(
      generateSkillPackage(badDeps, {
        workspaceId: "ws1",
        platform: "x",
        llmProvider: "openai",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

// ───────────────────────────────────────────
// enable / disable / getSkillManifest / getActiveSkills
// ───────────────────────────────────────────

describe("enable/disable + manifest + active", () => {
  it("toggles enabled flag", async () => {
    const created = await generateSkillPackage(deps, {
      workspaceId: "ws1",
      platform: "x",
      llmProvider: "openai",
    });
    expect(created.enabled).toBe(false);
    const enabled = await enableSkillPackage(deps, {
      packageId: created.id,
      workspaceId: "ws1",
    });
    expect(enabled.enabled).toBe(true);
    const disabled = await disableSkillPackage(deps, {
      packageId: created.id,
      workspaceId: "ws1",
    });
    expect(disabled.enabled).toBe(false);
  });

  it("rejects cross-workspace enable/disable", async () => {
    const created = await generateSkillPackage(deps, {
      workspaceId: "ws1",
      platform: "x",
      llmProvider: "openai",
    });
    await expect(
      enableSkillPackage(deps, { packageId: created.id, workspaceId: "ws2" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("getSkillManifest returns the stored manifest", async () => {
    const created = await generateSkillPackage(deps, {
      workspaceId: "ws1",
      platform: "x",
      llmProvider: "openai",
    });
    const result = await getSkillManifest(deps, {
      packageId: created.id,
      workspaceId: "ws1",
    });
    expect(result.package.id).toBe(created.id);
    expect((result.manifest as Record<string, unknown>).name).toBe("sns-agent-x-openai");
  });

  it("getSkillManifest rejects cross-workspace", async () => {
    const created = await generateSkillPackage(deps, {
      workspaceId: "ws1",
      platform: "x",
      llmProvider: "openai",
    });
    await expect(
      getSkillManifest(deps, { packageId: created.id, workspaceId: "ws2" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("getActiveSkills returns only enabled packages", async () => {
    const a = await generateSkillPackage(deps, {
      workspaceId: "ws1",
      platform: "x",
      llmProvider: "openai",
    });
    await generateSkillPackage(deps, {
      workspaceId: "ws1",
      platform: "line",
      llmProvider: "openai",
    });
    await enableSkillPackage(deps, { packageId: a.id, workspaceId: "ws1" });
    const active = await getActiveSkills(deps, "ws1");
    expect(active).toHaveLength(1);
    expect(active[0].platform).toBe("x");
  });
});
