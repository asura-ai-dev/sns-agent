---
id: 003
title: Next.js rewrites で API proxy を設定
type: feat
depends_on: []
files:
  - apps/web/next.config.ts
done_when:
  - next.config.ts に /api/* → localhost:3001 の rewrites が設定されている
  - API_URL 環境変数でバックエンド URL を上書き可能
  - pnpm --filter @sns-agent/web build が成功する
---

## Context

Web UI は `/api/accounts` 等を fetch するが、Next.js に API route がなく、別プロセスの Hono API (3001) に到達しない。rewrites で proxy する。

## Implementation Notes

- 既に `apps/web/next.config.ts` に rewrites を追加済み（未コミット）
- コミットするだけで完了
