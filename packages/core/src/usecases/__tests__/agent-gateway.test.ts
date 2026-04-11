/**
 * Agent Gateway ユースケースのテスト (Task 5002)
 *
 * - handleChatMessage: LLM 解析 (text / skill) → dry-run preview 生成
 * - executeAgentAction: 承認済みアクションの実行 + 監査ログ
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { AuditLog, SkillPackage } from "../../domain/entities.js";
import type { AuditLogRepository, AuditLogFilterOptions } from "../../interfaces/repositories.js";
import {
  handleChatMessage,
  executeAgentAction,
  buildSystemPrompt,
  type AgentGatewayDeps,
  type AgentActor,
  type AgentLlmDecision,
  type AgentDryRunPreview,
} from "../agent-gateway.js";

// ───────────────────────────────────────────
// in-memory モック Repository
// ───────────────────────────────────────────

class InMemoryAuditRepo implements AuditLogRepository {
  public logs: AuditLog[] = [];

  async create(log: Omit<AuditLog, "id">): Promise<AuditLog> {
    const entity: AuditLog = { ...log, id: `log-${this.logs.length + 1}` };
    this.logs.push(entity);
    return entity;
  }

  async findByWorkspace(
    workspaceId: string,
    _options?: AuditLogFilterOptions,
  ): Promise<AuditLog[]> {
    return this.logs.filter((l) => l.workspaceId === workspaceId);
  }

  async countByWorkspace(workspaceId: string): Promise<number> {
    return this.logs.filter((l) => l.workspaceId === workspaceId).length;
  }
}

// ───────────────────────────────────────────
// フィクスチャ
// ───────────────────────────────────────────

const actor: AgentActor = { id: "user-1", role: "editor", type: "user" };

function makeSkill(): SkillPackage {
  return {
    id: "sp-1",
    workspaceId: "ws-1",
    name: "sns-agent-x",
    version: "0.1.0",
    platform: "x",
    llmProvider: "openai",
    enabled: true,
    manifest: {
      name: "sns-agent-x",
      version: "0.1.0",
      platform: "x",
      provider: "openai",
      description: "X skill",
      actions: [
        {
          name: "post.create",
          description: "Create a post",
          parameters: { type: "object" },
          permissions: ["post:create"],
          requiredCapabilities: ["textPost"],
        },
      ],
    },
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  };
}

function makeDryRunPreview(overrides: Partial<AgentDryRunPreview> = {}): AgentDryRunPreview {
  return {
    actionName: "post.create",
    packageName: "sns-agent-x",
    description: "Create a post",
    preview: "[dry-run] post.create",
    requiredPermissions: ["post:create"],
    missingPermissions: [],
    argumentErrors: [],
    mode: "approval-required",
    allowed: true,
    blockedReason: null,
    ...overrides,
  };
}

function makeDeps(
  llmDecision: AgentLlmDecision,
  overrides: Partial<AgentGatewayDeps> = {},
): { deps: AgentGatewayDeps; auditRepo: InMemoryAuditRepo } {
  const auditRepo = new InMemoryAuditRepo();
  const deps: AgentGatewayDeps = {
    llmInvoker: vi.fn(async () => llmDecision),
    dryRunInvoker: vi.fn(async () => makeDryRunPreview()),
    executeInvoker: vi.fn(async ({ intent, mode }) => ({
      actionName: intent.actionName,
      packageName: intent.packageName,
      result: { ok: true },
      mode,
    })),
    auditRepo,
    ...overrides,
  };
  return { deps, auditRepo };
}

// ───────────────────────────────────────────
// handleChatMessage
// ───────────────────────────────────────────

describe("handleChatMessage", () => {
  it("returns text kind when LLM replies with plain text", async () => {
    const { deps, auditRepo } = makeDeps({ type: "text", content: "hello!" });

    const result = await handleChatMessage(deps, {
      workspaceId: "ws-1",
      actor,
      message: "hi",
      enabledSkills: [makeSkill()],
    });

    expect(result.kind).toBe("text");
    if (result.kind === "text") {
      expect(result.content).toBe("hello!");
    }
    expect(deps.dryRunInvoker).not.toHaveBeenCalled();
    expect(auditRepo.logs).toHaveLength(1);
    expect(auditRepo.logs[0].action).toBe("agent.chat");
  });

  it("returns preview kind when LLM replies with skill intent", async () => {
    const intent = {
      actionName: "post.create",
      args: { text: "hello" },
      packageName: "sns-agent-x",
    };
    const { deps } = makeDeps({
      type: "skill",
      content: JSON.stringify({ action: intent.actionName, args: intent.args }),
      intent,
    });

    const result = await handleChatMessage(deps, {
      workspaceId: "ws-1",
      actor,
      message: "post something",
      enabledSkills: [makeSkill()],
    });

    expect(result.kind).toBe("preview");
    if (result.kind === "preview") {
      expect(result.preview.actionName).toBe("post.create");
      expect(result.intent).toEqual(intent);
    }
    expect(deps.dryRunInvoker).toHaveBeenCalledTimes(1);
  });

  it("rejects empty message", async () => {
    const { deps } = makeDeps({ type: "text", content: "" });
    await expect(
      handleChatMessage(deps, {
        workspaceId: "ws-1",
        actor,
        message: "  ",
        enabledSkills: [],
      }),
    ).rejects.toThrow(/message is required/);
  });

  it("rejects skill intent referencing disabled package", async () => {
    const intent = {
      actionName: "post.create",
      args: {},
      packageName: "unknown-package",
    };
    const { deps } = makeDeps({ type: "skill", content: "", intent });

    await expect(
      handleChatMessage(deps, {
        workspaceId: "ws-1",
        actor,
        message: "hi",
        enabledSkills: [makeSkill()],
      }),
    ).rejects.toThrow(/not enabled/);
  });
});

// ───────────────────────────────────────────
// executeAgentAction
// ───────────────────────────────────────────

describe("executeAgentAction", () => {
  it("invokes executeInvoker and logs audit entry", async () => {
    const { deps, auditRepo } = makeDeps({ type: "text", content: "" });

    const result = await executeAgentAction(deps, {
      workspaceId: "ws-1",
      actor,
      intent: {
        actionName: "post.create",
        args: { text: "hello" },
        packageName: "sns-agent-x",
      },
      enabledSkills: [makeSkill()],
    });

    expect(result.outcome.result).toEqual({ ok: true });
    expect(auditRepo.logs).toHaveLength(1);
    expect(auditRepo.logs[0].action).toBe("agent.execute");
  });

  it("logs failure audit entry and rethrows on invoker error", async () => {
    const { deps, auditRepo } = makeDeps(
      { type: "text", content: "" },
      {
        executeInvoker: vi.fn(async () => {
          throw new Error("boom");
        }),
      },
    );

    await expect(
      executeAgentAction(deps, {
        workspaceId: "ws-1",
        actor,
        intent: {
          actionName: "post.create",
          args: {},
          packageName: "sns-agent-x",
        },
        enabledSkills: [makeSkill()],
      }),
    ).rejects.toThrow(/boom/);

    expect(auditRepo.logs).toHaveLength(1);
    expect(auditRepo.logs[0].action).toBe("agent.execute.failed");
  });

  it("rejects when package not enabled", async () => {
    const { deps } = makeDeps({ type: "text", content: "" });

    await expect(
      executeAgentAction(deps, {
        workspaceId: "ws-1",
        actor,
        intent: { actionName: "post.create", args: {}, packageName: "other" },
        enabledSkills: [makeSkill()],
      }),
    ).rejects.toThrow(/not enabled/);
  });
});

// ───────────────────────────────────────────
// buildSystemPrompt
// ───────────────────────────────────────────

describe("buildSystemPrompt", () => {
  it("includes mode and enabled skill actions", () => {
    const prompt = buildSystemPrompt([makeSkill()], "approval-required");
    expect(prompt).toContain("approval-required");
    expect(prompt).toContain("sns-agent-x");
    expect(prompt).toContain("post.create");
  });

  it("marks empty skills", () => {
    const prompt = buildSystemPrompt([], "read-only");
    expect(prompt).toContain("no skill packages enabled");
    expect(prompt).toContain("read-only");
  });
});
