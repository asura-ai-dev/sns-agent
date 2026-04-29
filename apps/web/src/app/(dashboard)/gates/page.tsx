import { fetchEngagementGatesSafe } from "@/lib/api";
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

function actionLabel(actionType: string): string {
  if (actionType === "mention_post") return "mention reply";
  if (actionType === "dm") return "direct message";
  if (actionType === "verify_only") return "verify only";
  return actionType;
}

export default async function GatesPage() {
  const result = await fetchEngagementGatesSafe();
  const gates = result.data;
  const activeCount = gates.filter((gate) => gate.status === "active").length;
  const pausedCount = gates.filter((gate) => gate.status === "paused").length;
  const backoffCount = gates.filter((gate) => gate.deliveryBackoffUntil).length;

  const metrics: XParityShellMetric[] = [
    { label: "active", value: String(activeCount), detail: "running gates" },
    { label: "paused", value: String(pausedCount), detail: "manual hold" },
    { label: "backoff", value: String(backoffCount), detail: "rate limited" },
    { label: "total", value: String(gates.length), detail: "configured" },
  ];

  const rows: XParityShellRow[] = gates.slice(0, 12).map((gate) => ({
    id: gate.id,
    eyebrow: `${gate.status} / ${actionLabel(gate.actionType)}`,
    title: gate.name,
    detail:
      gate.lineHarnessTag || gate.lineHarnessScenario
        ? `LINE handoff ${gate.lineHarnessTag ?? "untagged"} / ${gate.lineHarnessScenario ?? "no scenario"}`
        : gate.triggerPostId
          ? `Trigger post ${gate.triggerPostId}`
          : "No trigger post configured",
    metrics: [
      { label: "account", value: gate.socialAccountId.slice(0, 8) },
      { label: "action", value: actionLabel(gate.actionType) },
      { label: "backoff", value: gate.deliveryBackoffUntil ? "active" : "clear" },
    ],
  }));

  return (
    <XParityPageShell
      state={shellState(result.isFallback, gates.length)}
      kicker={SECTION_KICKERS.gates}
      title={MASTHEAD_TITLES.gates}
      description="X engagement gate controls for reply-triggered rewards, verification, LINE handoff, and stealth delivery."
      emptyTitle="No engagement gates yet"
      emptyDescription="Create an X engagement gate through the API or upcoming campaign wizard to fill this dashboard shell."
      errorMessage={result.errorMessage}
      retryHref="/gates"
      metrics={metrics}
      rows={rows}
      footerNote="x harness parity / engagement gates"
    />
  );
}
