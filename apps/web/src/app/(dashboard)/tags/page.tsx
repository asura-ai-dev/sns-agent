import { fetchTagsSafe } from "@/lib/api";
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

export default async function TagsPage() {
  const result = await fetchTagsSafe();
  const tags = result.data;
  const colored = tags.filter((tag) => tag.color).length;

  const metrics: XParityShellMetric[] = [
    { label: "tags", value: String(tags.length), detail: "segments" },
    { label: "colored", value: String(colored), detail: "visual labels" },
    { label: "plain", value: String(tags.length - colored), detail: "default labels" },
    { label: "accounts", value: String(new Set(tags.map((tag) => tag.socialAccountId)).size), detail: "x accounts" },
  ];

  const rows: XParityShellRow[] = tags.slice(0, 12).map((tag) => ({
    id: tag.id,
    eyebrow: tag.color ?? "default color",
    title: tag.name,
    detail: `Segment for account ${tag.socialAccountId.slice(0, 8)} / updated ${tag.updatedAt}`,
    metrics: [
      { label: "color", value: tag.color ?? "default" },
      { label: "account", value: tag.socialAccountId.slice(0, 8) },
      { label: "tag id", value: tag.id.slice(0, 8) },
    ],
  }));

  return (
    <XParityPageShell
      state={shellState(result.isFallback, tags.length)}
      kicker={SECTION_KICKERS.tags}
      title={MASTHEAD_TITLES.tags}
      description="X follower segment shell for campaign targeting, CRM review, and gate eligibility workflows."
      emptyTitle="No follower tags yet"
      emptyDescription="Create tags through the tags API or follower workflows to segment the X CRM."
      errorMessage={result.errorMessage}
      retryHref="/tags"
      metrics={metrics}
      rows={rows}
      footerNote="x harness parity / segment desk"
    />
  );
}
