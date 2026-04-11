---
id: 001
gh: 1
title: 言語レイヤルール定義と共通辞書の整備
type: refactor
depends_on: []
files:
  - apps/web/src/lib/i18n/rules.md
  - apps/web/src/lib/i18n/labels.ts
done_when:
  - apps/web/src/lib/i18n/rules.md が存在する
  - apps/web/src/lib/i18n/labels.ts が存在し `export` を含む
  - labels.ts に `NAV_LABELS`, `SECTION_KICKERS`, `COMMON_ACTIONS` の 3 つの定数が export されている
  - rules.md に "英語" と "日本語" の両方の文字列がそれぞれ 3 回以上出現する
  - `pnpm --filter @sns-agent/web typecheck` が成功する
---

## Context

spec F1 で全 13 ページの文言を「英語 kicker + 日本語本文」の 2 層ルールに揃える。その基盤として、判断基準となるルールドキュメントと、ページ横断で再利用する共通辞書を先に定義する。

## Implementation Notes

- `apps/web/src/lib/i18n/rules.md` に以下をまとめる:
  - 英語を使う箇所: section eyebrow, kicker, ナビ項目, カードのラベル見出し
  - 日本語を使う箇所: 本文, ボタン, フォームラベル/placeholder, エラー, toast, empty state 説明
  - 表記ゆれを避けるための用語統一表（投稿/下書き/予約/公開 等）
- `apps/web/src/lib/i18n/labels.ts` に最低限以下を定義:
  - `NAV_LABELS`: `{ href, en, ja }[]` のナビ項目（Sidebar と整合）
  - `SECTION_KICKERS`: ページ単位の eyebrow 英語定数
  - `COMMON_ACTIONS`: `save`, `cancel`, `delete`, `retry` 等の日本語ラベル定数
- 既存コードの書き換えはこの issue では行わない（後続 002-004 で適用）
- 将来の locale 切替を見据え、オブジェクト構造で key-based に定義する
