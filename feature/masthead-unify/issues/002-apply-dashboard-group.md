---
id: 002
gh: null
title: dashboard / posts / posts/new / calendar / inbox の masthead を MASTHEAD_TITLES 駆動に差し替え
type: refactor
depends_on: [001]
files:
  - apps/web/src/app/(dashboard)/page.tsx
  - apps/web/src/app/(dashboard)/posts/page.tsx
  - apps/web/src/app/(dashboard)/posts/new/page.tsx
  - apps/web/src/app/(dashboard)/calendar/page.tsx
  - apps/web/src/app/(dashboard)/inbox/page.tsx
done_when:
  - 対象 5 ページすべてが `MASTHEAD_TITLES` を import している
  - posts/page.tsx から文字列 "すべての SNS を一つの紙面で" が削除されている
  - calendar/page.tsx から文字列 "予約を一枚の暦で見渡す" が削除されている
  - inbox/page.tsx から文字列 "会話を一箇所で読む" が削除されている
  - dashboard の h1 が `MASTHEAD_TITLES.dashboard.ja` を参照しており、生の `SECTION_KICKERS.dashboard` を h1 に直接差し込んでいない
  - posts/new/page.tsx から "新しい投稿を作成" の文字列リテラルが削除されている (MASTHEAD_TITLES.postsNew.ja 経由に置き換え)
  - 5 ページすべての masthead が「英語 kicker → 日本語 h1」の 2 要素構造（+ 任意の英語 subheading）を持つ
  - 既存の masthead レイアウト (Double-rule, Fraunces, edition メタ行 等) が維持されている
  - `pnpm --filter @sns-agent/web typecheck` が成功する
  - `pnpm --filter @sns-agent/web build` が成功する
---

## Context

spec.md F2 の中核。dashboard と posts / calendar / inbox のインラインに散在していた「英語独自タイトル」「日本語詩的文言」を、001 で作った `MASTHEAD_TITLES` 経由に置き換える。

この issue の触るファイルは `app/(dashboard)/` 直下の 5 つの page.tsx のみで、003 / 004 / 005 と完全に分離する。

詩的 tagline は保存せず破棄する。masthead は 2 要素（英語 kicker + 日本語短名詞 h1）に単純化する。

## Implementation Notes

### 参照する辞書

```ts
import { SECTION_KICKERS, MASTHEAD_TITLES } from "@/lib/i18n/labels";
```

`SECTION_KICKERS[MASTHEAD_TITLES.dashboard.kickerKey]` で kicker 英語を取り出せるので、各 masthead で kicker は辞書経由で描画する。

### dashboard (`app/(dashboard)/page.tsx`)

現状: h1 が `{SECTION_KICKERS.dashboard}` = "Operations Ledger"、その下が日本語 italic 副題。
目標:

- 小さな英語 kicker 行を上部に追加（現状 masthead の日付行と同じタイポで `{SECTION_KICKERS[MASTHEAD_TITLES.dashboard.kickerKey]}`）
- h1 は `MASTHEAD_TITLES.dashboard.ja` = "ダッシュボード"（Fraunces, 大）
- 既存の日本語 italic 副題ブロックは削除する

Double-rule / edition メタ行 / dateline は触らない。文言差し替えのみ。

### posts (`app/(dashboard)/posts/page.tsx` 120-140 行付近)

現状:

```tsx
<p>{SECTION_KICKERS.posts}</p>
<h1>すべての SNS を一つの紙面で</h1>
<p>{meta.total.toLocaleString()} 件の投稿 · ...</p>
```

目標:

```tsx
<p>{SECTION_KICKERS[MASTHEAD_TITLES.posts.kickerKey]}</p>
<h1>{MASTHEAD_TITLES.posts.ja}</h1>
<p>{meta.total.toLocaleString()} 件の投稿 · ...</p>
```

件数行（動的）は残す。詩的 h1 「すべての SNS を一つの紙面で」は削除。

### posts/new

現状 h1 「新しい投稿を作成」を `MASTHEAD_TITLES.postsNew.ja` = "新しい投稿" に置換。kicker は `MASTHEAD_TITLES.postsNew.kickerKey` = `"compose"` 経由で `SECTION_KICKERS.compose` = "Draft Desk" を参照（既存挙動と同値）。

### calendar

現状 h1 「予約を一枚の暦で見渡す」→ `MASTHEAD_TITLES.calendar.ja` = "カレンダー"。
現状 h1 下の日付テキスト `{titleText}`（`2026年 4月` 等）は残す。

### inbox

同様に「会話を一箇所で読む」→ `MASTHEAD_TITLES.inbox.ja` = "受信トレイ"。

### 禁止事項

- Double-rule / Fraunces スタイル / edition メタ行 / ledger 風の装飾は **一切変更しない**
- 他のファイル（usage / skills / agents / settings / help / Sidebar）は触らない（003 / 004 / 005 の責務）
- `MASTHEAD_TITLES` に追加 entry を作らない（001 で閉じている）
- 既存の import（SECTION_KICKERS）は残して良いが、使わなくなった場合は削除する

### 検証

```bash
pnpm --filter @sns-agent/web typecheck
pnpm --filter @sns-agent/web build
```

ローカルで `/`, `/posts`, `/posts/new`, `/calendar`, `/inbox` の masthead を目視確認し、視覚レイアウトが変わっていないことを確認する。
