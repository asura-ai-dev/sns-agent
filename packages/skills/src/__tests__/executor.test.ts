/**
 * Skill executor の単体テスト
 * Task 5002
 */
import { describe, it, expect, vi } from "vitest";
import {
  validateSkillAction,
  checkSkillPermissions,
  executeSkillAction,
  dryRunSkillAction,
  type SkillExecutionContext,
  type SkillActionInvoker,
} from "../runtime/executor.js";
import type { SkillManifest } from "../manifest/types.js";

function makeManifest(): SkillManifest {
  return {
    name: "sns-agent-x",
    version: "0.1.0",
    platform: "x",
    provider: "openai",
    description: "X skill pack",
    actions: [
      {
        name: "post.create",
        description: "Create a new post on X",
        parameters: {
          type: "object",
          properties: {
            text: { type: "string", minLength: 1, maxLength: 280 },
            draftOnly: { type: "boolean" },
          },
          required: ["text"],
        },
        permissions: ["post:create"],
        requiredCapabilities: ["textPost"],
      },
      {
        name: "post.list",
        description: "List recent posts",
        parameters: {
          type: "object",
          properties: {
            limit: { type: "integer", minimum: 1, maximum: 100 },
          },
        },
        permissions: ["post:read"],
        requiredCapabilities: [],
        readOnly: true,
      },
    ],
  };
}

function ctx(overrides: Partial<SkillExecutionContext> = {}): SkillExecutionContext {
  return {
    workspaceId: "ws-1",
    manifest: makeManifest(),
    actionName: "post.create",
    args: { text: "hello world" },
    actor: { id: "u-1", role: "editor", type: "user" },
    mode: "approval-required",
    ...overrides,
  };
}

describe("validateSkillAction", () => {
  it("passes for valid args", () => {
    const r = validateSkillAction(makeManifest(), "post.create", { text: "hello" });
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("fails when required field missing", () => {
    const r = validateSkillAction(makeManifest(), "post.create", {});
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("text"))).toBe(true);
  });

  it("fails when string exceeds maxLength", () => {
    const r = validateSkillAction(makeManifest(), "post.create", {
      text: "x".repeat(300),
    });
    expect(r.valid).toBe(false);
  });

  it("throws for unknown action", () => {
    expect(() => validateSkillAction(makeManifest(), "post.unknown", {})).toThrow();
  });
});

describe("checkSkillPermissions", () => {
  it("allows role with required permission", () => {
    const r = checkSkillPermissions(makeManifest(), "post.create", "editor");
    expect(r.allowed).toBe(true);
    expect(r.missing).toEqual([]);
  });

  it("blocks role without required permission", () => {
    const r = checkSkillPermissions(makeManifest(), "post.create", "viewer");
    expect(r.allowed).toBe(false);
    expect(r.missing).toContain("post:create");
  });
});

describe("dryRunSkillAction", () => {
  it("returns preview for valid action", () => {
    const r = dryRunSkillAction(ctx());
    expect(r.allowed).toBe(true);
    expect(r.preview).toEqual(
      expect.objectContaining({
        operation: "draft",
        account: "(required)",
        text: "hello world",
        characterCount: 11,
      }),
    );
    expect(r.blockedReason).toBeNull();
  });

  it("blocks when arg validation fails", () => {
    const r = dryRunSkillAction(ctx({ args: {} }));
    expect(r.allowed).toBe(false);
    expect(r.blockedReason).toContain("argument validation failed");
  });

  it("blocks when permission missing", () => {
    const r = dryRunSkillAction(ctx({ actor: { id: "u-2", role: "viewer", type: "user" } }));
    expect(r.allowed).toBe(false);
    expect(r.blockedReason).toContain("missing permissions");
  });

  it("blocks non-readOnly action in read-only mode", () => {
    const r = dryRunSkillAction(ctx({ mode: "read-only" }));
    expect(r.allowed).toBe(false);
    expect(r.blockedReason).toContain("read-only");
  });

  it("allows readOnly action in read-only mode", () => {
    const r = dryRunSkillAction(
      ctx({ actionName: "post.list", args: { limit: 10 }, mode: "read-only" }),
    );
    expect(r.allowed).toBe(true);
    expect(r.preview).toEqual(
      expect.objectContaining({
        operation: "list_posts",
        platform: "x",
        limit: 10,
      }),
    );
  });
});

describe("executeSkillAction", () => {
  it("invokes invoker for valid request", async () => {
    const invoker = vi.fn<SkillActionInvoker>(async () => ({ postId: "p-1" }));
    const result = await executeSkillAction({ invoker }, ctx());
    expect(result.actionName).toBe("post.create");
    expect(result.result).toEqual({ postId: "p-1" });
    expect(invoker).toHaveBeenCalledTimes(1);
  });

  it("rejects missing permission", async () => {
    const invoker = vi.fn<SkillActionInvoker>(async () => ({}));
    await expect(
      executeSkillAction({ invoker }, ctx({ actor: { id: "u-2", role: "viewer", type: "user" } })),
    ).rejects.toThrow(/permissions/);
    expect(invoker).not.toHaveBeenCalled();
  });

  it("rejects invalid arguments", async () => {
    const invoker = vi.fn<SkillActionInvoker>(async () => ({}));
    await expect(executeSkillAction({ invoker }, ctx({ args: {} }))).rejects.toThrow(
      /validation failed/,
    );
    expect(invoker).not.toHaveBeenCalled();
  });

  it("runs budget guard before invoker", async () => {
    const calls: string[] = [];
    const invoker = vi.fn<SkillActionInvoker>(async () => {
      calls.push("invoker");
      return {};
    });
    const budgetGuard = vi.fn(async () => {
      calls.push("budget");
    });
    await executeSkillAction({ invoker, budgetGuard }, ctx());
    expect(calls).toEqual(["budget", "invoker"]);
  });

  it("blocks read-only mode for write actions", async () => {
    const invoker = vi.fn<SkillActionInvoker>(async () => ({}));
    await expect(executeSkillAction({ invoker }, ctx({ mode: "read-only" }))).rejects.toThrow(
      /read-only/,
    );
    expect(invoker).not.toHaveBeenCalled();
  });
});
