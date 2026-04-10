# Evaluate Phase 4: 全SNS対応 + 使用量

- 目的: Phase 4 の全5チケット（LINE/Instagram provider, usage, budget, Web UI）の整合性と視覚品質を検証
- 開始日: 2026-04-10
- 更新日: 2026-04-10

## Spec Alignment

- spec.md P0-9（API使用量・コスト可視化）, P0-10（予算ポリシー）, AC-14 を検証
- 全SNS対応（X/LINE/Instagram）の Provider 抽象整合を確認

## Phase

Complete (pass)

## Score

- evaluator: PASS
- ui-reviewer: PASS（Claude DQ 4/Orig 5/Craft 4, Gemini 5/5/5）

## Evidence

### Evaluator

- pnpm -r build: 13 ワークスペース全成功
- pnpm -r test: 362 tests pass（core 170, provider-x 32, provider-line 16, provider-instagram 28, skills 92, llm 24）
- 3 Provider が SocialProvider 実装、ProviderRegistry 経由で polymorphic dispatch
- publishPost → recordProviderUsage → UsageRepository → /api/usage → UsageChart データフロー確認
- publishPostChecked → evaluateBudgetPolicy → 80% warn / block / require-approval 分岐
- /usage と /settings/budget の Web UI ルートが Next.js ビルドで生成

### UI Reviewer（3 iterations）

- iter1 → iter3 で Design 4/Orig 4→5/Craft 3→4 に改善
- recharts legend の位置修正、grid lines 表示、spend line 色分離
- 80%/100% tick marks 追加
- モバイル chip row の scroll 対応
- Gemini second opinion: 5/5/5 PASS

## Known Gaps

- recharts legend payload override が v3 で動作せず、series 順序が chip 順と不一致
- /settings/budget の mobile 表示がカードリフローせず horizontal scroll のまま
- SummaryFigures 前期比の色が error/success 固定（cost rising は必ずしも悪ではない）
- UsageChart の next/dynamic({ ssr: false }) は未対応（/usage 138 kB）
- LLM 呼び出し側の usage 記録は Phase 5 (agent gateway) で結合予定
- LineInboxStore 実体は Phase 6 で注入予定

## Next Step

- Phase 5 完了後に Evaluate Phase 5 と統合テスト（task-6004）を実施

## Files Changed

- agent-output/phase-4-eval-status.md（新規）
- apps/web/src/components/usage/UsageChart.tsx
- apps/web/src/components/usage/UsagePageView.tsx
- apps/web/src/components/usage/BudgetConsumptionRows.tsx
- apps/web/src/components/settings/budget/BudgetPolicyManager.tsx
