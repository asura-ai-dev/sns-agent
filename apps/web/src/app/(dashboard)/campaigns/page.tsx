import { MASTHEAD_TITLES, SECTION_KICKERS } from "@/lib/i18n/labels";
import { XParityPageShell } from "@/components/x-parity/XParityPageShell";

export default function CampaignsPage() {
  return (
    <XParityPageShell
      state="empty"
      kicker={SECTION_KICKERS.campaigns}
      title={MASTHEAD_TITLES.campaigns}
      description="X campaign shell for the upcoming post, gate, LINE handoff, and preview wizard."
      emptyTitle="Campaign wizard not started"
      emptyDescription="XHP-019 exposes the dashboard destination; XHP-007 owns the campaign creation wizard and publish flow."
      primaryAction={{ href: "/posts/new", label: "draft post" }}
      footerNote="x harness parity / campaign desk"
    />
  );
}
