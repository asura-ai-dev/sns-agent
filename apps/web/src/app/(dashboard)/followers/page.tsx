import { fetchFollowersSafe } from "@/lib/api";
import { MASTHEAD_TITLES, SECTION_KICKERS } from "@/lib/i18n/labels";
import {
  XParityPageShell,
  type XParityShellMetric,
  type XParityShellRow,
  type XParityShellState,
} from "@/components/x-parity/XParityPageShell";

export const dynamic = "force-dynamic";

function shellState(isFallback: boolean, count: number): XParityShellState {
  if (isFallback) return "error";
  return count === 0 ? "empty" : "populated";
}

function displayName(name: string | null, username: string | null, fallback: string): string {
  if (name) return name;
  if (username) return `@${username}`;
  return fallback;
}

export default async function FollowersPage() {
  const result = await fetchFollowersSafe();
  const followers = result.data;
  const followedBy = followers.filter((follower) => follower.isFollowed).length;
  const following = followers.filter((follower) => follower.isFollowing).length;
  const mutual = followers.filter((follower) => follower.isFollowed && follower.isFollowing).length;
  const churned = followers.filter((follower) => follower.unfollowedAt).length;

  const metrics: XParityShellMetric[] = [
    { label: "followers", value: String(followedBy), detail: "currently followed" },
    { label: "following", value: String(following), detail: "account follows" },
    { label: "mutual", value: String(mutual), detail: "two-way ties" },
    { label: "unfollowed", value: String(churned), detail: "historical churn" },
  ];

  const rows: XParityShellRow[] = followers.slice(0, 12).map((follower) => ({
    id: follower.id,
    eyebrow: follower.username ? `@${follower.username}` : follower.externalUserId,
    title: displayName(follower.displayName, follower.username, follower.externalUserId),
    detail: follower.unfollowedAt
      ? `Unfollowed at ${follower.unfollowedAt}`
      : `Last seen ${follower.lastSeenAt}`,
    metrics: [
      { label: "follows you", value: follower.isFollowed ? "yes" : "no" },
      { label: "you follow", value: follower.isFollowing ? "yes" : "no" },
      { label: "account", value: follower.socialAccountId.slice(0, 8) },
    ],
  }));

  return (
    <XParityPageShell
      state={shellState(result.isFallback, followers.length)}
      kicker={SECTION_KICKERS.followers}
      title={MASTHEAD_TITLES.followers}
      description="X follower CRM shell for synced profiles, relationship state, tag segmentation, and churn review."
      emptyTitle="No followers synced"
      emptyDescription="Sync an active X account through the followers API to fill this ledger."
      errorMessage={result.errorMessage}
      retryHref="/followers"
      metrics={metrics}
      rows={rows}
      footerNote="x harness parity / follower ledger"
    />
  );
}
