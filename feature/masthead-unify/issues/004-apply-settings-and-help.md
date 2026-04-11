---
id: 004
gh: null
title: settings 5 ページと /help の h1 を MASTHEAD_TITLES に差し替え
type: refactor
depends_on: [001]
files:
  - apps/web/src/app/(dashboard)/settings/accounts/page.tsx
  - apps/web/src/app/(dashboard)/settings/users/page.tsx
  - apps/web/src/app/(dashboard)/settings/audit/page.tsx
  - apps/web/src/app/(dashboard)/settings/llm/page.tsx
  - apps/web/src/app/(dashboard)/settings/budget/page.tsx
  - apps/web/src/app/(dashboard)/help/page.tsx
done_when:
  - settings/accounts/page.tsx から `title="Connected Accounts"` が削除されている
  - settings/users/page.tsx から `title="Members & Agents"` が削除されている
  - settings/llm/page.tsx から `title="Dispatch Roster"` が削除されている
  - settings/budget/page.tsx から `title="Allowances Register"` が削除されている
  - settings/audit/page.tsx から h1 "Operations Ledger" literal が削除されている (dashboard と重複)
  - 5 settings ページすべての `SettingsShell` 呼び出し / audit masthead が `MASTHEAD_TITLES.settings*` 経由で title を取得している
  - help/page.tsx から "Help for Daily Operations" literal が削除されている
  - help/page.tsx の h1 が `{MASTHEAD_TITLES.help}` を描画している
  - 対象 6 ページすべて `MASTHEAD_TITLES` を import している
  - `pnpm --filter @sns-agent/web typecheck` が成功する
  - `pnpm --filter @sns-agent/web build` が成功する
---

## Context

settings 5 ページは `SettingsShell` を経由するタイプと、audit のようにページ内で直接 masthead を組むタイプが混在。/help は "Help for Daily Operations" をハードコード。001 の flat `MASTHEAD_TITLES` 経由に置き換える。

`SettingsShell.tsx` の props interface は変更しない（prop 名互換を維持）。

## Implementation Notes

### settings/accounts, users, llm, budget (`SettingsShell` 経由)

```tsx
import { MASTHEAD_TITLES } from "@/lib/i18n/labels";

<SettingsShell
  activeSlug="accounts"
  eyebrow={SECTION_KICKERS.settingsAccounts}  // 既存 eyebrow 保持して良い
  title={MASTHEAD_TITLES.settingsAccounts}    // ← "Accounts"
  description=""                                // 既存長文 description は空に
>
```

- `title` は英語 1 語に切り替わる
- 既存の長い日本語 description は削除（空文字でも可）
- `SettingsShell.tsx` 本体は触らない

対象 4 ページ: accounts, users, llm, budget。

### settings/audit

独自に masthead を組んでおり h1 が "Operations Ledger"（dashboard と衝突）。

- h1 literal を `{MASTHEAD_TITLES.settingsAudit}` = "Audit" に置換
- 既存の罫線 / edition 装飾 / total records 表示は触らない
- description 日本語があれば削除

### /help (`help/page.tsx`)

- h1 "Help for Daily Operations" を `{MASTHEAD_TITLES.help}` = "Help" に置換
- 既存の日本語 italic 副題ブロックは削除
- 6 セクション内部の見出し（"Dashboard", "Posts" 等）はそのまま残して良い（本 issue の scope は h1 のみ）

### 禁止事項

- `SettingsShell.tsx` の props interface / 内部レイアウトは変更しない
- settings/audit の装飾 / 再読み込みボタン等は変更しない
- /help の本文 body（日本語 3 行）は改稿しない
- dashboard / posts / calendar / inbox / usage / skills / agents / Sidebar は触らない

### 検証

```bash
pnpm --filter @sns-agent/web typecheck
pnpm --filter @sns-agent/web build
```
