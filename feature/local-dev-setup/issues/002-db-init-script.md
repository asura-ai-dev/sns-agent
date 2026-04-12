---
id: 002
title: DB 初期化ワンコマンド化
type: feat
depends_on: [001]
files:
  - scripts/setup.sh
  - packages/db/package.json
done_when:
  - scripts/setup.sh 実行後に dev.db ファイルが生成される
  - dev.db に socialAccounts / posts / workspaces 等のテーブルが存在する
  - seed データ（デフォルト workspace + owner user）が挿入されている
  - 2 回目の実行でも冪等に動作する（エラーにならない）
---

## Context

現状は `cd packages/db && npx tsx src/seed.ts` を手動で実行する必要がある。setup.sh に DB 初期化を統合する。

## Implementation Notes

- `pnpm --filter @sns-agent/db db:push` でスキーマ適用
- `npx tsx packages/db/src/seed.ts` で seed 投入
- seed.ts は既存データがあればスキップする冪等設計（要確認、なければ追加）
- setup.sh の .env 生成ステップの後に DB 初期化を追加
