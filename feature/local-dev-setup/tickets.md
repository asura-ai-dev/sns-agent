# local-dev-setup Tickets

Spec: [spec.md](spec.md)

clone → pnpm dev → 動作確認を迷わず完了できる状態にする。

## Phase 1: 基盤（並列可）

- [ ] #003 [gh#22](https://github.com/asura-ai-dev/sns-agent/issues/22) Next.js rewrites で API proxy を設定
- [ ] #004 [gh#19](https://github.com/asura-ai-dev/sns-agent/issues/19) style jsx 修正を main に反映

## Phase 2: セットアップ自動化

- [x] #001 [gh#20](https://github.com/asura-ai-dev/sns-agent/issues/20) .env 自動生成スクリプトの作成
- [ ] #002 [gh#21](https://github.com/asura-ai-dev/sns-agent/issues/21) DB 初期化ワンコマンド化（depends_on: 001）

## Phase 3: ドキュメント

- [ ] #005 [gh#23](https://github.com/asura-ai-dev/sns-agent/issues/23) docs/development.md にローカル開発手順を記載（depends_on: 001, 002, 003）

## 並列実行の可能性

- Phase 1: #003 と #004 は独立、並列可
- Phase 2: #001 → #002 は直列
- Phase 3: #005 は全 issue 完了後（手順の最終確認を兼ねる）
- クリティカルパス: #001 → #002 → #005

## 次の一手

- `/issue-dev 003` と `/issue-dev 004` を並列で着手（既にほぼ完了済み）
- `/issue-dev 001` でセットアップスクリプト作成
