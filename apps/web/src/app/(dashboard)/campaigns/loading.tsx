import { CampaignWizardView } from "@/components/campaigns/CampaignWizard";

export default function CampaignsLoading() {
  return <CampaignWizardView state="loading" campaigns={[]} />;
}
