import { SECTION_KICKERS, MASTHEAD_TITLES } from "@/lib/i18n/labels";
import { XParityPageShell } from "@/components/x-parity/XParityPageShell";

export default function CampaignsLoading() {
  return (
    <XParityPageShell
      state="loading"
      kicker={SECTION_KICKERS.campaigns}
      title={MASTHEAD_TITLES.campaigns}
      description="X campaign shell for the upcoming post, gate, LINE handoff, and preview wizard."
      emptyTitle="Campaign wizard not started"
    />
  );
}
