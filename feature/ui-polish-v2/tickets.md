# ui-polish-v2 Tickets

Spec: [spec.md](spec.md)

Phase 3/4/5/6 の UI 改善指摘と新規要求を 16 issue に分解。
GitHub issues: asura-ai-dev/sns-agent #1〜#16（ローカル ID == GH 番号）

## Phase 1: 基盤整備

- [x] #001 [gh#1](https://github.com/asura-ai-dev/sns-agent/issues/1) 言語レイヤルール定義と共通辞書の整備
- [x] #002 [gh#2](https://github.com/asura-ai-dev/sns-agent/issues/2) 言語ルールを dashboard / usage / skills / agents に適用（depends_on: 001）
- [x] #003 [gh#3](https://github.com/asura-ai-dev/sns-agent/issues/3) 言語ルールを posts / calendar / inbox に適用（depends_on: 001）
- [x] #004 [gh#4](https://github.com/asura-ai-dev/sns-agent/issues/4) 言語ルールを settings 系 5 ページに適用（depends_on: 001）
- [x] #005 [gh#5](https://github.com/asura-ai-dev/sns-agent/issues/5) Sidebar を paper ベーストークンに差し替え

## Phase 2: 主要改善

- [x] #006 [gh#6](https://github.com/asura-ai-dev/sns-agent/issues/6) PlatformIcon にチップ用 variant を追加
- [x] #007 [gh#7](https://github.com/asura-ai-dev/sns-agent/issues/7) PostFilters のプラットフォームチップを PlatformIcon 化（depends_on: 006）
- [ ] #008 [gh#8](https://github.com/asura-ai-dev/sns-agent/issues/8) settings/accounts の接続ボタンとカードで PlatformIcon を統一（depends_on: 006）
- [ ] #009 [gh#9](https://github.com/asura-ai-dev/sns-agent/issues/9) Inbox のプラットフォーム絞り込みとスレッド行を PlatformIcon 化（depends_on: 006）
- [ ] #010 [gh#10](https://github.com/asura-ai-dev/sns-agent/issues/10) dashboard PlatformOverview のシンボルを PlatformIcon に統一（depends_on: 006）
- [x] #011 [gh#11](https://github.com/asura-ai-dev/sns-agent/issues/11) Sidebar のホバー自動展開（collapsed / expanded 2 状態）（depends_on: 005）

## Phase 3: 新規機能

- [x] #012 [gh#12](https://github.com/asura-ai-dev/sns-agent/issues/12) /help ページを作成し Web UI 主要機能セクションを追加（depends_on: 001, 005）
- [ ] #013 [gh#13](https://github.com/asura-ai-dev/sns-agent/issues/13) /help ページに CLI リファレンスセクションを追加（depends_on: 012）
- [x] #014 [gh#14](https://github.com/asura-ai-dev/sns-agent/issues/14) Header にプラットフォーム表示モードトグルと状態フックを追加
- [ ] #015 [gh#15](https://github.com/asura-ai-dev/sns-agent/issues/15) /posts に columns 表示モードを実装（depends_on: 007, 014）
- [ ] #016 [gh#16](https://github.com/asura-ai-dev/sns-agent/issues/16) /inbox に columns 表示モードを実装（depends_on: 009, 014）

## 並列実行の可能性

- Phase 1: 001 → 002/003/004 並列、005 は独立
- Phase 2: 006 → 007/008/009/010 並列、011 は 005 の後
- Phase 3: 012 → 013 直列、014 独立、015/016 はそれぞれ 007/009 + 014 の後
- クリティカルパス: 001 → 004 → 012 → 013（Phase 1+3 の言語依存）と 006 → 009 → 016（Phase 2+3）

## 次の一手

- `/issue-dev 001` で最初の issue に着手
- `/issue-next` で blockedBy が空の次の着手可能 issue を自動選択
