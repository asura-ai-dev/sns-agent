---
id: 004
gh: null
title: settings 5 ページと /help の masthead を MASTHEAD_TITLES 駆動に差し替え、/help 6 セクションを HELP_SECTIONS に寄せる
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
  - settings/accounts/page.tsx から `title="Connected Accounts"` のハードコードが削除されている
  - settings/users/page.tsx から `title="Members & Agents"` のハードコードが削除されている
  - settings/llm/page.tsx から `title="Dispatch Roster"` のハードコードが削除されている
  - settings/budget/page.tsx から `title="Allowances Register"` のハードコードが削除されている
  - settings/audit/page.tsx から h1 "Operations Ledger" 文字列リテラルが削除されている (dashboard と重複する独自文言)
  - 5 ページすべての SettingsShell 呼び出し / audit masthead が `MASTHEAD_TITLES[settings*]` 経由で文言を取得している
  - help/page.tsx から文字列リテラル "Help for Daily Operations" が削除されている
  - help/page.tsx の HELP_SECTIONS ローカル配列の kicker 文字列リテラル ("Reading Room" 等) が labels.ts の `HELP_SECTIONS` を参照する形に置き換わっている
  - help の 6 セクション全てが labels.ts の HELP_SECTIONS を経由して kicker を描画している
  - 対象 6 ページすべての masthead が「英語 kicker → 日本語 h1 → 任意の subheading / tagline」の構造を持つ
  - `pnpm --filter @sns-agent/web typecheck` が成功する
  - `pnpm --filter @sns-agent/web build` が成功する
---

## Context

spec.md F2 の 3 つ目。settings 5 ページは `SettingsShell` を経由するタイプと、`audit` のようにページ内で直接 masthead を組むタイプが混在している。/help は独自 HELP_SECTIONS 配列を持ちつつ h1 に "Help for Daily Operations" をハードコードしている。

本 issue では辞書差し替えに集中する。`SettingsShell.tsx` の内部実装は **変更しない**（prop 名互換を維持）。

## Implementation Notes

### settings/accounts, users, llm, budget (`SettingsShell` 経由)

4 ページいずれも以下のパターンで `SettingsShell` を呼んでいる:

```tsx
<SettingsShell
  activeSlug="..."
  eyebrow={SECTION_KICKERS.settingsXxx}
  title="Connected Accounts"
  description="..."
>
```

目標:

```tsx
import { SECTION_KICKERS, MASTHEAD_TITLES } from "@/lib/i18n/labels";

const m = MASTHEAD_TITLES.settingsAccounts;
<SettingsShell
  activeSlug="accounts"
  eyebrow={SECTION_KICKERS[m.kickerKey]}
  title={m.ja}              // ← 日本語 h1 ("アカウント接続")
  description={m.tagline}   // ← 日本語 tagline
>
```

- `title` は日本語に切り替わる（UI 上の h1 が日本語に）
- `description` は現行の日本語説明文を `MASTHEAD_TITLES.settingsAccounts.tagline` から供給する（文言はほぼ同等）
- 英語 subheading (`m.en` = "Connected Accounts" 等) は、`SettingsShell` の既存スロットに無理に追加する必要はない。本 issue では h1 を日本語に揃えることを優先し、英語併記の追加はオプション扱いでスキップしてよい
- `SettingsShell.tsx` 本体の props interface は変更しない

対象 4 ページ: accounts, users, llm, budget。

### settings/audit

audit は `SettingsShell` ではなく独自に masthead を組んでおり、h1 が `"Operations Ledger"`（dashboard と同文言）にハードコードされている。これは dashboard とタイトルが衝突するため必ず差し替える。

目標:

- 301-306 行付近の h1 を `MASTHEAD_TITLES.settingsAudit.ja` = "監査ログ" に置換
- kicker 行（299 行付近）は `SECTION_KICKERS.settingsAudit` または `SECTION_KICKERS[MASTHEAD_TITLES.settingsAudit.kickerKey]` のまま
- 308 行の description 日本語は残して良いが、`MASTHEAD_TITLES.settingsAudit.tagline` で置き換える方が辞書集約の目的に沿う
- 既存の罫線 / edition 装飾 / total records 表示は **一切変更しない**

### help (`help/page.tsx`)

現状:

1. 76-93 行の header が `eyebrow="Help Desk"`（現状は `Help Desk` の文字列リテラル）、h1 が `"Help for Daily Operations"`、italic 副題が日本語ハードコード
2. 10-71 行に `HELP_SECTIONS` ローカル配列があり、各 entry の `kicker` がハードコード（"Reading Room" 等）

目標:

- header masthead:
  - eyebrow を `SECTION_KICKERS.help`（001 で追加済み = "Help Desk"）に置換
  - h1 を `MASTHEAD_TITLES.help.ja` = "ヘルプ" に置換
  - italic 副題を `MASTHEAD_TITLES.help.tagline` に置換
- 6 セクションの kicker:
  - ローカルの `HELP_SECTIONS` 配列を、`labels.ts` の新定数 `HELP_SECTIONS`（001 で追加済み）を参照する形に書き換える
  - 具体的には、`const SECTIONS = [{ sectionKey: "dashboard", icon: Compass, body: [...] }, ...] as const` のような「キー + icon + body のみ」の配列を作り、描画時に `labels.HELP_SECTIONS[item.sectionKey].kicker` と `labels.HELP_SECTIONS[item.sectionKey].titleJa` を参照する
  - 各セクションの `title`（現状の英語 "Dashboard" 等）は、`HELP_SECTIONS[key].titleJa`（日本語）に差し替えて良い。あるいは並記にする場合も本 issue の done_when には抵触しない
  - body 本文（日本語 3 行）はそのままローカル配列に残す

### 禁止事項

- `SettingsShell.tsx` の props interface や内部レイアウトは変更しない
- settings/audit の罫線 / edition 装飾 / 再読み込みボタン等は変更しない
- `/help` の本文（body の日本語 3 行）は改稿しない。kicker 辞書化のみ
- dashboard / posts / calendar / inbox / usage / skills / agents / Sidebar は触らない（002 / 003 / 005 の責務）
- `MASTHEAD_TITLES`, `HELP_SECTIONS`, `SECTION_KICKERS` に entry を足さない（001 で閉じている）

### 検証

```bash
pnpm --filter @sns-agent/web typecheck
pnpm --filter @sns-agent/web build
```

ローカルで `/settings/accounts`, `/settings/users`, `/settings/audit`, `/settings/llm`, `/settings/budget`, `/help` の masthead を目視確認し、視覚上のレイアウトが変わっていないこと、h1 が日本語になっていることを確認する。
