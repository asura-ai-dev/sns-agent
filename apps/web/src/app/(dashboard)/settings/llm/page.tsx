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
import { fetchLlmRoutesSafe, fetchOpenAiCodexStatusSafe } from "@/lib/api";
import { SettingsShell } from "@/components/settings/SettingsShell";
import { LlmRouteManager } from "@/components/settings/llm/LlmRouteManager";
import { LlmProviderConnectionPanel } from "@/components/settings/llm/LlmProviderConnectionPanel";
import { MASTHEAD_TITLES, SECTION_KICKERS } from "@/lib/i18n/labels";

export const dynamic = "force-dynamic";

export default async function LlmSettingsPage() {
  const [routesRes, openAiCodexRes] = await Promise.all([
    fetchLlmRoutesSafe(),
    fetchOpenAiCodexStatusSafe(),
  ]);

  return (
    <SettingsShell
      activeSlug="llm"
      eyebrow={SECTION_KICKERS.settingsLlm}
      title={MASTHEAD_TITLES.settingsLlm}
      description="チャットや自動処理で使う AI を、用途ごとに切り替える設定画面です。どの SNS のどの操作に、どのモデルを使うかをここで決めます。"
    >
      <div className="space-y-5">
        <LlmProviderConnectionPanel
          initialStatus={openAiCodexRes.data}
          isFallback={openAiCodexRes.isFallback}
        />
        <LlmRouteManager initialRoutes={routesRes.data} isFallback={routesRes.isFallback} />
      </div>
    </SettingsShell>
  );
}
