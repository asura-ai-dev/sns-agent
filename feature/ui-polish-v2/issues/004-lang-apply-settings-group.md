---
id: 004
title: 言語ルールを settings 系 5 ページに適用
type: refactor
depends_on: [001]
files:
  - apps/web/src/app/(dashboard)/settings/page.tsx
  - apps/web/src/app/(dashboard)/settings/accounts/page.tsx
  - apps/web/src/app/(dashboard)/settings/users/page.tsx
  - apps/web/src/app/(dashboard)/settings/audit/page.tsx
  - apps/web/src/app/(dashboard)/settings/budget/page.tsx
  - apps/web/src/app/(dashboard)/settings/llm/page.tsx
  - apps/web/src/components/settings/SettingsShell.tsx
done_when:
  - 上記 5 settings ページ（settings, accounts, users, audit, budget, llm）の section kicker が英語になっている
  - ボタン / フォームラベル / placeholder / エラーが日本語で表示されている
  - SettingsShell のナビゲーション label が `@/lib/i18n/labels` 由来になっている
  - `pnpm --filter @sns-agent/web typecheck` が成功する
  - `pnpm --filter @sns-agent/web lint` が成功する
---

## Context

F1 の適用フェーズ 3。settings 配下の 5 ページ + シェルに言語ルールを適用する。

## Implementation Notes

- SettingsShell のタブ / サイドメニューのラベルは英語（navigation 項目は英語）
- 各ページ内のフォーム・確認ダイアログ・確認メッセージは日本語
- RBAC 関連の権限表示（role badge 等）は英語の専門語を許容（editor/admin 等はそのまま）
- 002 / 003 と並列実行可能
- ドメインロジックや API 呼び出しは触らない
