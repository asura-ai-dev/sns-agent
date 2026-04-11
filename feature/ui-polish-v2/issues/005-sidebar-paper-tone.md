---
id: 005
gh: 5
title: Sidebar を paper ベーストークンに差し替え
type: ui
depends_on: []
files:
  - apps/web/src/components/layout/Sidebar.tsx
  - apps/web/src/app/globals.css
done_when:
  - `Sidebar.tsx` から `bg-secondary` と `text-secondary-content` の文字列が消えている（Grep で 0 ヒット）
  - `Sidebar.tsx` のルート要素が `bg-base-100` または類似の paper トークンを使っている
  - `globals.css` の `.sidebar-nav-item[data-active="true"]` スタイルが維持されている
  - hover / active / focus の 3 状態のスタイル定義が存在する（Grep で `:hover`, `:focus`, `data-active` 相当が残る）
  - `pnpm --filter @sns-agent/web typecheck` が成功する
  - `pnpm --filter @sns-agent/web build` が成功する
---

## Context

spec F2。現状サイドバーだけが `bg-secondary`（暗色）で paper ベースの全体トーンから浮いている。`bg-base-100` ベースに差し替え、accent rule で強調を表現する。後続の 011（ホバー展開）の土台になる。

## Implementation Notes

- `SidebarContent` のルート div から `bg-secondary text-secondary-content` を外し、`bg-base-100 text-base-content` へ
- ヘッダーとの間に editorial hairline（`border-r border-base-300` など）を維持
- hover は `hover:bg-base-200/60` 系のトークンで軽く、active は既存の accent rule（緑色 left rule）を維持
- フッター（`v1.0.0`）の `border-white/10` は `border-base-300` へ置き換え
- brand ロゴ（S アイコン）の `bg-primary` は維持
- AA コントラストを満たす色選択（`text-base-content/70` 以上）
- globals.css の `.sidebar-nav-item` は active の緑 rule を維持し、dark 前提の `white/5` 等があれば base トークンへ差し替え
