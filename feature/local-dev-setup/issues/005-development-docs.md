---
id: 005
title: docs/development.md にローカル開発手順を記載
type: feat
depends_on: [001, 002, 003]
files:
  - docs/development.md
  - docs/README.md
done_when:
  - docs/development.md が存在する
  - 前提条件（Node.js, pnpm）、セットアップ手順、起動方法、トラブルシュートが記載されている
  - docs/README.md の Suggested Structure から development.md へのリンクが追加されている
  - 7 つの CLI コマンド（accounts/post/schedule/inbox/usage/llm/skills）の概要が記載されている
---

## Context

`docs/README.md` で `development.md` が計画されているが未作成。clone → 起動 → 動作確認までの手順を記載する。

## Implementation Notes

- セクション構成:
  1. 前提条件（Node.js 20+, pnpm 10+）
  2. セットアップ（`scripts/setup.sh` の実行）
  3. 起動（`pnpm dev`）
  4. 動作確認（ブラウザで各画面、API ヘルスチェック）
  5. CLI の使い方（7 コマンド概要）
  6. OAuth プロバイダの設定（任意）
  7. トラブルシュート（DB リセット、ポート競合、プロバイダ未設定時の挙動）
- 既存の docs/README.md に development.md へのリンクを追加
