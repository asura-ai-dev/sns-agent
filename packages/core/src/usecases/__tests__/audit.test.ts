/**
 * 監査ログユースケースのテスト (Task 6001)
 *
 * - recordAudit: 新規ログの追記
 * - listAuditLogs: フィルタ + ページネーション
 * - exportAuditLogs: JSON エクスポート
 * - 追記のみ: repository に update/delete メソッドが存在しないこと
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { AuditLog } from "../../domain/entities.js";
import type { AuditLogRepository, AuditLogFilterOptions } from "../../interfaces/repositories.js";
import { recordAudit, listAuditLogs, exportAuditLogs } from "../audit.js";

// ───────────────────────────────────────────
// in-memory モック Repository
// ───────────────────────────────────────────

class InMemoryAuditLogRepo implements AuditLogRepository {
  private logs: AuditLog[] = [];
  private counter = 0;

  async create(log: Omit<AuditLog, "id">): Promise<AuditLog> {
    const id = `log-${++this.counter}`;
    const entity: AuditLog = { ...log, id };
    this.logs.push(entity);
    return entity;
  }

  async findByWorkspace(workspaceId: string, options?: AuditLogFilterOptions): Promise<AuditLog[]> {
    let result = this.logs.filter((l) => l.workspaceId === workspaceId);
    if (options?.actorId) result = result.filter((l) => l.actorId === options.actorId);
    if (options?.actorType) result = result.filter((l) => l.actorType === options.actorType);
    if (options?.action) result = result.filter((l) => l.action === options.action);
    if (options?.resourceType)
      result = result.filter((l) => l.resourceType === options.resourceType);
    if (options?.platform) result = result.filter((l) => l.platform === options.platform);
    if (options?.startDate)
      result = result.filter((l) => l.createdAt.getTime() >= options.startDate!.getTime());
    if (options?.endDate)
      result = result.filter((l) => l.createdAt.getTime() <= options.endDate!.getTime());

    // sort desc by createdAt
    result = result.slice().sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const offset = options?.offset ?? 0;
    const limit = options?.limit;
    return limit ? result.slice(offset, offset + limit) : result.slice(offset);
  }

  async countByWorkspace(
    workspaceId: string,
    options?: Omit<AuditLogFilterOptions, "limit" | "offset">,
  ): Promise<number> {
    const all = await this.findByWorkspace(workspaceId, options);
    return all.length;
  }

  // 意図的に update / delete を実装しない（追記のみ）
}

// ───────────────────────────────────────────
// テスト
// ───────────────────────────────────────────

describe("audit usecase", () => {
  let repo: InMemoryAuditLogRepo;

  beforeEach(() => {
    repo = new InMemoryAuditLogRepo();
  });

  describe("recordAudit", () => {
    it("新しい監査ログを追記し、id と createdAt を付与して返す", async () => {
      const log = await recordAudit(repo, {
        workspaceId: "ws-1",
        actorId: "user-1",
        actorType: "user",
        action: "POST /api/posts",
        resourceType: "post",
        resourceId: "post-1",
        platform: "x",
        inputSummary: { text: "hello" },
        resultSummary: { status: 200, success: true },
        estimatedCostUsd: 0.0001,
        requestId: "req-1",
      });

      expect(log.id).toBeDefined();
      expect(log.id).not.toBe("");
      expect(log.workspaceId).toBe("ws-1");
      expect(log.actorId).toBe("user-1");
      expect(log.action).toBe("POST /api/posts");
      expect(log.createdAt).toBeInstanceOf(Date);
    });

    it("省略可能フィールドは null になる", async () => {
      const log = await recordAudit(repo, {
        workspaceId: "ws-1",
        actorId: "system",
        actorType: "system",
        action: "cleanup",
        resourceType: "job",
      });

      expect(log.resourceId).toBeNull();
      expect(log.platform).toBeNull();
      expect(log.inputSummary).toBeNull();
      expect(log.resultSummary).toBeNull();
      expect(log.estimatedCostUsd).toBeNull();
      expect(log.requestId).toBeNull();
    });
  });

  describe("listAuditLogs", () => {
    beforeEach(async () => {
      // 3 件の user ログ（x, line, instagram）
      // 2 件の agent ログ（x）
      const base = new Date("2026-01-01T00:00:00Z").getTime();
      for (let i = 0; i < 3; i++) {
        await repo.create({
          workspaceId: "ws-1",
          actorId: "user-1",
          actorType: "user",
          action: "POST /api/posts",
          resourceType: "post",
          resourceId: `post-u-${i}`,
          platform: ["x", "line", "instagram"][i],
          socialAccountId: null,
          inputSummary: null,
          resultSummary: { success: true },
          estimatedCostUsd: null,
          requestId: null,
          createdAt: new Date(base + i * 1000),
        });
      }
      for (let i = 0; i < 2; i++) {
        await repo.create({
          workspaceId: "ws-1",
          actorId: "agent-1",
          actorType: "agent",
          action: "DELETE /api/posts",
          resourceType: "post",
          resourceId: `post-a-${i}`,
          platform: "x",
          socialAccountId: null,
          inputSummary: null,
          resultSummary: { success: false },
          estimatedCostUsd: 0.001,
          requestId: null,
          createdAt: new Date(base + 10000 + i * 1000),
        });
      }
    });

    it("デフォルトで全件返す（新しい順）", async () => {
      const result = await listAuditLogs(repo, { workspaceId: "ws-1" });
      expect(result.data).toHaveLength(5);
      expect(result.meta.total).toBe(5);
      expect(result.meta.page).toBe(1);
      // 降順のため最後に追加した agent ログが先頭
      expect(result.data[0].actorType).toBe("agent");
    });

    it("actorType フィルタで絞り込める", async () => {
      const result = await listAuditLogs(repo, {
        workspaceId: "ws-1",
        filters: { actorType: "user" },
      });
      expect(result.data).toHaveLength(3);
      expect(result.meta.total).toBe(3);
      expect(result.data.every((l) => l.actorType === "user")).toBe(true);
    });

    it("platform フィルタで絞り込める", async () => {
      const result = await listAuditLogs(repo, {
        workspaceId: "ws-1",
        filters: { platform: "x" },
      });
      // user 1 + agent 2 = 3
      expect(result.data).toHaveLength(3);
    });

    it("ページネーションが効く（page=1, limit=2）", async () => {
      const result = await listAuditLogs(repo, {
        workspaceId: "ws-1",
        page: 1,
        limit: 2,
      });
      expect(result.data).toHaveLength(2);
      expect(result.meta.total).toBe(5);
      expect(result.meta.page).toBe(1);
      expect(result.meta.limit).toBe(2);
    });

    it("ページネーションが効く（page=2, limit=2）", async () => {
      const result = await listAuditLogs(repo, {
        workspaceId: "ws-1",
        page: 2,
        limit: 2,
      });
      expect(result.data).toHaveLength(2);
      expect(result.meta.page).toBe(2);
    });

    it("他ワークスペースのログは返さない", async () => {
      const result = await listAuditLogs(repo, { workspaceId: "ws-other" });
      expect(result.data).toHaveLength(0);
      expect(result.meta.total).toBe(0);
    });
  });

  describe("exportAuditLogs", () => {
    it("JSON 形式で全件取得する", async () => {
      await recordAudit(repo, {
        workspaceId: "ws-1",
        actorId: "user-1",
        actorType: "user",
        action: "POST /api/posts",
        resourceType: "post",
      });
      await recordAudit(repo, {
        workspaceId: "ws-1",
        actorId: "user-1",
        actorType: "user",
        action: "PATCH /api/posts/1",
        resourceType: "post",
      });

      const result = await exportAuditLogs(repo, {
        workspaceId: "ws-1",
        format: "json",
      });

      expect(result.format).toBe("json");
      expect(result.data).toHaveLength(2);
    });

    it("フィルタを指定できる", async () => {
      await recordAudit(repo, {
        workspaceId: "ws-1",
        actorId: "user-1",
        actorType: "user",
        action: "a",
        resourceType: "post",
      });
      await recordAudit(repo, {
        workspaceId: "ws-1",
        actorId: "agent-1",
        actorType: "agent",
        action: "b",
        resourceType: "post",
      });

      const result = await exportAuditLogs(repo, {
        workspaceId: "ws-1",
        filters: { actorType: "user" },
      });
      expect(result.data).toHaveLength(1);
    });
  });

  describe("追記のみの強制", () => {
    it("AuditLogRepository インターフェースに update / delete メソッドが存在しない", () => {
      // TypeScript レベルでの保証。実行時は Repository 実装にメソッドがないことを確認。
      const repoAny = repo as unknown as Record<string, unknown>;
      expect(repoAny.update).toBeUndefined();
      expect(repoAny.delete).toBeUndefined();
    });
  });
});
