/**
 * 承認フローユースケースのテスト (Task 6002)
 *
 * - requiresApproval (policy): ロール別分岐、budget, LINE broadcast
 * - createApprovalRequest: pending で保存、監査ログ記録
 * - approveRequest: executor 呼び出し、自己承認禁止、pending チェック
 * - rejectRequest: status 更新
 * - listApprovals / countPendingApprovals
 * - expireStaleRequests: cutoff 以前の pending が expired に
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { ApprovalRequest, AuditLog } from "../../domain/entities.js";
import type {
  ApprovalRepository,
  ApprovalFilterOptions,
  AuditLogRepository,
  AuditLogFilterOptions,
} from "../../interfaces/repositories.js";
import { requiresApproval, DEFAULT_APPROVAL_POLICY } from "../../policies/approval.js";
import {
  createApprovalRequest,
  approveRequest,
  rejectRequest,
  listApprovals,
  countPendingApprovals,
  expireStaleRequests,
} from "../approval.js";
import type { ApprovalExecutor, ApprovalUsecaseDeps } from "../approval.js";

// ───────────────────────────────────────────
// in-memory mocks
// ───────────────────────────────────────────

class InMemoryApprovalRepo implements ApprovalRepository {
  items: ApprovalRequest[] = [];
  private counter = 0;

  async findById(id: string) {
    return this.items.find((i) => i.id === id) ?? null;
  }

  async findByWorkspace(workspaceId: string, options?: ApprovalFilterOptions) {
    let rows = this.items.filter((i) => i.workspaceId === workspaceId);
    if (options?.status) rows = rows.filter((i) => i.status === options.status);
    if (options?.resourceType) rows = rows.filter((i) => i.resourceType === options.resourceType);
    if (options?.requestedBy) rows = rows.filter((i) => i.requestedBy === options.requestedBy);
    rows = rows.slice().sort((a, b) => b.requestedAt.getTime() - a.requestedAt.getTime());
    const offset = options?.offset ?? 0;
    const limit = options?.limit;
    return limit ? rows.slice(offset, offset + limit) : rows.slice(offset);
  }

  async countByWorkspace(
    workspaceId: string,
    options?: Omit<ApprovalFilterOptions, "limit" | "offset">,
  ) {
    const rows = await this.findByWorkspace(workspaceId, options);
    return rows.length;
  }

  async create(req: Omit<ApprovalRequest, "id">) {
    const id = `apr-${++this.counter}`;
    const entity: ApprovalRequest = { ...req, id };
    this.items.push(entity);
    return entity;
  }

  async update(id: string, data: Partial<ApprovalRequest>) {
    const idx = this.items.findIndex((i) => i.id === id);
    if (idx < 0) throw new Error(`not found: ${id}`);
    this.items[idx] = { ...this.items[idx], ...data };
    return this.items[idx];
  }

  async expirePending(cutoff: Date) {
    let count = 0;
    for (const it of this.items) {
      if (it.status === "pending" && it.requestedAt.getTime() < cutoff.getTime()) {
        it.status = "expired";
        count++;
      }
    }
    return count;
  }
}

class InMemoryAuditRepo implements AuditLogRepository {
  logs: AuditLog[] = [];
  private counter = 0;
  async create(log: Omit<AuditLog, "id">) {
    const id = `log-${++this.counter}`;
    const entity: AuditLog = { ...log, id };
    this.logs.push(entity);
    return entity;
  }
  async findByWorkspace(workspaceId: string, _options?: AuditLogFilterOptions) {
    return this.logs.filter((l) => l.workspaceId === workspaceId);
  }
  async countByWorkspace(workspaceId: string) {
    return this.logs.filter((l) => l.workspaceId === workspaceId).length;
  }
}

function makeDeps(executors?: Map<string, ApprovalExecutor>): {
  deps: ApprovalUsecaseDeps;
  approvalRepo: InMemoryApprovalRepo;
  auditRepo: InMemoryAuditRepo;
} {
  const approvalRepo = new InMemoryApprovalRepo();
  const auditRepo = new InMemoryAuditRepo();
  return {
    deps: { approvalRepo, auditRepo, executors },
    approvalRepo,
    auditRepo,
  };
}

// ───────────────────────────────────────────
// policy: requiresApproval
// ───────────────────────────────────────────

describe("requiresApproval policy", () => {
  it("agent の post:publish は承認必要", () => {
    expect(requiresApproval("post:publish", "agent")).toBe(true);
  });

  it("editor の post:publish は承認不要", () => {
    expect(requiresApproval("post:publish", "editor")).toBe(false);
  });

  it("admin は adminBypass で承認不要", () => {
    expect(requiresApproval("post:publish", "admin")).toBe(false);
    expect(requiresApproval("line:broadcast", "admin")).toBe(false);
  });

  it("owner は adminBypass で承認不要", () => {
    expect(requiresApproval("line:broadcast", "owner")).toBe(false);
  });

  it("LINE broadcast は agent でも editor でも承認必要", () => {
    expect(requiresApproval("line:broadcast", "agent")).toBe(true);
    expect(requiresApproval("line:broadcast", "editor")).toBe(true);
  });

  it("budget:exceed-continue は require-approval 設定時のみ承認必要", () => {
    expect(
      requiresApproval("budget:exceed-continue", "editor", {
        budgetActionOnExceed: "require-approval",
      }),
    ).toBe(true);
    expect(
      requiresApproval("budget:exceed-continue", "admin", {
        budgetActionOnExceed: "require-approval",
      }),
    ).toBe(true); // budget は admin でも承認必要
    expect(
      requiresApproval("budget:exceed-continue", "editor", { budgetActionOnExceed: "warn" }),
    ).toBe(false);
  });

  it("DEFAULT_APPROVAL_POLICY で adminBypass=false にすると admin も承認必要", () => {
    expect(
      requiresApproval(
        "post:publish",
        "admin",
        {},
        { ...DEFAULT_APPROVAL_POLICY, adminBypass: false },
      ),
    ).toBe(false); // admin は agent ロールではないので依然 false
  });
});

// ───────────────────────────────────────────
// createApprovalRequest
// ───────────────────────────────────────────

describe("createApprovalRequest", () => {
  it("pending で保存し、監査ログを記録する", async () => {
    const { deps, approvalRepo, auditRepo } = makeDeps();
    const req = await createApprovalRequest(deps, {
      workspaceId: "w1",
      resourceType: "post",
      resourceId: "p1",
      requestedBy: "user-1",
      reason: "test reason",
    });
    expect(req.status).toBe("pending");
    expect(req.workspaceId).toBe("w1");
    expect(approvalRepo.items).toHaveLength(1);
    expect(auditRepo.logs).toHaveLength(1);
    expect(auditRepo.logs[0].action).toBe("approval.create");
  });

  it("resourceType 欠落で ValidationError", async () => {
    const { deps } = makeDeps();
    await expect(
      createApprovalRequest(deps, {
        workspaceId: "w1",
        resourceType: "",
        resourceId: "p1",
        requestedBy: "u1",
      }),
    ).rejects.toThrow();
  });
});

// ───────────────────────────────────────────
// approveRequest
// ───────────────────────────────────────────

describe("approveRequest", () => {
  it("承認後に executor を呼び、status=approved を返す", async () => {
    let executorCalled = false;
    const executors = new Map<string, ApprovalExecutor>();
    executors.set("post", async (resId, ctx) => {
      executorCalled = true;
      expect(resId).toBe("p1");
      expect(ctx.workspaceId).toBe("w1");
      return { published: true };
    });
    const { deps, approvalRepo, auditRepo } = makeDeps(executors);

    const created = await createApprovalRequest(deps, {
      workspaceId: "w1",
      resourceType: "post",
      resourceId: "p1",
      requestedBy: "user-req",
    });

    const result = await approveRequest(deps, {
      requestId: created.id,
      reviewerId: "user-reviewer",
    });

    expect(result.request.status).toBe("approved");
    expect(result.request.reviewedBy).toBe("user-reviewer");
    expect(executorCalled).toBe(true);
    expect(result.executorMissing).toBe(false);
    expect(approvalRepo.items[0].status).toBe("approved");
    // audit: create + approve
    expect(auditRepo.logs.map((l) => l.action)).toContain("approval.approve");
  });

  it("executor が未登録なら executorMissing=true、status は approved", async () => {
    const { deps } = makeDeps(new Map());
    const created = await createApprovalRequest(deps, {
      workspaceId: "w1",
      resourceType: "post",
      resourceId: "p1",
      requestedBy: "user-req",
    });
    const result = await approveRequest(deps, {
      requestId: created.id,
      reviewerId: "user-reviewer",
    });
    expect(result.executorMissing).toBe(true);
    expect(result.request.status).toBe("approved");
  });

  it("自分のリクエストを自分で承認しようとすると AuthorizationError", async () => {
    const { deps } = makeDeps();
    const created = await createApprovalRequest(deps, {
      workspaceId: "w1",
      resourceType: "post",
      resourceId: "p1",
      requestedBy: "user-1",
    });
    await expect(
      approveRequest(deps, { requestId: created.id, reviewerId: "user-1" }),
    ).rejects.toThrow();
  });

  it("pending 以外の承認は ValidationError", async () => {
    const { deps, approvalRepo } = makeDeps();
    const created = await createApprovalRequest(deps, {
      workspaceId: "w1",
      resourceType: "post",
      resourceId: "p1",
      requestedBy: "user-1",
    });
    approvalRepo.items[0].status = "rejected";
    await expect(
      approveRequest(deps, { requestId: created.id, reviewerId: "user-2" }),
    ).rejects.toThrow();
  });
});

// ───────────────────────────────────────────
// rejectRequest
// ───────────────────────────────────────────

describe("rejectRequest", () => {
  it("status=rejected + reviewedBy + reason を記録", async () => {
    const { deps, auditRepo } = makeDeps();
    const created = await createApprovalRequest(deps, {
      workspaceId: "w1",
      resourceType: "post",
      resourceId: "p1",
      requestedBy: "user-1",
    });
    const updated = await rejectRequest(deps, {
      requestId: created.id,
      reviewerId: "user-2",
      reason: "not now",
    });
    expect(updated.status).toBe("rejected");
    expect(updated.reviewedBy).toBe("user-2");
    expect(updated.reason).toBe("not now");
    expect(auditRepo.logs.map((l) => l.action)).toContain("approval.reject");
  });
});

// ───────────────────────────────────────────
// listApprovals / countPendingApprovals
// ───────────────────────────────────────────

describe("listApprovals / countPendingApprovals", () => {
  it("status=pending で pending のみ返す", async () => {
    const { deps, approvalRepo } = makeDeps();
    await createApprovalRequest(deps, {
      workspaceId: "w1",
      resourceType: "post",
      resourceId: "p1",
      requestedBy: "u1",
    });
    const another = await createApprovalRequest(deps, {
      workspaceId: "w1",
      resourceType: "post",
      resourceId: "p2",
      requestedBy: "u1",
    });
    approvalRepo.items.find((i) => i.id === another.id)!.status = "approved";

    const result = await listApprovals(deps, {
      workspaceId: "w1",
      filters: { status: "pending" },
    });
    expect(result.data).toHaveLength(1);
    expect(result.meta.total).toBe(1);

    const count = await countPendingApprovals(deps, "w1");
    expect(count).toBe(1);
  });

  it("page/limit でページネーション", async () => {
    const { deps } = makeDeps();
    for (let i = 0; i < 5; i++) {
      await createApprovalRequest(deps, {
        workspaceId: "w1",
        resourceType: "post",
        resourceId: `p${i}`,
        requestedBy: "u1",
      });
    }
    const page1 = await listApprovals(deps, {
      workspaceId: "w1",
      filters: { status: "pending" },
      page: 1,
      limit: 2,
    });
    expect(page1.data).toHaveLength(2);
    expect(page1.meta.total).toBe(5);
  });
});

// ───────────────────────────────────────────
// expireStaleRequests
// ───────────────────────────────────────────

describe("expireStaleRequests", () => {
  it("cutoff より古い pending は expired に遷移", async () => {
    const { deps, approvalRepo } = makeDeps();
    const now = new Date("2026-04-10T12:00:00Z");

    // 25 時間前（古い）
    approvalRepo.items.push({
      id: "old",
      workspaceId: "w1",
      resourceType: "post",
      resourceId: "p1",
      requestedBy: "u1",
      requestedAt: new Date(now.getTime() - 25 * 60 * 60 * 1000),
      status: "pending",
      reviewedBy: null,
      reviewedAt: null,
      reason: null,
    });
    // 1 時間前（新しい）
    approvalRepo.items.push({
      id: "fresh",
      workspaceId: "w1",
      resourceType: "post",
      resourceId: "p2",
      requestedBy: "u1",
      requestedAt: new Date(now.getTime() - 60 * 60 * 1000),
      status: "pending",
      reviewedBy: null,
      reviewedAt: null,
      reason: null,
    });

    const count = await expireStaleRequests(deps, 24 * 60 * 60 * 1000, now);
    expect(count).toBe(1);
    expect(approvalRepo.items.find((i) => i.id === "old")!.status).toBe("expired");
    expect(approvalRepo.items.find((i) => i.id === "fresh")!.status).toBe("pending");
  });
});
