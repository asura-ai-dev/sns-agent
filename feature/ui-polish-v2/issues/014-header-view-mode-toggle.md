---
id: 014
title: Header にプラットフォーム表示モードトグルと状態フックを追加
type: feat
depends_on: []
files:
  - apps/web/src/components/layout/Header.tsx
  - apps/web/src/lib/view-mode/usePlatformViewMode.ts
done_when:
  - `apps/web/src/lib/view-mode/usePlatformViewMode.ts` が存在し、`usePlatformViewMode(pageKey)` フックが export されている
  - フックが `unified | columns` の `mode` と `setMode` を返す
  - URL クエリ `?view=columns` を読み取り、優先度が最も高い
  - URL 指定がなければ localStorage から復元する
  - 何もなければデフォルト `unified` を返す
  - `setMode` が URL クエリと localStorage の両方を更新する
  - `Header.tsx` にモードトグル UI が追加され、対象ページ（`/posts`, `/inbox`）でのみ表示される（`usePathname` で判定）
  - トグルボタンに `aria-pressed` が付与されている
  - 対象外ページ（`/`, `/settings` 等）ではトグル DOM が出力されない
  - `pnpm --filter @sns-agent/web typecheck` が成功する
  - `pnpm --filter @sns-agent/web build` が成功する
---

## Context

spec F6 / AC-21, AC-24, AC-25, AC-26。ヘッダー右寄り（通知ベル / アバターの隣）にプラットフォーム表示モードトグルを配置する。状態管理は共通フックに切り出し、015 / 016 の各ページ実装で再利用する。

## Implementation Notes

- `usePlatformViewMode(pageKey: "posts" | "inbox")` のシグネチャ
- localStorage キー例: `sns-agent.view-mode.posts`, `sns-agent.view-mode.inbox`（既存キーと衝突しない新規キーのみ）
- URL クエリ読み取りは `useSearchParams`、書き換えは `useRouter().replace(pathname?query)` で shallow 更新
- Header では `usePathname` で `/posts` または `/inbox` 配下のみトグルを描画
- トグル UI: 2 つのボタンを並べた segmented control（Unified / Columns のアイコン + sr-only ラベル）
- キーボード操作可能（通常の `<button>`、`aria-pressed` を true/false で切替）
- 015 / 016 でこのフックを呼び出して実際の表示を切り替える
- モード切替自体はこの issue で動作確認できる（URL とヘッダーのハイライトが連動する）
