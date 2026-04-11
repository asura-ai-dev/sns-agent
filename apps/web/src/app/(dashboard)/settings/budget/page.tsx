/**
 * 設定: 予算ポリシー — Task 4005
 *
 * Server Component. Fetches policies + consumption status through the safe
 * wrappers and hands them to the client-side `BudgetPolicyManager` for CRUD.
 *
 * When the API is offline, the fetchers return empty arrays and the page
 * still renders with a degraded banner (consistent with the dashboard).
 *
 * spec.md 主要機能 10 (予算ポリシー) · AC-14 補助画面
 */
import { fetchBudgetPoliciesSafe, fetchBudgetStatusSafe } from "@/lib/api";
import { SettingsShell } from "@/components/settings/SettingsShell";
import { BudgetPolicyManager } from "@/components/settings/budget/BudgetPolicyManager";
import { MASTHEAD_TITLES, SECTION_KICKERS } from "@/lib/i18n/labels";

export const dynamic = "force-dynamic";

export default async function BudgetSettingsPage() {
  const [policiesRes, statusesRes] = await Promise.all([
    fetchBudgetPoliciesSafe(),
    fetchBudgetStatusSafe(),
  ]);

  const isFallback = policiesRes.isFallback || statusesRes.isFallback;

  return (
    <SettingsShell
      activeSlug="budget"
      eyebrow={SECTION_KICKERS.settingsBudget}
      title={MASTHEAD_TITLES.settingsBudget}
      description=""
    >
      <BudgetPolicyManager
        initialPolicies={policiesRes.data}
        initialStatuses={statusesRes.data}
        isFallback={isFallback}
      />
    </SettingsShell>
  );
}
