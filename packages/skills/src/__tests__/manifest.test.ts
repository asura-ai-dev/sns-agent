/**
 * Skill manifest バリデーションの単体テスト
 * Task 5002
 */
import { describe, it, expect } from "vitest";
import { validateSkillManifest, findSkillAction, type SkillManifest } from "../manifest/types.js";

function baseManifest(overrides: Partial<SkillManifest> = {}): SkillManifest {
  return {
    name: "sns-agent-x",
    version: "0.1.0",
    platform: "x",
    provider: "openai",
    description: "X (Twitter) skill pack",
    actions: [
      {
        name: "post.create",
        description: "Create a new post",
        parameters: {
          type: "object",
          properties: {
            text: { type: "string", minLength: 1, maxLength: 280 },
          },
          required: ["text"],
        },
        permissions: ["post:create"],
        requiredCapabilities: ["textPost"],
      },
    ],
    ...overrides,
  };
}

describe("validateSkillManifest", () => {
  it("accepts a well-formed manifest", () => {
    const result = validateSkillManifest(baseManifest());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects non-object input", () => {
    expect(validateSkillManifest(null).valid).toBe(false);
    expect(validateSkillManifest("not an object").valid).toBe(false);
  });

  it("rejects invalid name", () => {
    const result = validateSkillManifest(baseManifest({ name: "Invalid NAME!" }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("name"))).toBe(true);
  });

  it("rejects invalid version", () => {
    const result = validateSkillManifest(baseManifest({ version: "v1" }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("version"))).toBe(true);
  });

  it("rejects unknown platform", () => {
    const result = validateSkillManifest(
      baseManifest({ platform: "tiktok" as unknown as SkillManifest["platform"] }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("platform"))).toBe(true);
  });

  it("rejects empty actions", () => {
    const result = validateSkillManifest(baseManifest({ actions: [] }));
    expect(result.valid).toBe(false);
  });

  it("rejects duplicated action names", () => {
    const m = baseManifest();
    m.actions = [m.actions[0], { ...m.actions[0] }];
    const result = validateSkillManifest(m);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("duplicated"))).toBe(true);
  });
});

describe("findSkillAction", () => {
  it("returns action when present", () => {
    const m = baseManifest();
    const action = findSkillAction(m, "post.create");
    expect(action?.name).toBe("post.create");
  });

  it("returns null when missing", () => {
    const m = baseManifest();
    expect(findSkillAction(m, "post.delete")).toBeNull();
  });
});
