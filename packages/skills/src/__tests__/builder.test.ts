/**
 * Skill Package Builder + Manifest Parser テスト (Task 5003)
 */
import { describe, it, expect } from "vitest";
import { ProviderRegistry, type ProviderCapabilities } from "@sns-agent/core";
import {
  generateSkillPackage,
  buildSkillPackageName,
  BUILTIN_ACTION_TEMPLATES,
} from "../builder/index.js";
import {
  parseManifest,
  validateManifest,
  checkVersionCompatibility,
  SKILL_MANIFEST_RUNTIME_VERSION,
} from "../manifest/parser.js";
import { validateSkillManifest } from "../manifest/types.js";

// ───────────────────────────────────────────
// テスト用の最小 Provider
// ───────────────────────────────────────────

function makeFakeProvider(
  platform: "x" | "line" | "instagram",
  capabilities: Partial<ProviderCapabilities> = {},
) {
  const caps: ProviderCapabilities = {
    textPost: true,
    imagePost: true,
    videoPost: false,
    threadPost: false,
    directMessage: false,
    commentReply: false,
    broadcast: false,
    nativeSchedule: false,
    usageApi: false,
    ...capabilities,
  };
  return {
    platform,
    getCapabilities: () => caps,
    connectAccount: async () => ({}),
    validatePost: async () => ({ valid: true, errors: [], warnings: [] }),
    publishPost: async () => ({ success: true, platformPostId: null, publishedAt: null }),
    deletePost: async () => ({ success: true }),
  };
}

function makeRegistry(...providers: ReturnType<typeof makeFakeProvider>[]) {
  const reg = new ProviderRegistry();
  for (const p of providers) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    reg.register(p as any);
  }
  return reg;
}

// ───────────────────────────────────────────
// generateSkillPackage
// ───────────────────────────────────────────

describe("generateSkillPackage", () => {
  it("generates a manifest for X with textPost capability", () => {
    const reg = makeRegistry(makeFakeProvider("x", { textPost: true }));
    const manifest = generateSkillPackage(
      { providerRegistry: reg },
      { platform: "x", llmProvider: "openai" },
    );

    expect(manifest.name).toBe("sns-agent-x-openai");
    expect(manifest.platform).toBe("x");
    expect(manifest.provider).toBe("openai");
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+/);

    // X 向け最小セット 5 つが含まれる
    const names = manifest.actions.map((a) => a.name).sort();
    expect(names).toEqual([
      "inbox.list",
      "post.create",
      "post.list",
      "post.schedule",
      "schedule.list",
    ]);

    // validateSkillManifest で通る
    expect(validateSkillManifest(manifest).valid).toBe(true);
  });

  it("excludes textPost-dependent actions when capability is missing", () => {
    const reg = makeRegistry(makeFakeProvider("x", { textPost: false }));
    const manifest = generateSkillPackage(
      { providerRegistry: reg },
      { platform: "x", llmProvider: "anthropic" },
    );
    const names = manifest.actions.map((a) => a.name).sort();
    // textPost が無いので post.create / post.schedule は除外され、
    // read-only の一覧系のみ残る
    expect(names).toEqual(["inbox.list", "post.list", "schedule.list"]);
  });

  it("throws when provider is not registered", () => {
    const reg = makeRegistry(); // empty
    expect(() =>
      generateSkillPackage({ providerRegistry: reg }, { platform: "x", llmProvider: "openai" }),
    ).toThrow(/not registered/);
  });

  it("throws on unknown platform", () => {
    const reg = makeRegistry();
    expect(() =>
      generateSkillPackage(
        { providerRegistry: reg },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { platform: "tiktok" as any, llmProvider: "openai" },
      ),
    ).toThrow(/platform must be one of/);
  });

  it("throws when llmProvider is empty", () => {
    const reg = makeRegistry(makeFakeProvider("x"));
    expect(() =>
      generateSkillPackage({ providerRegistry: reg }, { platform: "x", llmProvider: "" }),
    ).toThrow(/llmProvider/);
  });

  it("supports LINE and Instagram", () => {
    const reg = makeRegistry(
      makeFakeProvider("line", { textPost: true }),
      makeFakeProvider("instagram", { textPost: true }),
    );
    const line = generateSkillPackage(
      { providerRegistry: reg },
      { platform: "line", llmProvider: "openai" },
    );
    const ig = generateSkillPackage(
      { providerRegistry: reg },
      { platform: "instagram", llmProvider: "openai" },
    );
    expect(line.name).toBe("sns-agent-line-openai");
    expect(ig.name).toBe("sns-agent-instagram-openai");
    expect(line.actions.length).toBeGreaterThan(0);
    expect(ig.actions.length).toBeGreaterThan(0);
  });

  it("buildSkillPackageName sanitizes provider name", () => {
    expect(buildSkillPackageName("x", "Open AI!")).toBe("sns-agent-x-open-ai-");
  });

  it("BUILTIN_ACTION_TEMPLATES contains expected core actions", () => {
    const names = BUILTIN_ACTION_TEMPLATES.map((t) => t.action.name).sort();
    expect(names).toEqual([
      "inbox.list",
      "post.create",
      "post.list",
      "post.schedule",
      "schedule.list",
    ]);
  });
});

