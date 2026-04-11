/**
 * 設定: LLM ルーティング — Task 5005
 *
 * Server Component that fetches the LLM routes for the current workspace
 * through the safe wrapper and hands them to `LlmRouteManager` (client)
 * for CRUD operations.
 *
 * When the API is offline, the fetcher returns an empty array and the page
 * still renders with the `wire offline` banner (consistent with the rest of
 * the Operations Ledger).
 *
 * spec.md 主要機能 11 (LLM ルーティング設定) · AC-18
 * design.md 10.2 設定 / LLMルーティング
 */
import { fetchLlmRoutesSafe } from "@/lib/api";
import { SettingsShell } from "@/components/settings/SettingsShell";
import { LlmRouteManager } from "@/components/settings/llm/LlmRouteManager";
import { SECTION_KICKERS } from "@/lib/i18n/labels";

export const dynamic = "force-dynamic";

export default async function LlmSettingsPage() {
  const routesRes = await fetchLlmRoutesSafe();

  return (
    <SettingsShell
      activeSlug="llm"
      eyebrow={SECTION_KICKERS.settingsLlm}
      title="Dispatch Roster"
      description="プラットフォーム × アクションごとに使用する LLM モデル・温度・フォールバックを登録し、優先度で経路を決定します。"
    >
      <LlmRouteManager initialRoutes={routesRes.data} isFallback={routesRes.isFallback} />
    </SettingsShell>
  );
}
