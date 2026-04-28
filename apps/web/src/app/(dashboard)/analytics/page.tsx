import { ChartLineUp } from "@phosphor-icons/react/dist/ssr";

import { fetchAccountsSafe, fetchFollowerAnalyticsSafe } from "@/lib/api";
import { FollowerSnapshotChart } from "@/components/analytics/FollowerSnapshotChart";

export default async function AnalyticsPage() {
  const accountsResult = await fetchAccountsSafe();
  const primaryXAccount =
    accountsResult.data.find(
      (account) => account.platform === "x" && account.status === "active",
    ) ?? null;
  const analyticsResult = await fetchFollowerAnalyticsSafe(primaryXAccount?.id ?? null);
  const degraded = accountsResult.isFallback || analyticsResult.isFallback;

  return (
    <main className="space-y-6">
      <section className="border-b border-base-300 pb-5">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-base-content/45">
          <ChartLineUp size={14} weight="bold" />x analytics ledger
        </div>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1
              className="font-display text-4xl font-semibold leading-tight text-base-content"
              style={{ fontFamily: "'Fraunces', serif" }}
            >
              Follower snapshots
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-base-content/65">
              Daily follower count movement for the active X account.
            </p>
          </div>
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-base-content/45">
            {primaryXAccount?.displayName ?? "no active x account"}
            {degraded ? " · offline fallback" : ""}
          </div>
        </div>
      </section>

      <FollowerSnapshotChart state="ready" analytics={analyticsResult.data} />
    </main>
  );
}
