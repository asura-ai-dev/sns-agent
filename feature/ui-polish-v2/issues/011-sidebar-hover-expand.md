---
id: 011
title: Sidebar のホバー自動展開（collapsed / expanded 2 状態）
type: ux
depends_on: [005]
files:
  - apps/web/src/components/layout/Sidebar.tsx
  - apps/web/src/app/globals.css
done_when:
  - `Sidebar.tsx` で collapsed / expanded を切り替える state（例: `useState<boolean>`）が存在する
  - `onPointerEnter` / `onPointerLeave` もしくは CSS `:hover` 相当でサイドバー領域に入ると expanded へ、離れると collapsed へ遷移する
  - collapsed のデフォルト幅がアイコンのみ（概ね `w-16` 前後）、expanded の幅が `w-60` 前後
  - フォーカスが内部 nav item にある間 expanded を維持する（`onFocus` / `:focus-within` いずれか）
  - `prefers-reduced-motion: reduce` 時にトランジションが無効化される（CSS メディアクエリが存在）
  - モバイル drawer（`SidebarDrawer`）は従前の挙動を維持し、hover 展開ロジックは適用されない
  - `pnpm --filter @sns-agent/web typecheck` が成功する
  - `pnpm --filter @sns-agent/web build` が成功する
---

## Context

spec F3 / AC-7〜AC-11。デスクトップ（`lg` 以上）で、サイドバーをアイコンのみ collapsed 状態にし、ホバーで expanded へ自動展開する。paper ベース化（005）の後に実装する。

## Implementation Notes

- `SidebarDesktop` の container を `group` にし、CSS `group-hover:w-60` のような Tailwind アプローチか、React state いずれでもよい（アクセシビリティ条件を満たすなら）
- `:focus-within` で expanded を維持できる CSS 手法を推奨（キーボード操作でも自然に維持される）
- ラベル表示は `opacity-0 group-hover:opacity-100 focus-within:opacity-100` のような段階的フェード
- モバイル drawer はそのまま固定幅 `w-60`（変更しない）
- トランジション: `transition-[width,opacity]` + `@media (prefers-reduced-motion: reduce) { .sidebar-expand { transition: none; } }` を globals.css に追加
- collapsed 時でも active rule は見える位置に維持
- spec の「アクティブ項目 / ホバー / フォーカスの accent rule」を維持
