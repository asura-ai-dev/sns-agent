---
id: 001
title: .env 自動生成スクリプトの作成
type: feat
depends_on: []
files:
  - scripts/setup.sh
  - .env.example
done_when:
  - scripts/setup.sh が存在し実行可能
  - .env が存在しない状態で scripts/setup.sh を実行すると .env が生成される
  - 生成された .env に DATABASE_URL=file:./dev.db が含まれる
  - ENCRYPTION_KEY が 64 文字の hex で自動生成されている
  - .env が既に存在する場合は上書きせず警告を出す
---

## Context

現状 `.env.example` はあるが、コピー後に手動で値を埋める必要がある。開発用デフォルト値を自動で埋���るスクリプトを用意する。

## Implementation Notes

- `cp .env.example .env` をベースに、sed で値を注入
- `ENCRYPTION_KEY` は `openssl rand -hex 32` で生成
- `DATABASE_URL=file:./dev.db` をデフォルト設定
- `API_PORT=3001`, `WEB_URL=http://localhost:3000`, `NODE_ENV=development` を設定
- OAuth 系の値は空のまま（コメントで説明）
