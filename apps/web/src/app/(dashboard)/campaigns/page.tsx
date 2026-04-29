import { fetchCampaignsSafe } from "@/lib/api";
import { CampaignWizard } from "@/components/campaigns/CampaignWizard";
import type {
  CampaignWizardSnapshot,
  CampaignWizardState,
} from "@/components/campaigns/CampaignWizard";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  const result = await fetchCampaignsSafe();
  const state: CampaignWizardState = result.isFallback
    ? "error"
    : result.data.length === 0
      ? "empty"
      : "ready";

  return (
    <CampaignWizard
      initialState={state}
      initialCampaigns={result.data as CampaignWizardSnapshot[]}
      errorMessage={result.errorMessage}
    />
  );
}
