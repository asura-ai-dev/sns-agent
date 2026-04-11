/**
 * Skills パッケージルート (Task 5003)
 * design.md セクション 4.2: /api/skills
 *
 * - GET    /api/skills              : パッケージ一覧 (skills:read, admin+)
 * - POST   /api/skills/generate     : パッケージ生成 (skills:manage)
 * - PATCH  /api/skills/:id          : 有効化/無効化 (skills:manage)
 * - GET    /api/skills/:id/manifest : manifest 取得 (skills:read)
 *
 * 設計方針:
 *  - core/usecases/skills の純粋関数を呼ぶ
 *  - manifest 生成は @sns-agent/skills の generateSkillPackage を DI して
 *    SkillManifestBuilder としてユースケースに渡す
 *  - workspaceId は actor.workspaceId スコープ
 */
import { Hono } from "hono";
import {
  ValidationError,
  listSkillPackages,
  generateSkillPackage as generateSkillPackageUsecase,
  enableSkillPackage,
  disableSkillPackage,
  getSkillManifest,
  type SkillPackage,
  type SkillsUsecaseDeps,
  type SkillManifestLike,
} from "@sns-agent/core";
import { DrizzleSkillPackageRepository } from "@sns-agent/db";
import {
  generateSkillPackage as buildManifest,
  type SkillLlmProvider,
  type SkillPlatform,
} from "@sns-agent/skills";
import { requirePermission } from "../middleware/rbac.js";
import { getProviderRegistry } from "../providers.js";
import type { AppVariables } from "../types.js";

const skills = new Hono<{ Variables: AppVariables }>();

// ───────────────────────────────────────────
// シリアライザ
// ───────────────────────────────────────────

function serializePackage(pkg: SkillPackage): Record<string, unknown> {
  return {
    id: pkg.id,
    workspaceId: pkg.workspaceId,
    name: pkg.name,
    version: pkg.version,
    platform: pkg.platform,
    llmProvider: pkg.llmProvider,
    enabled: pkg.enabled,
    actionCount: Array.isArray((pkg.manifest as Record<string, unknown>)?.actions)
      ? ((pkg.manifest as Record<string, unknown>).actions as unknown[]).length
      : 0,
    createdAt: pkg.createdAt.toISOString(),
    updatedAt: pkg.updatedAt.toISOString(),
  };
}

// ───────────────────────────────────────────
// DI ヘルパー: SkillsUsecaseDeps を作る
// ───────────────────────────────────────────

function buildDeps(c: { get(key: "db"): AppVariables["db"] }): SkillsUsecaseDeps {
  const db = c.get("db");
  const repo = new DrizzleSkillPackageRepository(db);
  const registry = getProviderRegistry();
  return {
    skillPackageRepo: repo,
    manifestBuilder: ({ platform, llmProvider }): SkillManifestLike => {
      // skills builder を呼び出す。失敗時は ValidationError が投げられる。
      const manifest = buildManifest(
        { providerRegistry: registry },
        {
          platform: platform as SkillPlatform,
          llmProvider: llmProvider as SkillLlmProvider,
        },
      );
      // 構造的型互換: SkillManifest は SkillManifestLike に代入可能
      return manifest as unknown as SkillManifestLike;
    },
  };
}

// ───────────────────────────────────────────
// バリデーション
// ───────────────────────────────────────────

interface GenerateBody {
  platform?: unknown;
  llmProvider?: unknown;
}

function parseGenerateBody(body: unknown): { platform: string; llmProvider: string } {
  if (typeof body !== "object" || body === null) {
    throw new ValidationError("Request body must be a JSON object");
  }
  const b = body as GenerateBody;
  if (typeof b.platform !== "string" || b.platform.trim() === "") {
    throw new ValidationError("platform is required");
  }
  if (typeof b.llmProvider !== "string" || b.llmProvider.trim() === "") {
    throw new ValidationError("llmProvider is required");
  }
  return { platform: b.platform, llmProvider: b.llmProvider };
}

interface PatchBody {
  enabled?: unknown;
}

function parsePatchBody(body: unknown): { enabled: boolean } {
  if (typeof body !== "object" || body === null) {
    throw new ValidationError("Request body must be a JSON object");
  }
  const b = body as PatchBody;
  if (typeof b.enabled !== "boolean") {
    throw new ValidationError("enabled must be a boolean");
  }
  return { enabled: b.enabled };
}

// ───────────────────────────────────────────
// GET /api/skills - パッケージ一覧
// ───────────────────────────────────────────
skills.get("/", requirePermission("skills:read"), async (c) => {
  const actor = c.get("actor");
  const deps = buildDeps(c);
  const packages = await listSkillPackages(deps, actor.workspaceId);
  return c.json({ data: packages.map(serializePackage) });
});

// ───────────────────────────────────────────
// POST /api/skills/generate - パッケージ生成
// ───────────────────────────────────────────
skills.post("/generate", requirePermission("skills:manage"), async (c) => {
  const actor = c.get("actor");
  const deps = buildDeps(c);

  const body = await c.req.json().catch(() => {
    throw new ValidationError("Invalid JSON body");
  });
  const { platform, llmProvider } = parseGenerateBody(body);

  const created = await generateSkillPackageUsecase(deps, {
    workspaceId: actor.workspaceId,
    platform,
    llmProvider,
  });
  return c.json({ data: serializePackage(created) }, 201);
});

// ───────────────────────────────────────────
// PATCH /api/skills/:id - 有効化 / 無効化
// ───────────────────────────────────────────
skills.patch("/:id", requirePermission("skills:manage"), async (c) => {
  const actor = c.get("actor");
  const deps = buildDeps(c);
  const id = c.req.param("id");

  const body = await c.req.json().catch(() => {
    throw new ValidationError("Invalid JSON body");
  });
  const { enabled } = parsePatchBody(body);

  const updated = enabled
    ? await enableSkillPackage(deps, { packageId: id, workspaceId: actor.workspaceId })
    : await disableSkillPackage(deps, { packageId: id, workspaceId: actor.workspaceId });

  return c.json({ data: serializePackage(updated) });
});

// ───────────────────────────────────────────
// GET /api/skills/:id/manifest - manifest 取得
// ───────────────────────────────────────────
skills.get("/:id/manifest", requirePermission("skills:read"), async (c) => {
  const actor = c.get("actor");
  const deps = buildDeps(c);
  const id = c.req.param("id");

  const { package: pkg, manifest } = await getSkillManifest(deps, {
    packageId: id,
    workspaceId: actor.workspaceId,
  });

  return c.json({
    data: {
      package: serializePackage(pkg),
      manifest,
    },
  });
});

export { skills };
