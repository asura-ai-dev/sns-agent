import { SECTION_KICKERS, MASTHEAD_TITLES } from "@/lib/i18n/labels";
import { XParityPageShell } from "@/components/x-parity/XParityPageShell";

export default function SequencesLoading() {
  return (
    <XParityPageShell
      state="loading"
      kicker={SECTION_KICKERS.sequences}
      title={MASTHEAD_TITLES.sequences}
      description="X step sequence shell for delayed mention and DM delivery after gate enrollment."
      emptyTitle="No step sequences yet"
    />
  );
}
