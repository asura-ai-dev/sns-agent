---
id: 016
gh: 16
title: /inbox に columns 表示モードを実装
type: feat
depends_on: [009, 014]
files:
  - apps/web/src/app/(dashboard)/inbox/page.tsx
done_when:
  - `inbox/page.tsx` が `usePlatformViewMode("inbox")` を呼び出している
  - `mode === "columns"` のとき、スレッド一覧が X / LINE / Instagram のカラム 3 列で表示される
  - `mode === "unified"` のとき、既存の単一一覧表示が従前どおり動作する
  - columns モードでカラム見出しに `PlatformIcon` が使用されている
  - columns モードのコンテナが水平スクロール可能で、モバイルでは snap scroll が機能する
  - URL `?view=columns` で直接開いた際にその状態で復元される
  - 会話ペイン（右側）は columns モードでも従前どおり最新の選択スレッドを表示する（壊れない）
  - `pnpm --filter @sns-agent/web typecheck` が成功する
  - `pnpm --filter @sns-agent/web build` が成功する
---

## Context

spec F6 / AC-22, AC-23, AC-24。inbox にも同様の 2 モードを導入。左側スレッド一覧を unified / columns で切り替え。

## Implementation Notes

- 014 のフック `usePlatformViewMode("inbox")` を呼ぶ
- スレッド配列を `platform` で groupBy し 3 カラムへ
- モバイルの 2 ペイン（一覧 / 会話）スライドは維持。columns モードは「一覧」側の内部レイアウトのみ
- カラム見出しバー: `PlatformIcon` + 未読件数（日本語 "未読 n 件" など既存辞書に合わせる）
- 会話ペインの挙動（選択スレッドの読み込み、返信送信）は変更しない
- `snap-x snap-mandatory` を mobile-only に限定しても可
- スレッド選択時、選択中カラムへ自動 scroll はこの issue では不要（将来課題）
