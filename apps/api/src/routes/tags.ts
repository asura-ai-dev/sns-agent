import { Hono } from "hono";
import {
  createTag,
  deleteTag,
  listTags,
  updateTag,
  ValidationError,
  type Tag,
  type TagUsecaseDeps,
} from "@sns-agent/core";
import { DrizzleAccountRepository, DrizzleTagRepository } from "@sns-agent/db";
import { requirePermission } from "../middleware/rbac.js";
import type { AppVariables } from "../types.js";

const tags = new Hono<{ Variables: AppVariables }>();

function buildDeps(db: AppVariables["db"]): TagUsecaseDeps {
  return {
    accountRepo: new DrizzleAccountRepository(db),
    tagRepo: new DrizzleTagRepository(db),
  };
}

function serializeTag(tag: Tag): Record<string, unknown> {
  return {
    id: tag.id,
    workspaceId: tag.workspaceId,
    socialAccountId: tag.socialAccountId,
    name: tag.name,
    color: tag.color,
    createdAt: tag.createdAt,
    updatedAt: tag.updatedAt,
  };
}

tags.get("/", requirePermission("inbox:read"), async (c) => {
  const actor = c.get("actor");
  const deps = buildDeps(c.get("db"));
  const data = await listTags(deps, actor.workspaceId, {
    socialAccountId: c.req.query("socialAccountId"),
  });
  return c.json({ data: data.map(serializeTag) });
});

tags.post("/", requirePermission("inbox:reply"), async (c) => {
  const actor = c.get("actor");
  const deps = buildDeps(c.get("db"));
  const body = await c.req.json<{
    socialAccountId?: string;
    name?: string;
    color?: string | null;
  }>();
  if (!body.socialAccountId) {
    throw new ValidationError("socialAccountId is required");
  }
  if (!body.name) {
    throw new ValidationError("name is required");
  }

  const tag = await createTag(deps, {
    workspaceId: actor.workspaceId,
    socialAccountId: body.socialAccountId,
    name: body.name,
    color: body.color ?? null,
  });
  return c.json({ data: serializeTag(tag) }, 201);
});

tags.patch("/:id", requirePermission("inbox:reply"), async (c) => {
  const actor = c.get("actor");
  const deps = buildDeps(c.get("db"));
  const body = await c.req.json<{ name?: string; color?: string | null }>();
  const tag = await updateTag(deps, {
    workspaceId: actor.workspaceId,
    tagId: c.req.param("id"),
    name: body.name,
    color: body.color,
  });
  return c.json({ data: serializeTag(tag) });
});

tags.delete("/:id", requirePermission("inbox:reply"), async (c) => {
  const actor = c.get("actor");
  const deps = buildDeps(c.get("db"));
  await deleteTag(deps, actor.workspaceId, c.req.param("id"));
  return c.json({ data: { success: true } });
});

export { tags };
