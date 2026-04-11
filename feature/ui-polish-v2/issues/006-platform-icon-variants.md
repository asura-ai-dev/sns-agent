---
id: 006
title: PlatformIcon にチップ用 variant を追加
type: feat
depends_on: []
files:
  - apps/web/src/components/settings/PlatformIcon.tsx
done_when:
  - `PlatformIcon.tsx` に `variant` prop が追加され、`"solid" | "outline" | "chip"` が受け付けられる
  - `chip` variant が small size（24px 以下）で inline-flex レンダリングされる
  - `outline` variant がブランドカラーを border と text に使い background は `transparent` 相当
  - 既存の default（`variant` 未指定）動作が破壊されていない（既存呼び出し箇所の見た目が変わらない）
  - 新規 variant を含む呼び出し例を JSDoc に追記
  - `pnpm --filter @sns-agent/web typecheck` が成功する
---

## Context

spec F5 の横展開に先立ち、`PlatformIcon` に小さめチップ / outline 表現のバリアントを追加する。後続 007-010 はこの variant を使用する。

## Implementation Notes

- 既存の `PLATFORM_VISUALS` はそのまま活用
- 新 prop: `variant?: "solid" | "outline" | "chip"`, default `"solid"`
- `chip` = size 20 デフォルト, border radius `rounded-full`, インナーアイコンは size×0.55
- `outline` = background transparent, `border` + `color` に `visual.accent` 相当の solid 色
- `aria-label` は既存同様 `visual.label`
- 既存の `size` prop と組み合わせ可能
- variant ごとの `style` 決定をヘルパ関数に分離し、可読性を保つ
- 既存テストが存在すれば全て pass させる（なければ追加は不要）
