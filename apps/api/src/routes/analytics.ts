import { Hono } from "hono";
import {
  captureFollowerSnapshot,
  captureFollowerSnapshotsForWorkspace,
  getFollowerAnalytics,
  type FollowerAnalyticsUsecaseDeps,
} from "@sns-agent/core";
import {
  DrizzleAccountRepository,
  DrizzleFollowerRepository,
  DrizzleFollowerSnapshotRepository,
} from "@sns-agent/db";
import { requirePermission } from "../middleware/rbac.js";
import type { AppVariables } from "../types.js";

const analytics = new Hono<{ Variables: AppVariables }>();

function buildDeps(db: AppVariables["db"]): FollowerAnalyticsUsecaseDeps {
  return {
    accountRepo: new DrizzleAccountRepository(db),
    followerRepo: new DrizzleFollowerRepository(db),
    snapshotRepo: new DrizzleFollowerSnapshotRepository(db),
  };
}

analytics.get("/followers", requirePermission("inbox:read"), async (c) => {
  const actor = c.get("actor");
  const socialAccountId = c.req.query("socialAccountId");
  if (!socialAccountId) {
    return c.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "socialAccountId is required",
        },
      },
      400,
    );
  }

  const result = await getFollowerAnalytics(buildDeps(c.get("db")), {
    workspaceId: actor.workspaceId,
    socialAccountId,
    asOfDate: c.req.query("asOfDate"),
  });

  return c.json({ data: result });
});

analytics.post("/followers/snapshot", requirePermission("inbox:reply"), async (c) => {
  const actor = c.get("actor");
  const body: { socialAccountId?: string; capturedAt?: string } = await c.req
    .json()
    .catch(() => ({}));
  const capturedAt = body.capturedAt ? new Date(body.capturedAt) : new Date();
  const deps = buildDeps(c.get("db"));

  if (body.socialAccountId) {
    const result = await captureFollowerSnapshot(deps, {
      workspaceId: actor.workspaceId,
      socialAccountId: body.socialAccountId,
      capturedAt,
    });
    return c.json({ data: result });
  }

  const result = await captureFollowerSnapshotsForWorkspace(deps, {
    workspaceId: actor.workspaceId,
    capturedAt,
  });
  return c.json({ data: result });
});

export { analytics };
