/**
 * Skills 管理ページ — Task 5005
 *
 * Server Component that fetches the current workspace's skill packages and
 * hands them to `SkillsManager` (client) for listing, generating, toggling,
 * and manifest inspection.
 *
 * When the API is offline, the fetcher returns an empty array and the page
 * still renders with the `wire offline` banner (consistent with the rest of
 * the Operations Ledger).
 *
 * spec.md 主要機能 13 (skills パッケージ機構) · AC-19 / AC-20
 * design.md 10.2 Skills管理
 */
import { fetchSkillPackagesSafe } from "@/lib/api";
import { SECTION_KICKERS } from "@/lib/i18n/labels";
import { SkillsMasthead } from "@/components/skills/SkillsMasthead";
import { SkillsManager } from "@/components/skills/SkillsManager";

export const dynamic = "force-dynamic";

export default async function SkillsPage() {
  const packagesRes = await fetchSkillPackagesSafe();

  return (
    <div className="space-y-6">
      <SkillsMasthead
        eyebrow={SECTION_KICKERS.skills}
        title="Capabilities Gazette"
        description="SNS ごとの skills パッケージを生成・有効化し、LLM から実行可能なアクション一覧を管理します。"
        packageCount={packagesRes.data.length}
      />
      <SkillsManager initialPackages={packagesRes.data} isFallback={packagesRes.isFallback} />
    </div>
  );
}
