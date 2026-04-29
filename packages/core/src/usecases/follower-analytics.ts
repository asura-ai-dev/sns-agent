import type { FollowerSnapshot, SocialAccount } from "../domain/entities.js";
import type {
  AccountRepository,
  FollowerRepository,
  FollowerSnapshotRepository,
} from "../interfaces/repositories.js";
import { NotFoundError } from "../errors/domain-error.js";

export interface FollowerAnalyticsUsecaseDeps {
  accountRepo: AccountRepository;
  followerRepo: FollowerRepository;
  snapshotRepo: FollowerSnapshotRepository;
}

export interface CaptureFollowerSnapshotInput {
  workspaceId: string;
  socialAccountId: string;
  capturedAt?: Date;
}

export interface CaptureFollowerSnapshotResult {
  snapshot: FollowerSnapshot;
  created: boolean;
}

export interface CaptureFollowerSnapshotsForWorkspaceInput {
  workspaceId: string;
  capturedAt?: Date;
}

export interface CaptureFollowerSnapshotsForWorkspaceResult {
  captured: number;
  created: number;
  snapshots: FollowerSnapshot[];
}

export interface GetFollowerAnalyticsInput {
  workspaceId: string;
  socialAccountId: string;
  asOfDate?: string;
}

export interface FollowerAnalyticsPoint {
  date: string;
  followerCount: number;
  followingCount: number;
}

export interface FollowerAnalyticsResult {
  currentCount: number;
  delta7Days: number | null;
  delta30Days: number | null;
  series: FollowerAnalyticsPoint[];
}

function formatSnapshotDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function dateMinusDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return formatSnapshotDate(d);
}

async function loadAccount(
  deps: FollowerAnalyticsUsecaseDeps,
  workspaceId: string,
  socialAccountId: string,
): Promise<SocialAccount> {
  const account = await deps.accountRepo.findById(socialAccountId);
  if (!account || account.workspaceId !== workspaceId) {
    throw new NotFoundError("SocialAccount", socialAccountId);
  }
  return account;
}

function findBaseline(snapshots: FollowerSnapshot[], targetDate: string): FollowerSnapshot | null {
  return (
    snapshots
      .filter((snapshot) => snapshot.snapshotDate <= targetDate)
      .sort((a, b) => b.snapshotDate.localeCompare(a.snapshotDate))[0] ?? null
  );
}

function deltaFromBaseline(
  current: FollowerSnapshot | null,
  snapshots: FollowerSnapshot[],
  days: number,
): number | null {
  if (!current) return null;
  const baseline = findBaseline(snapshots, dateMinusDays(current.snapshotDate, days));
  return baseline ? current.followerCount - baseline.followerCount : null;
}

export async function captureFollowerSnapshot(
  deps: FollowerAnalyticsUsecaseDeps,
  input: CaptureFollowerSnapshotInput,
): Promise<CaptureFollowerSnapshotResult> {
  const account = await loadAccount(deps, input.workspaceId, input.socialAccountId);
  const capturedAt = input.capturedAt ?? new Date();
  const [followers, following] = await Promise.all([
    deps.followerRepo.findByWorkspace(input.workspaceId, {
      socialAccountId: input.socialAccountId,
      isFollowed: true,
    }),
    deps.followerRepo.findByWorkspace(input.workspaceId, {
      socialAccountId: input.socialAccountId,
      isFollowing: true,
    }),
  ]);

  return deps.snapshotRepo.upsertDailySnapshot({
    workspaceId: input.workspaceId,
    socialAccountId: input.socialAccountId,
    platform: account.platform,
    snapshotDate: formatSnapshotDate(capturedAt),
    followerCount: followers.length,
    followingCount: following.length,
    capturedAt,
  });
}

export async function captureFollowerSnapshotsForWorkspace(
  deps: FollowerAnalyticsUsecaseDeps,
  input: CaptureFollowerSnapshotsForWorkspaceInput,
): Promise<CaptureFollowerSnapshotsForWorkspaceResult> {
  const accounts = (await deps.accountRepo.findByWorkspace(input.workspaceId)).filter(
    (account) => account.status === "active",
  );
  const results: CaptureFollowerSnapshotResult[] = [];
  for (const account of accounts) {
    results.push(
      await captureFollowerSnapshot(deps, {
        workspaceId: input.workspaceId,
        socialAccountId: account.id,
        capturedAt: input.capturedAt,
      }),
    );
  }

  return {
    captured: results.length,
    created: results.filter((result) => result.created).length,
    snapshots: results.map((result) => result.snapshot),
  };
}

export async function getFollowerAnalytics(
  deps: FollowerAnalyticsUsecaseDeps,
  input: GetFollowerAnalyticsInput,
): Promise<FollowerAnalyticsResult> {
  await loadAccount(deps, input.workspaceId, input.socialAccountId);
  const snapshots = (
    await deps.snapshotRepo.findByAccount(input.workspaceId, input.socialAccountId, {
      toDate: input.asOfDate,
    })
  ).sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate));
  const current = snapshots.at(-1) ?? null;

  return {
    currentCount: current?.followerCount ?? 0,
    delta7Days: deltaFromBaseline(current, snapshots, 7),
    delta30Days: deltaFromBaseline(current, snapshots, 30),
    series: snapshots.map((snapshot) => ({
      date: snapshot.snapshotDate,
      followerCount: snapshot.followerCount,
      followingCount: snapshot.followingCount,
    })),
  };
}
