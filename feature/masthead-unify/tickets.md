# masthead-unify Tickets

Spec: [spec.md](spec.md)

全ページ masthead 統一 + Sidebar を `NAV_LABELS` ベースへ差し替える feature。
`ui-polish-v2` で敷いた「英語 kicker + 日本語本文」の原則を各ページの masthead と Sidebar に徹底させる。

GitHub issues: 未登録（後続で同期）

## Phase 1: 辞書基盤

- [ ] #001 labels.ts に `MASTHEAD_TITLES` / `HELP_SECTIONS` を追加し、`NAV_LABELS` に `/help`、`SECTION_KICKERS` に `help` を追加する

## Phase 2: masthead 適用

- [ ] #002 dashboard / posts / posts/new / calendar / inbox の masthead を `MASTHEAD_TITLES` 駆動に差し替え（depends_on: 001）
- [ ] #003 usage / skills / agents の masthead を `MASTHEAD_TITLES` 駆動に差し替え（depends_on: 001）
- [ ] #004 settings 5 ページと /help の masthead を `MASTHEAD_TITLES` 駆動に差し替え、/help の 6 セクションを `HELP_SECTIONS` に寄せる（depends_on: 001）

## Phase 3: Sidebar

- [ ] #005 Sidebar の `NAV_ITEMS` を `NAV_LABELS` ベースに差し替え、`/help` を出現させる（depends_on: 001）

## 並列実行の可能性

- Phase 1: 001 単独
- Phase 2 / 3: 002 / 003 / 004 / 005 はいずれも 001 完了後に並列実行可能
  - ただし 002 は `app/(dashboard)/page.tsx`, 003 は `components/{usage,skills,chat}/*`, 004 は `settings/*` + `help/page.tsx`, 005 は `components/layout/Sidebar.tsx` と、**触るファイルが完全に分離しているため衝突しない**
- クリティカルパス: 001 → max(002, 003, 004, 005)

## 次の一手

- `/issue-dev 001` で辞書拡張から着手
- 001 完了後、002 / 003 / 004 / 005 を並列にキックして良い
