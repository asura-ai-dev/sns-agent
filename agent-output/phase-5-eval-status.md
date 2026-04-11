# Evaluate Phase 5: AI 連携

- 目的: Phase 5 の全5チケット + 修正チケット（task-5006）の整合性と視覚品質を検証
- 開始日: 2026-04-10
- 更新日: 2026-04-10

## Spec Alignment

- spec.md P0-11（LLMルーティング）, P1-12（Web UI チャット）, P1-13（skills パッケージ）の受け入れ条件（AC-16〜20）を検証

## Phase

Complete (pass, 修正1回後)

## Score

- evaluator 初回: FAIL（placeholderInvoker が core use case に未接続）
- task-5006 修正後 evaluator: PASS
- ui-reviewer: PASS（Claude 5/5/5, Gemini 5/4/4）

## Evidence

### Evaluator（修正後）

- placeholderInvoker 完全除去
- createPost/schedulePost/listPosts/listAccounts を @sns-agent/core から import（16 ヒット）
- buildSkillActionInvoker で list_accounts/list_posts/create_post/schedule_post を実ディスパッチ
- 未知 action → { status: "unsupported_action" }
- pnpm build --filter @sns-agent/api: PASS
- pnpm test --filter @sns-agent/core: 170 tests PASS（回帰なし）
- データフロー結線: resolveLlmRoute → Agent Gateway → Skill Executor → Core Use Case → Audit Log 全接続

### UI Reviewer（3 iterations）

- /agents: The Wire Room（MessageBubble 電報伝票風、ActionPreview proof sheet、ChatInput ledger、ConversationList File Cabinet）
- /settings/llm: Dispatch Roster（LlmRouteManager、編集モーダル）
- /skills: Capabilities Gazette（SkillsManager、manifest 詳細）
- 既存 Phase 3/4 editorial トーンとの統一感達成
- Gemini second opinion: 5/4/4 PASS

## Known Gaps

- ESTIMATEDCHARCOUNT eyebrow の word-break（軽微）
- AWAITING STAMP フッター padding（軽微）
- wire-offline 時にモーダルプレビューできず
- /agents Wire Archive fallback デモに本文なし
- /skills catalogue に demo package なし（offline 時）
- Phase 5 の徹底度に Phase 3 /posts などが追いつくには別チケット推奨

## Next Step

- task-6004（統合テスト）の完了を待って Evaluate Phase 6
- Phase 7 最終報告

## Files Changed

- agent-output/phase-5-eval-status.md（新規）
- apps/api/src/routes/agent.ts（task-5006 で invoker 実装）
