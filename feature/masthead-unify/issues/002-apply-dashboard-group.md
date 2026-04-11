---
id: 002
gh: null
title: dashboard / posts / posts/new / calendar / inbox の h1 を MASTHEAD_TITLES に差し替え
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
  - 各ページの masthead h1 が `{MASTHEAD_TITLES.<key>}` を描画している（literal 英語文字列ではない）
  - posts/page.tsx から "すべての SNS を一つの紙面で" が削除されている
  - calendar/page.tsx から "予約を一枚の暦で見渡す" が削除されている
  - inbox/page.tsx から "会話を一箇所で読む" が削除されている
  - posts/new/page.tsx から "新しい投稿を作成" の literal が削除されている
  - `pnpm --filter @sns-agent/web typecheck` が成功する
  - `pnpm --filter @sns-agent/web build` が成功する
---

## Context

001 で導入した flat `MASTHEAD_TITLES` 辞書を使って、各ページの h1 をシンプルな英語 1 語 ("Dashboard", "Posts" 等) に揃える。既存の日本語詩的副題や独自英語文言は削除する。

## Implementation Notes

### 共通パターン

```tsx
import { MASTHEAD_TITLES } from "@/lib/i18n/labels";

// masthead
<h1 className="font-display text-4xl font-semibold">{MASTHEAD_TITLES.posts}</h1>;
```

h1 1 行のみ。kicker, 副題, italic 日本語等は全て削除。

### 各ページの変更点

- **dashboard (`page.tsx`)**: 現状 h1 が `{SECTION_KICKERS.dashboard}` = "Operations Ledger"。→ `{MASTHEAD_TITLES.dashboard}` = "Dashboard" に置換。下の日本語 italic 副題ブロックは削除
- **posts (`posts/page.tsx`)**: 現状 h1 「すべての SNS を一つの紙面で」→ `{MASTHEAD_TITLES.posts}` = "Posts"。件数行（動的）は残す
- **posts/new**: h1 「新しい投稿を作成」→ `{MASTHEAD_TITLES.postsNew}` = "New Post"
- **calendar**: h1 「予約を一枚の暦で見渡す」→ `{MASTHEAD_TITLES.calendar}` = "Calendar"。日付表示行は残す
- **inbox**: h1 「会話を一箇所で読む」→ `{MASTHEAD_TITLES.inbox}` = "Inbox"

### 禁止事項

- レイアウト / Fraunces スタイル / edition メタ行 / 罫線等の装飾は一切変更しない
- 他ファイルは触らない（003 / 004 / 005 の責務）
- `SECTION_KICKERS` の参照は残したい箇所があれば残して良い（別用途で使われていれば）が、h1 の描画からは除去する
- 削除対象以外の日本語本文（件数、日付、エラーメッセージ等）は触らない

### 検証

```bash
pnpm --filter @sns-agent/web typecheck
pnpm --filter @sns-agent/web build
```
