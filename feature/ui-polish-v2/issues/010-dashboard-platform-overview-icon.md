---
id: 010
gh: 10
title: dashboard PlatformOverview のシンボルを PlatformIcon に統一
type: ui
depends_on: [006]
files:
  - apps/web/src/components/dashboard/PlatformOverview.tsx
done_when:
  - `PlatformOverview.tsx` から ローカル `VISUALS` 定数の重複を削除、もしくは `PLATFORM_VISUALS` と合流させている
  - 各 PlatformCard のヘッダーシンボルが `PlatformIcon` コンポーネントを使って描画されている（Grep で `<PlatformIcon` が 1 回以上ヒット）
  - `aria-label` でプラットフォーム名が提供されている
  - 既存の bureau 名（"the x bureau" 等）や見た目（issue vol, edition 等）は維持されている
  - `pnpm --filter @sns-agent/web typecheck` が成功する
  - `pnpm --filter @sns-agent/web build` が成功する
---

## Context

spec F5 / AC-19。現状 `PlatformOverview` は独自 `VISUALS` 定数でブランドカラーを重複定義している。`PlatformIcon` + `PLATFORM_VISUALS` に一本化する。

## Implementation Notes

- ローカル `VISUALS` のうちブランド色（`background`, `accent`, `foreground`）は `PLATFORM_VISUALS` から参照に置き換え
- `bureau` / `meterColor` 等の画面固有属性はローカルに残してよい
- ヘッダーの 48px シンボルを `<PlatformIcon platform={stat.platform} size={48} />` 的な呼び出しに置換
- 独自の `style` / `boxShadow` を削除し、`PlatformIcon` 内部で担保する形に整える
- SuccessMeter / CropMark / 他のサブコンポーネントは触らない
