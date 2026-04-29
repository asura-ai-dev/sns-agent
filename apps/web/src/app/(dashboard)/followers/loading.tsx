import { SECTION_KICKERS, MASTHEAD_TITLES } from "@/lib/i18n/labels";
import { XParityPageShell } from "@/components/x-parity/XParityPageShell";

export default function FollowersLoading() {
  return (
    <XParityPageShell
      state="loading"
      kicker={SECTION_KICKERS.followers}
      title={MASTHEAD_TITLES.followers}
      description="X follower CRM shell for synced profiles, relationship state, tag segmentation, and churn review."
      emptyTitle="No followers synced"
    />
  );
}
