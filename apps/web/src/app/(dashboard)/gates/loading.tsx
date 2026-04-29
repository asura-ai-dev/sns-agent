import { SECTION_KICKERS, MASTHEAD_TITLES } from "@/lib/i18n/labels";
import { XParityPageShell } from "@/components/x-parity/XParityPageShell";

export default function GatesLoading() {
  return (
    <XParityPageShell
      state="loading"
      kicker={SECTION_KICKERS.gates}
      title={MASTHEAD_TITLES.gates}
      description="X engagement gate controls for reply-triggered rewards, verification, LINE handoff, and stealth delivery."
      emptyTitle="No engagement gates yet"
    />
  );
}
