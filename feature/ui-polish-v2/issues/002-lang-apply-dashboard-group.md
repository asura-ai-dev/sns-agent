---
id: 002
gh: 2
title: 言語ルールを dashboard / usage / skills / agents に適用
type: refactor
depends_on: [001]
files:
  - apps/web/src/app/(dashboard)/page.tsx
  - apps/web/src/app/(dashboard)/usage/page.tsx
  - apps/web/src/app/(dashboard)/skills/page.tsx
  - apps/web/src/app/(dashboard)/agents/page.tsx
  - apps/web/src/components/dashboard/SummaryCards.tsx
  - apps/web/src/components/dashboard/RecentActivity.tsx
done_when:
  - 上記 4 ページで section eyebrow / kicker が英語になっている（Grep で `text-[0.65rem]` 系 kicker のうち英語単語が含まれる）
  - 上記 4 ページで主要なボタンラベル / empty state 説明 / エラーメッセージが日本語（非 ASCII 文字を含む）で表示される
  - 各ページから `@/lib/i18n/labels` の import が 1 箇所以上ある
  - `pnpm --filter @sns-agent/web typecheck` が成功する
  - `pnpm --filter @sns-agent/web lint` が成功する
---

## Context

F1 の適用フェーズ 1。ダッシュボード系 4 ページに 001 で定義した言語ルールを適用する。

## Implementation Notes

- 各ページを読み、混在している英日文言を ルール（英語 = kicker/nav/ラベル見出し、日本語 = 本文/ボタン/empty state）に従って修正
- 共通定数は 001 の `labels.ts` から import して使用
- 画面ロジックには一切手を入れない（文字列のみ変更）
- 表記ゆれ（例: 「投稿を作成」vs「新規投稿」）を 001 の辞書に従って揃える
- スクリーンショット差分レベルの軽微な調整のみ。レイアウト変更は禁止
