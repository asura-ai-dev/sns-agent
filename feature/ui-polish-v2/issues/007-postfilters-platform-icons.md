---
id: 007
gh: 7
title: PostFilters のプラットフォームチップを PlatformIcon 化
type: ui
depends_on: [006]
files:
  - apps/web/src/components/posts/PostFilters.tsx
done_when:
  - `PostFilters.tsx` 内のプラットフォーム絞り込みボタンが `PlatformIcon` コンポーネントを呼び出している（Grep で `<PlatformIcon` が 1 回以上ヒット）
  - 各ボタンに `aria-label` もしくは `title` でプラットフォーム名（X / LINE / Instagram）が付与されている
  - `aria-pressed` がトグル状態を反映して出力される
  - テキストラベル（"X", "LINE", "Instagram"）が button 内から削除されているか、`sr-only` で視覚的に非表示になっている
  - `pnpm --filter @sns-agent/web typecheck` が成功する
  - `pnpm --filter @sns-agent/web build` が成功する
---

## Context

spec F5 / AC-16。投稿一覧のフィルタバーでテキスト中心だったプラットフォームチップを、ブランドアイコンチップに置き換える。

## Implementation Notes

- `PlatformIcon` の `chip` variant（006 で追加）を使用
- active / inactive の切り替えは外枠の button 側で表現（active = 濃いボーダー、inactive = base-300 ボーダー + opacity）
- ボタン本体はサイズを小さくし、横並びのままトグル操作できる形を維持
- `aria-label` は `${visual.label} で絞り込み` の形式を推奨
- 既存のフィルタロジック（`togglePlatform`, `value.platforms`）は変更しない
- Status / From / To フィルタは今回触らない
