---
id: 015
title: /posts に columns 表示モードを実装
type: feat
depends_on: [007, 014]
files:
  - apps/web/src/app/(dashboard)/posts/page.tsx
  - apps/web/src/components/posts/PostList.tsx
done_when:
  - `posts/page.tsx` が `usePlatformViewMode("posts")` を呼び出している
  - `mode === "columns"` のとき、各プラットフォーム（X / LINE / Instagram）ごとのカラムが横並びで描画される
  - `mode === "unified"` のとき、既存の単一リスト表示が従前どおり動作する
  - 各カラム見出しに `PlatformIcon` が使われている
  - columns モードのコンテナが `overflow-x-auto` を持ち、水平スクロール可能
  - モバイル（`sm` 以下）では columns モードで snap scroll が効く（`snap-x snap-mandatory` 相当）
  - URL `?view=columns` で直接開いた際にその状態で復元される
  - `pnpm --filter @sns-agent/web typecheck` が成功する
  - `pnpm --filter @sns-agent/web build` が成功する
---

## Context

spec F6 / AC-22, AC-23, AC-24。投稿一覧に `unified` / `columns` 2 モードを導入。columns は各プラットフォームごとに独立カラム。

## Implementation Notes

- 014 のフック `usePlatformViewMode` を呼ぶ
- 取得済み `posts` を `groupBy(platform)` して各カラムへ振り分け
- 既存の `PostList` を各カラム用に再利用（or 小さな変種を作る）
- カラム幅は `min-w-[22rem] max-w-[28rem]` 程度、3 カラム並ぶとオーバーフローする前提
- カラム見出しバー: `PlatformIcon` + 件数バッジ（日本語 "n 件"）
- ページング（既存の `meta` / `page`）は unified モードのみで動作させ、columns モードでは現在ページのデータをそのまま 3 分割表示（この範囲を超えるページングロジックは別タスク扱い）
- filters state は両モードで共有
- `prefers-reduced-motion` を意識し、モード切替時のトランジションは控えめに（`opacity` のみ）
- columns モードは `scroll-snap-type: x mandatory` を付与
