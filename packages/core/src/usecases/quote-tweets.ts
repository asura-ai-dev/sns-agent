import type { Platform } from "@sns-agent/config";
import type { QuoteTweet, QuoteTweetActionType, SocialAccount } from "../domain/entities.js";
import { decrypt } from "../domain/crypto.js";
import type {
  AccountRepository,
  PostRepository,
  QuoteTweetListFilters,
  QuoteTweetRepository,
} from "../interfaces/repositories.js";
import type { SocialProvider } from "../interfaces/social-provider.js";
import { NotFoundError, ProviderError, ValidationError } from "../errors/domain-error.js";

export interface QuoteTweetUsecaseDeps {
  accountRepo: AccountRepository;
  postRepo: PostRepository;
  quoteTweetRepo: QuoteTweetRepository;
  providers: Map<Platform, SocialProvider>;
  encryptionKey: string;
}

export interface ListQuoteTweetsResult {
  data: QuoteTweet[];
}

export interface DiscoverQuoteTweetsInput {
  workspaceId: string;
  socialAccountId: string;
  sourceTweetIds?: string[];
  limit?: number;
  cursor?: string | null;
  now?: Date;
}

export interface DiscoverQuoteTweetsResult {
  sourceTweetsScanned: number;
  quotesScanned: number;
  quotesStored: number;
  nextCursor: string | null;
}

export interface PerformQuoteTweetActionInput {
  workspaceId: string;
  quoteTweetId: string;
  actionType: QuoteTweetActionType;
  actorId: string;
  contentText?: string | null;
}

export interface PerformQuoteTweetActionResult {
  quote: QuoteTweet;
  externalActionId: string | null;
}

async function loadAccount(
  deps: QuoteTweetUsecaseDeps,
  workspaceId: string,
  socialAccountId: string,
): Promise<SocialAccount> {
  const account = await deps.accountRepo.findById(socialAccountId);
  if (!account || account.workspaceId !== workspaceId) {
    throw new NotFoundError("SocialAccount", socialAccountId);
  }
  return account;
}

function getProvider(deps: QuoteTweetUsecaseDeps, platform: Platform): SocialProvider {
  const provider = deps.providers.get(platform);
  if (!provider) {
    throw new ValidationError(`Unsupported platform: ${platform}`);
  }
  return provider;
}

function decryptCredentials(credentialsEncrypted: string, encryptionKey: string): string {
  try {
    return decrypt(credentialsEncrypted, encryptionKey);
  } catch {
    throw new ProviderError("Failed to decrypt account credentials");
  }
}

function normalizeSourceTweetIds(sourceTweetIds: string[] | undefined): string[] {
  const ids = new Set<string>();
  for (const id of sourceTweetIds ?? []) {
    const trimmed = id.trim();
    if (trimmed) ids.add(trimmed);
  }
  return [...ids];
}

function decodeSourceCursors(
  cursor: string | null | undefined,
  sourceTweetIds: string[],
): Map<string, string> {
  const cursors = new Map<string, string>();
  if (!cursor) return cursors;
  if (sourceTweetIds.length === 0) return cursors;
  if (sourceTweetIds.length === 1) {
    cursors.set(sourceTweetIds[0]!, cursor);
    return cursors;
  }

  try {
    const parsed = JSON.parse(cursor) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return cursors;
    const sources = (parsed as { sources?: unknown }).sources;
    if (!sources || typeof sources !== "object" || Array.isArray(sources)) return cursors;
    for (const sourceTweetId of sourceTweetIds) {
      const value = (sources as Record<string, unknown>)[sourceTweetId];
      if (typeof value === "string" && value) cursors.set(sourceTweetId, value);
    }
  } catch {
    cursors.set(sourceTweetIds[0]!, cursor);
  }
  return cursors;
}

function encodeSourceCursors(
  sourceTweetIds: string[],
  cursors: Map<string, string | null>,
): string | null {
  if (sourceTweetIds.length === 1) {
    return cursors.get(sourceTweetIds[0]!) ?? null;
  }

  const sources: Record<string, string> = {};
  for (const sourceTweetId of sourceTweetIds) {
    const cursor = cursors.get(sourceTweetId);
    if (cursor) sources[sourceTweetId] = cursor;
  }
  return Object.keys(sources).length > 0 ? JSON.stringify({ version: 1, sources }) : null;
}

async function resolveTrackedSourceTweetIds(
  deps: QuoteTweetUsecaseDeps,
  account: SocialAccount,
  input: DiscoverQuoteTweetsInput,
): Promise<string[]> {
  const explicitIds = normalizeSourceTweetIds(input.sourceTweetIds);
  if (explicitIds.length > 0) return explicitIds;

  const posts = await deps.postRepo.findByWorkspace(input.workspaceId, {
    platform: account.platform,
    statuses: ["published"],
    limit: 100,
  });
  return posts
    .filter((post) => post.socialAccountId === input.socialAccountId)
    .map((post) => post.platformPostId?.trim() ?? "")
    .filter((id): id is string => id.length > 0);
}

