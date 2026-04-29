import { SECTION_KICKERS, MASTHEAD_TITLES } from "@/lib/i18n/labels";
import { XParityPageShell } from "@/components/x-parity/XParityPageShell";

export default function TagsLoading() {
  return (
    <XParityPageShell
      state="loading"
      kicker={SECTION_KICKERS.tags}
      title={MASTHEAD_TITLES.tags}
      description="X follower segment shell for campaign targeting, CRM review, and gate eligibility workflows."
      emptyTitle="No follower tags yet"
    />
  );
}
