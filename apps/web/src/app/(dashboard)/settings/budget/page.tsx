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
      eyebrow="settings · section iv"
      title="Allowances Register"
      description="ワークスペース・プラットフォーム・エンドポイント別に予算ポリシーを発行し、超過時の挙動を制御します。"
    >
      <BudgetPolicyManager
        initialPolicies={policiesRes.data}
        initialStatuses={statusesRes.data}
        isFallback={isFallback}
      />
    </SettingsShell>
  );
}
