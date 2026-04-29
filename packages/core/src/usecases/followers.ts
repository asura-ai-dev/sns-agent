import type { Platform } from "@sns-agent/config";
import type { Follower, SocialAccount } from "../domain/entities.js";
import { decrypt } from "../domain/crypto.js";
import type {
  AccountRepository,
  FollowerListFilters,
  FollowerRepository,
} from "../interfaces/repositories.js";
import type {
  FollowerListResult,
  FollowerProviderProfile,
  SocialProvider,
} from "../interfaces/social-provider.js";
import { NotFoundError, ProviderError, ValidationError } from "../errors/domain-error.js";

export interface FollowerUsecaseDeps {
  accountRepo: AccountRepository;
  followerRepo: FollowerRepository;
  providers: Map<Platform, SocialProvider>;
  encryptionKey: string;
}

export interface ListFollowersResult {
  data: Follower[];
  meta: {
    limit: number;
    offset: number;
    total: number;
  };
}

export interface SyncFollowersFromProviderInput {
  workspaceId: string;
  socialAccountId: string;
  limit?: number;
  followersCursor?: string | null;
  followingCursor?: string | null;
}

export interface SyncFollowersFromProviderResult {
  followerCount: number;
  followingCount: number;
  nextFollowersCursor: string | null;
  nextFollowingCursor: string | null;
  markedUnfollowedCount: number;
  markedUnfollowingCount: number;
}

async function loadAccount(
  deps: FollowerUsecaseDeps,
  workspaceId: string,
  socialAccountId: string,
): Promise<SocialAccount> {
  const account = await deps.accountRepo.findById(socialAccountId);
  if (!account || account.workspaceId !== workspaceId) {
    throw new NotFoundError("SocialAccount", socialAccountId);
  }
  return account;
}

function decryptCredentials(credentialsEncrypted: string, encryptionKey: string): string {
  try {
    return decrypt(credentialsEncrypted, encryptionKey);
  } catch {
    throw new ProviderError("Failed to decrypt account credentials");
  }
}

function getProvider(deps: FollowerUsecaseDeps, platform: Platform): SocialProvider {
  const provider = deps.providers.get(platform);
  if (!provider) {
    throw new ValidationError(`Unsupported platform: ${platform}`);
  }
  return provider;
}

function mergeMetadata(
  a: Record<string, unknown> | null,
  b: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!a) return b;
  if (!b) return a;
  return { ...a, ...b };
}

async function upsertProfile(
  deps: FollowerUsecaseDeps,
  account: SocialAccount,
  profile: FollowerProviderProfile,
  relation: "follower" | "following",
  seenAt: Date,
): Promise<Follower> {
  const existing = await deps.followerRepo.findByAccountAndExternalUser(
    account.id,
    profile.externalUserId,
  );

  return deps.followerRepo.upsert({
    workspaceId: account.workspaceId,
    socialAccountId: account.id,
    platform: account.platform,
    externalUserId: profile.externalUserId,
    displayName: profile.displayName ?? existing?.displayName ?? null,
    username: profile.username ?? existing?.username ?? null,
    isFollowed: relation === "follower" ? true : (existing?.isFollowed ?? false),
    isFollowing: relation === "following" ? true : (existing?.isFollowing ?? false),
    unfollowedAt: relation === "follower" ? null : (existing?.unfollowedAt ?? null),
    metadata: mergeMetadata(existing?.metadata ?? null, profile.metadata),
    lastSeenAt: seenAt,
  });
}

async function listFollowerPages(
  list: (input: {
    accountCredentials: string;
    limit?: number;
    cursor?: string | null;
  }) => Promise<FollowerListResult>,
  accountCredentials: string,
  limit: number | undefined,
  initialCursor: string | null,
): Promise<{
  profiles: FollowerProviderProfile[];
  nextCursor: string | null;
  completeListing: boolean;
}> {
  const profiles: FollowerProviderProfile[] = [];
  let cursor = initialCursor;
  const completeListing = !initialCursor;

  while (true) {
    const page = await list({
      accountCredentials,
      limit,
      cursor,
    });
    profiles.push(...page.profiles);
    cursor = page.nextCursor;

    if (!completeListing || !cursor) {
      return {
        profiles,
        nextCursor: cursor,
        completeListing: completeListing && !cursor,
      };
    }
  }
}

export async function listFollowers(
  deps: FollowerUsecaseDeps,
  workspaceId: string,
  filters: FollowerListFilters = {},
): Promise<ListFollowersResult> {
  const limit = filters.limit && filters.limit > 0 ? Math.min(filters.limit, 500) : 100;
  const offset = filters.offset && filters.offset >= 0 ? filters.offset : 0;
  const data = await deps.followerRepo.findByWorkspace(workspaceId, {
    ...filters,
    limit,
    offset,
  });

  return {
    data,
    meta: {
      limit,
      offset,
      total: data.length,
    },
  };
}

export async function syncFollowersFromProvider(
  deps: FollowerUsecaseDeps,
  input: SyncFollowersFromProviderInput,
): Promise<SyncFollowersFromProviderResult> {
  const account = await loadAccount(deps, input.workspaceId, input.socialAccountId);
  if (account.status !== "active") {
    throw new ValidationError(
      `SocialAccount ${account.id} is not active (status=${account.status})`,
    );
  }

  const provider = getProvider(deps, account.platform);
  if (!provider.listFollowers || !provider.listFollowing) {
    throw new ProviderError(
      `Provider for platform ${account.platform} does not support follower synchronization`,
    );
  }

  const credentials = decryptCredentials(account.credentialsEncrypted, deps.encryptionKey);
  const [followers, following] = await Promise.all([
    listFollowerPages(
      provider.listFollowers.bind(provider),
      credentials,
      input.limit,
      input.followersCursor ?? null,
    ),
    listFollowerPages(
      provider.listFollowing.bind(provider),
      credentials,
      input.limit,
      input.followingCursor ?? null,
    ),
  ]);

  const seenAt = new Date();
  for (const profile of followers.profiles) {
    await upsertProfile(deps, account, profile, "follower", seenAt);
  }
  for (const profile of following.profiles) {
    await upsertProfile(deps, account, profile, "following", seenAt);
  }

  let markedUnfollowedCount = 0;
  let markedUnfollowingCount = 0;
  if (followers.completeListing) {
    markedUnfollowedCount = await deps.followerRepo.markMissingFollowersUnfollowed({
      workspaceId: account.workspaceId,
      socialAccountId: account.id,
      currentExternalUserIds: followers.profiles.map((profile) => profile.externalUserId),
      unfollowedAt: seenAt,
    });
  }
  if (following.completeListing) {
    markedUnfollowingCount = await deps.followerRepo.markMissingFollowingInactive({
      workspaceId: account.workspaceId,
      socialAccountId: account.id,
      currentExternalUserIds: following.profiles.map((profile) => profile.externalUserId),
      updatedAt: seenAt,
    });
  }

  return {
    followerCount: followers.profiles.length,
    followingCount: following.profiles.length,
    nextFollowersCursor: followers.nextCursor,
    nextFollowingCursor: following.nextCursor,
    markedUnfollowedCount,
    markedUnfollowingCount,
  };
}
