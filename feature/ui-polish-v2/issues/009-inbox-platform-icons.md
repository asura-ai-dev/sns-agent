---
id: 009
title: Inbox のプラットフォーム絞り込みとスレッド行を PlatformIcon 化
type: ui
depends_on: [006]
files:
  - apps/web/src/app/(dashboard)/inbox/page.tsx
done_when:
  - inbox のプラットフォーム絞り込み UI（フィルタバー相当）で `PlatformIcon` が使用されている
  - スレッド行のプラットフォーム表示で `PlatformIcon` が使われている（既存箇所を維持しつつ）
  - すべての `<PlatformIcon ... />` 呼び出しに `aria-label` か周囲に `sr-only` のプラットフォーム名が存在する
  - テキストベースの platform chip（`PLATFORM_VISUALS[x].label` を直接表示するボタン）が絞り込み UI に残っていない
  - `pnpm --filter @sns-agent/web typecheck` が成功する
  - `pnpm --filter @sns-agent/web build` が成功する
---

## Context

spec F5 / AC-18。inbox はスレッド行では既に `PlatformIcon` を使っているが、絞り込みボタンがテキストベース。これをアイコンチップに揃え、aria を整える。

## Implementation Notes

- inbox ページ内のプラットフォーム絞り込みトグルを `PlatformIcon` の `chip` variant に差し替え
- 既存のフィルタ state 管理は変更しない
- スレッド行は `PlatformIcon` 呼び出しに `aria-label` が無い場合は追加
- 返信フォーム / メッセージバブルのデザインは一切触らない
- レイアウト（左一覧 / 右会話の 2 ペイン）は変更しない
