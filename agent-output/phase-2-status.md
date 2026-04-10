# Phase 2: Architecture

- 目的: spec.md を詳細設計ドキュメントとフェーズ分けタスクチケットに分解する
- 開始日: 2026-04-10
- 更新日: 2026-04-10

## Spec Alignment

- spec.md の全機能（P0: 11項目、P1: 5項目）を6フェーズ・34チケットに分解

## Phase

Complete (pass)

## Completed

- agent-docs/design.md 作成（オープンクエスチョン10項目の決定、DBスキーマ13テーブル、REST API全エンドポイント、パッケージ間依存、RBAC権限マトリクス等）
- tasks/phases.md 作成（6フェーズ・34チケットの一覧と依存関係）
- 34チケット x 2ファイル = 68ファイル作成
  - Phase 1: 基盤構築（6チケット: 1001-1006）
  - Phase 2: 認証・アカウント・投稿（6チケット: 2001-2006）
  - Phase 3: CLI + Web UI基本（8チケット: 3001-3008）
  - Phase 4: 全SNS対応 + 使用量（5チケット: 4001-4005）
  - Phase 5: AI連携（5チケット: 5001-5005）
  - Phase 6: 監査・承認・受信（4チケット: 6001-6004）

## In Progress

- なし

## Not Started

- なし

## Failed Tests / Known Issues

- なし

## Key Decisions

- DB: Drizzle ORM + SQLite（ローカル）/ PostgreSQL（本番）切り替え
- API: Hono REST
- Queue: DB queue（polling worker）
- モノレポ: pnpm workspaces + turborepo
- テスト: vitest
- LLMアダプタ: OpenAI / Anthropic SDK

## Next Step

- Phase 2.5: 全34チケットを TaskCreate で登録し、依存関係を設定する

## Files Changed

- agent-docs/design.md（新規作成）
- tasks/phases.md（新規作成）
- tasks/phase-1/ ~ tasks/phase-6/（68ファイル新規作成）
