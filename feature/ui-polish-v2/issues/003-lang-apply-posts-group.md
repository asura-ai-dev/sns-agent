---
id: 003
gh: 3
title: 言語ルールを posts / calendar / inbox に適用
type: refactor
depends_on: [001]
files:
  - apps/web/src/app/(dashboard)/posts/page.tsx
  - apps/web/src/app/(dashboard)/posts/new/page.tsx
  - apps/web/src/app/(dashboard)/calendar/page.tsx
  - apps/web/src/app/(dashboard)/inbox/page.tsx
  - apps/web/src/components/posts/PostFilters.tsx
  - apps/web/src/components/posts/PostList.tsx
  - apps/web/src/components/posts/PostForm.tsx
done_when:
  - 上記ページの section eyebrow / kicker が英語になっている
  - 上記ページの empty state / エラー / ボタンラベル / placeholder が日本語で表示されている
  - 各ページまたはコンポーネントから `@/lib/i18n/labels` が 1 箇所以上 import されている
  - `pnpm --filter @sns-agent/web typecheck` が成功する
  - `pnpm --filter @sns-agent/web lint` が成功する
---

## Context

F1 の適用フェーズ 2。投稿 / カレンダー / inbox の 4 ページ（+ 関連コンポーネント）に言語ルールを適用する。

## Implementation Notes

- 「下書き」「予約」「公開済み」等の既存ステータスラベルは 001 の辞書に揃える
- PostFilters の Platform / Status / From / To kicker は英語維持（ルール通り）
- 本文・ボタン・placeholder・バリデーションメッセージは日本語
- 表記ゆれがあれば 001 の辞書へ統一
- レイアウトや状態管理には触れない（文字列変更のみ）
- 並列実行可能: 002 と同時着手できる