// ───────────────────────────────────────────
// parseManifest / validateManifest
// ───────────────────────────────────────────

describe("parseManifest", () => {
  const valid = {
    name: "sns-agent-x-openai",
    version: "0.1.0",
    platform: "x",
    provider: "openai",
    description: "X skill",
    actions: [
      {
        name: "post.list",
        description: "List posts",
        parameters: { type: "object", properties: {}, required: [] },
        permissions: ["post:read"],
        requiredCapabilities: [],
        readOnly: true,
      },
    ],
  };

  it("parses a valid JSON string", () => {
    const m = parseManifest(JSON.stringify(valid));
    expect(m.name).toBe("sns-agent-x-openai");
  });

  it("parses a valid object", () => {
    const m = parseManifest(valid);
    expect(m.actions.length).toBe(1);
  });

  it("throws on malformed JSON", () => {
    expect(() => parseManifest("{not json")).toThrow(/Failed to parse/);
  });

  it("throws on invalid manifest structure", () => {
    expect(() => parseManifest({ ...valid, version: "v1" })).toThrow(/Invalid skill manifest/);
  });
});

describe("validateManifest", () => {
  it("returns the manifest on success", () => {
    const m = validateManifest({
      name: "sns-agent-x-openai",
      version: "0.1.0",
      platform: "x",
      provider: "openai",
      description: "ok",
      actions: [
        {
          name: "post.list",
          description: "list",
          parameters: { type: "object", properties: {}, required: [] },
          permissions: [],
          requiredCapabilities: [],
        },
      ],
    });
    expect(m.name).toBe("sns-agent-x-openai");
  });

  it("throws when invalid", () => {
    expect(() => validateManifest({})).toThrow(/Invalid skill manifest/);
  });
});

// ───────────────────────────────────────────
// checkVersionCompatibility
// ───────────────────────────────────────────

describe("checkVersionCompatibility", () => {
  it("matches the same version", () => {
    const r = checkVersionCompatibility("0.1.0", "0.1.0");
    expect(r.compatible).toBe(true);
  });

  it("matches same 0.x.minor with different patch", () => {
    const r = checkVersionCompatibility("0.1.5", "0.1.0");
    expect(r.compatible).toBe(true);
  });

  it("rejects 0.x with different minor", () => {
    const r = checkVersionCompatibility("0.2.0", "0.1.0");
    expect(r.compatible).toBe(false);
    expect(r.reason).toMatch(/minor version mismatch/);
  });

  it("matches same major >=1", () => {
    const r = checkVersionCompatibility("1.5.0", "1.0.0");
    expect(r.compatible).toBe(true);
  });

  it("rejects different major", () => {
    const r = checkVersionCompatibility("2.0.0", "1.0.0");
    expect(r.compatible).toBe(false);
    expect(r.reason).toMatch(/major version mismatch/);
  });

  it("rejects non-semver", () => {
    expect(checkVersionCompatibility("v1", "0.1.0").compatible).toBe(false);
  });

  it("uses runtime constant by default", () => {
    expect(checkVersionCompatibility(SKILL_MANIFEST_RUNTIME_VERSION).compatible).toBe(true);
  });
});