export async function listQuoteTweets(
  deps: QuoteTweetUsecaseDeps,
  workspaceId: string,
  filters: QuoteTweetListFilters = {},
): Promise<ListQuoteTweetsResult> {
  return {
    data: await deps.quoteTweetRepo.findByWorkspace(workspaceId, filters),
  };
}

export async function getQuoteTweet(
  deps: QuoteTweetUsecaseDeps,
  workspaceId: string,
  id: string,
): Promise<QuoteTweet> {
  const quote = await deps.quoteTweetRepo.findById(id);
  if (!quote || quote.workspaceId !== workspaceId) {
    throw new NotFoundError("QuoteTweet", id);
  }
  return quote;
}

export async function discoverQuoteTweetsForTrackedSources(
  deps: QuoteTweetUsecaseDeps,
  input: DiscoverQuoteTweetsInput,
): Promise<DiscoverQuoteTweetsResult> {
  const account = await loadAccount(deps, input.workspaceId, input.socialAccountId);
  if (account.status !== "active") {
    return { sourceTweetsScanned: 0, quotesScanned: 0, quotesStored: 0, nextCursor: null };
  }

  const provider = getProvider(deps, account.platform);
  if (!provider.listQuoteTweets) {
    throw new ProviderError(`Provider for platform ${account.platform} does not support quotes`);
  }

  const sourceTweetIds = await resolveTrackedSourceTweetIds(deps, account, input);
  const accountCredentials = decryptCredentials(account.credentialsEncrypted, deps.encryptionKey);
  const now = input.now ?? new Date();
  const cursors = decodeSourceCursors(input.cursor, sourceTweetIds);
  const nextCursors = new Map<string, string | null>();
  let quotesScanned = 0;
  let quotesStored = 0;

  for (const sourceTweetId of sourceTweetIds) {
    const listed = await provider.listQuoteTweets({
      accountCredentials,
      sourceTweetId,
      limit: input.limit,
      cursor: cursors.get(sourceTweetId) ?? null,
    });
    quotesScanned += listed.quotes.length;
    nextCursors.set(sourceTweetId, listed.nextCursor);

    for (const quote of listed.quotes) {
      await deps.quoteTweetRepo.upsert({
        workspaceId: input.workspaceId,
        socialAccountId: input.socialAccountId,
        sourceTweetId: quote.sourceTweetId || sourceTweetId,
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
        discoveredAt: now,
        lastSeenAt: now,
      });
      quotesStored += 1;
    }
  }

  return {
    sourceTweetsScanned: sourceTweetIds.length,
    quotesScanned,
    quotesStored,
    nextCursor: encodeSourceCursors(sourceTweetIds, nextCursors),
  };
}

export async function performQuoteTweetAction(
  deps: QuoteTweetUsecaseDeps,
  input: PerformQuoteTweetActionInput,
): Promise<PerformQuoteTweetActionResult> {
  const quote = await getQuoteTweet(deps, input.workspaceId, input.quoteTweetId);
  const account = await loadAccount(deps, quote.workspaceId, quote.socialAccountId);
  const provider = getProvider(deps, account.platform);
  const accountCredentials = decryptCredentials(account.credentialsEncrypted, deps.encryptionKey);
  let externalActionId: string | null = null;

  if (input.actionType === "reply") {
    const text = input.contentText?.trim() ?? "";
    if (!text) {
      throw new ValidationError("contentText is required for quote tweet replies");
    }
    if (!provider.sendReply) {
      throw new ProviderError(`Provider for platform ${account.platform} does not support reply`);
    }
    const result = await provider.sendReply({
      accountCredentials,
      externalThreadId: quote.quoteTweetId,
      replyToMessageId: quote.quoteTweetId,
      contentText: text,
    });
    if (!result.success) {
      throw new ProviderError(`quote tweet reply failed: ${result.error ?? "unknown error"}`);
    }
    externalActionId = result.externalMessageId;
  } else {
    if (!provider.performEngagementAction) {
      throw new ProviderError(
        `Provider for platform ${account.platform} does not support ${input.actionType}`,
      );
    }
    const result = await provider.performEngagementAction({
      accountCredentials,
      accountExternalId: account.externalAccountId,
      actionType: input.actionType,
      targetPostId: quote.quoteTweetId,
    });
    if (!result.success) {
      throw new ProviderError(
        `quote tweet ${input.actionType} failed: ${result.error ?? "unknown error"}`,
      );
    }
    externalActionId = result.externalActionId;
  }

  const actedAt = new Date();
  const updated = await deps.quoteTweetRepo.recordAction(quote.id, {
    actionType: input.actionType,
    externalActionId,
    actedAt,
  });

  return { quote: updated, externalActionId };
}
