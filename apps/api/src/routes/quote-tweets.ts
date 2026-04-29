import { Hono } from "hono";
import {
  discoverQuoteTweetsForTrackedSources,
  getQuoteTweet,
  listQuoteTweets,
  performQuoteTweetAction,
  ValidationError,
  type QuoteTweet,
  type QuoteTweetActionType,
  type QuoteTweetUsecaseDeps,
} from "@sns-agent/core";
import {
  DrizzleAccountRepository,
  DrizzlePostRepository,
  DrizzleQuoteTweetRepository,
} from "@sns-agent/db";
import { requirePermission } from "../middleware/rbac.js";
import { getProviderRegistry } from "../providers.js";
import type { AppVariables } from "../types.js";

const quoteTweets = new Hono<{ Variables: AppVariables }>();

function buildDeps(db: AppVariables["db"]): QuoteTweetUsecaseDeps {
  const encryptionKey =
    process.env.ENCRYPTION_KEY ||
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  return {
    accountRepo: new DrizzleAccountRepository(db),
    postRepo: new DrizzlePostRepository(db),
    quoteTweetRepo: new DrizzleQuoteTweetRepository(db),
    providers: getProviderRegistry().getAll(),
    encryptionKey,
  };
}

function serializeQuoteTweet(quote: QuoteTweet): Record<string, unknown> {
  return {
    id: quote.id,
    workspaceId: quote.workspaceId,
    socialAccountId: quote.socialAccountId,
    sourceTweetId: quote.sourceTweetId,
    quoteTweetId: quote.quoteTweetId,
    authorExternalId: quote.authorExternalId,
    authorUsername: quote.authorUsername,
    authorDisplayName: quote.authorDisplayName,
    authorProfileImageUrl: quote.authorProfileImageUrl,
    authorVerified: quote.authorVerified,
    contentText: quote.contentText,
    contentMedia: quote.contentMedia,
    quotedAt: quote.quotedAt,
    metrics: quote.metrics,
    providerMetadata: quote.providerMetadata,
    lastActionType: quote.lastActionType,
    lastActionExternalId: quote.lastActionExternalId,
    lastActionAt: quote.lastActionAt,
    discoveredAt: quote.discoveredAt,
    lastSeenAt: quote.lastSeenAt,
    createdAt: quote.createdAt,
    updatedAt: quote.updatedAt,
  };
}

function parseIntOrUndefined(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isNaN(n) ? undefined : n;
}

function parseActionType(value: string | undefined): QuoteTweetActionType {
  if (value === "reply" || value === "like" || value === "repost") return value;
  throw new ValidationError("actionType must be one of: reply, like, repost");
}

quoteTweets.get("/", requirePermission("inbox:read"), async (c) => {
  const actor = c.get("actor");
  const deps = buildDeps(c.get("db"));

  const result = await listQuoteTweets(deps, actor.workspaceId, {
    socialAccountId: c.req.query("socialAccountId"),
    sourceTweetId: c.req.query("sourceTweetId"),
    limit: parseIntOrUndefined(c.req.query("limit")),
    offset: parseIntOrUndefined(c.req.query("offset")),
  });

  return c.json({ data: result.data.map(serializeQuoteTweet) });
});

quoteTweets.post("/sync", requirePermission("inbox:reply"), async (c) => {
  const actor = c.get("actor");
  const deps = buildDeps(c.get("db"));
  const body = await c.req.json<{
    socialAccountId?: string;
    sourceTweetIds?: string[];
    limit?: number;
    cursor?: string | null;
  }>();

  if (!body.socialAccountId || typeof body.socialAccountId !== "string") {
    throw new ValidationError("socialAccountId is required");
  }

  const result = await discoverQuoteTweetsForTrackedSources(deps, {
    workspaceId: actor.workspaceId,
    socialAccountId: body.socialAccountId,
    sourceTweetIds: Array.isArray(body.sourceTweetIds) ? body.sourceTweetIds : undefined,
    limit: typeof body.limit === "number" ? body.limit : undefined,
    cursor: typeof body.cursor === "string" ? body.cursor : null,
  });

  return c.json({ data: result });
});

quoteTweets.get("/:id", requirePermission("inbox:read"), async (c) => {
  const actor = c.get("actor");
  const deps = buildDeps(c.get("db"));
  const quote = await getQuoteTweet(deps, actor.workspaceId, c.req.param("id"));
  return c.json({ data: serializeQuoteTweet(quote) });
});

quoteTweets.post("/:id/actions", requirePermission("inbox:reply"), async (c) => {
  const actor = c.get("actor");
  const deps = buildDeps(c.get("db"));
  const body = await c.req.json<{
    actionType?: string;
    contentText?: string | null;
  }>();

  const result = await performQuoteTweetAction(deps, {
    workspaceId: actor.workspaceId,
    quoteTweetId: c.req.param("id"),
    actionType: parseActionType(body.actionType),
    actorId: actor.id,
    contentText: body.contentText ?? null,
  });

  return c.json(
    {
      data: {
        quote: serializeQuoteTweet(result.quote),
        externalActionId: result.externalActionId,
      },
    },
    201,
  );
});

export { quoteTweets };
