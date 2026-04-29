import { fetchStepSequencesSafe } from "@/lib/api";
import { SequenceDashboardView } from "@/components/x-parity/SequenceDashboardView";

export default async function SequencesPage() {
  const result = await fetchStepSequencesSafe();
  return <SequenceDashboardView result={result} />;
}
