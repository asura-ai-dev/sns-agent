# SNS Agent v1 - High-Level Specification

## 目的

SNS Agent は、X / LINE / Instagram の3つのSNSを統一基盤で運用するためのプラットフォームである。人間向け Web UI、AIエージェント向け CLI、LLM統合向け SDK/skills パッケージの3経路から同一のドメインロジックを通じて操作でき、投稿・予約・会話参照・コスト管理・AI支援を一元化する。

既存の個別SNSハーネス（x-harness-oss, line-harness-oss, instagram-harness-oss）の強みを統合し、複数SNSを横断して扱える抽象化レイヤを提供することで、運用コストの削減と AI エージェントによる運用自動化を実現する。

## 主要機能

### P0（v1 必須）

1. **モノレポ基盤構築** - TypeScript モノレポとして apps/web, apps/api, packages/\* を構成し、ビルド・テスト・リントが統一的に実行できる
2. **認証・権限管理（RBAC）** - viewer / operator / editor / admin / owner / agent の6ロールによるアクセス制御。ユーザーと AI エージェントの両方に権限主体を割り当てられる
3. **SNSアカウント接続** - X / LINE / Instagram のアカウントを OAuth 等で接続し、接続状態・トークン有効期限・権限不足を検知できる
4. **投稿管理** - テキスト・画像・動画を含む投稿の作成、下書き保存、即時投稿、削除。SNSごとの投稿制約を事前検証できる
5. **予約投稿** - 投稿を指定日時に予約し、ジョブの成功・失敗・再試行状態を追跡できる
6. **投稿一覧** - 全SNS横断で投稿を一覧・フィルタ・検索できる
7. **CLI** - 非対話実行を優先し、`--json` 出力に対応した CLI。accounts / post / schedule / inbox / usage / llm / skills の主要コマンドを提供
8. **Web UI 基本画面** - Next.js + DaisyUI + Tailwind CSS。ダッシュボード、投稿一覧、投稿作成、予約カレンダー、設定の各画面
9. **API使用量・コスト可視化** - SNS API / LLM API の使用回数、失敗率、推定料金を日次・週次・月次で集計・表示できる
10. **予算ポリシー** - ワークスペース単位、SNS単位、エンドポイント単位の上限設定。超過時の warn / require-approval / block を選択できる
11. **LLMルーティング設定** - SNS / アクション / ワークスペース単位でどの LLM モデルを使うか設定・保存できる。フォールバック設定を含む

### P1（v1 スコープ内だが P0 後に着手）

12. **Web UI チャットインターフェース** - チャット形式で AI オペレータを呼び出し、skills 経由で許可された操作を実行できる。実行前プレビュー・承認を含む
13. **skills パッケージ機構** - SNS操作を skills パッケージとして定義・生成・有効化できる。manifest 駆動で権限スコープ・引数仕様・互換性を管理
14. **受信・会話管理** - X リプライ/DM、LINE チャット、Instagram DM/コメントの参照。AI 返信案生成（書き込みは承認設定に従う）
15. **監査ログ** - 全操作について actor、対象SNS、対象アカウント、入力、結果、コストを記録・参照できる
16. **承認フロー** - 書き込み操作に対する承認必須ルールの設定と承認ワークフロー

## 受け入れ条件

### アカウント接続

- AC-1: X / LINE / Instagram の3つのSNSでアカウント接続が完了し、接続状態が UI と CLI の両方から確認できる
- AC-2: トークン有効期限切れ時に警告が表示され、再認証フローに誘導される

### 投稿管理

- AC-3: Web UI から各SNSに対してテキスト投稿を作成・下書き保存・即時投稿できる
- AC-4: CLI から `sns post create --platform x --account <name> --text "..."` で投稿を作成できる
- AC-5: SNSごとの文字数制限等を事前検証し、違反時にエラーメッセージを返す
- AC-6: 投稿を指定日時に予約でき、予約ジョブの状態（pending / running / succeeded / failed / retrying）を確認できる

### CLI

- AC-7: `sns accounts list --json` で接続済みアカウント一覧が JSON で出力される
- AC-8: `sns post list --platform <p> --json` で投稿一覧が JSON で出力される
- AC-9: `sns usage report --platform <p> --range month --json` で月次使用量が JSON で出力される
- AC-10: 全コマンドが非対話で完結し、終了コード 0（成功）/ 1（エラー）を返す

### Web UI

- AC-11: ダッシュボード画面で全SNSの投稿数・予約数・使用量サマリが表示される
- AC-12: 投稿作成画面で SNS を選択し、投稿内容を入力・プレビュー・送信できる
- AC-13: 予約カレンダー画面で予約済み投稿がカレンダー表示される
- AC-14: 使用量画面で SNS API / LLM API の使用量と推定コストがグラフ表示される
- AC-15: デスクトップ（1280px以上）とモバイル（375px以上）の両方で操作可能である

### チャット・AI連携

- AC-16: Web UI のチャット画面から LLM を呼び出し、投稿作成等の操作を指示できる
- AC-17: チャットからの操作実行前にプレビューが表示され、承認後に実行される
- AC-18: LLMルーティング設定画面で platform / action ごとのモデル割当を保存・変更できる

### skills

- AC-19: `sns skills pack --platform x --provider codex` で skills パッケージが生成される
- AC-20: 生成された skills パッケージを有効化し、チャットから利用できる

### 権限・監査

- AC-21: ロールに応じてメニュー項目と操作可否が制御される（viewer は読み取りのみ等）
- AC-22: 監査ログ画面で AI 実行履歴（actor, 操作, 対象SNS, 結果, コスト）を検索・参照できる

## 非機能要件

### 拡張性

- 新しい SNS を `packages/provider-<name>` として追加でき、core の変更なしに capability ベースで機能が有効化される
- LLM プロバイダを `packages/llm` のアダプタとして追加できる

### パフォーマンス

- Web UI の初期表示が 3 秒以内（LCP）
- CLI コマンドの応答が 5 秒以内（外部 API 待ちを除く）
- 予約ジョブの実行遅延が指定時刻から 60 秒以内

### セキュリティ

- API キー、OAuth トークン、LLM キーは暗号化して保管する
- 監査ログは追記のみ（上書き・削除不可）で設計する
- AI 実行時に危険コマンド（大量送信、アカウント削除等）のガードを設ける

### 可用性

- 予約投稿の実行失敗時に自動再試行（最大3回、exponential backoff）
- 外部 API 障害時に縮退動作（エラー表示 + ジョブ保留）

### 観測性

- アプリログ、監査ログ、ジョブログ、API使用量ログを分離する
- 主要失敗イベント（予約失敗、トークン期限切れ、予算超過）の通知手段を持つ

### 準拠性

- 各 SNS の公式 API 利用規約・レート制限を遵守する
- 危険な自動化（大量投稿、自動返信等）は opt-in 設定とする

## 技術選定

### 確定事項

- **モノレポ構成**: apps/web, apps/api, packages/\*
- **Web UI**: Next.js + DaisyUI + Tailwind CSS
- **アイコン**: @phosphor-icons/react
- **言語**: TypeScript（全パッケージ共通）
- **CLI**: Node.js ベース
- **SDK**: TypeScript
- **Provider 抽象**: SocialProvider interface + capability モデル
- **AI 実行制御**: manifest 駆動の skills（任意コード実行ではない）
- **権限モデル**: viewer / operator / editor / admin / owner / agent の 6 ロール

### 確定トークン（デザイン）

```
primary: #06C755
secondary: #111111
accent: #FF7A59
accent-2: #F77737
surface: #FFFDF8
base-content: #1F2937
muted: #6B7280
border: #E8E3DA
info: #2F80ED
warning: #F4B740
error: #E5484D
```

### オープンクエスチョン（architect phase で決定）

- **DB**: PostgreSQL（本番）/ SQLite（ローカル）の切り替え戦略と ORM 選定
- **API スタイル**: REST 中心 vs RPC 寄り
- **Queue / Scheduler**: DB ベース queue vs 専用基盤
- **実行基盤**: Cloudflare Workers vs Node.js サーバー vs ハイブリッド
- **LLM 実行モード**: 同期応答 vs agent job 化
- **skills 配布フォーマット**: 独自 vs 既存エージェント仕様準拠
- **provider OAuth 更新**: 自動化の範囲
- **Web UI から LLM を呼ぶ際の認証・課金責任分離**
- **モノレポツール**: turborepo / nx / pnpm workspaces 等の選定
- **テストフレームワーク**: vitest / jest 等の選定

## v1 スコープ境界

### v1 に含む

- X / LINE / Instagram の 3 SNS
- テキスト投稿、画像・動画添付投稿
- 下書き、予約、即時投稿、削除
- 受信・会話の参照（読み取り）
- CLI の主要コマンド（accounts, post, schedule, inbox, usage, llm, skills）
- Web UI の全主要画面（10画面）
- Web UI チャットからの AI 操作
- LLM ルーティング設定
- skills パッケージの生成・有効化（最低 1 パッケージ）
- RBAC + 承認フロー + 監査ログ
- API 使用量・推定コスト・予算ポリシー

### v1 に含まない（v1.5 以降）

- TikTok / YouTube / Threads 等の追加 SNS
- 複数ワークスペース
- 請求連携（実課金額との突合）
- 高度な分析・スコアリング
- クロス SNS キャンペーンテンプレート
- スレッド投稿、カルーセル等の高度な投稿形式（拡張ポイントは v1 で用意）

## 実装順序

### Phase 1: 基盤構築

モノレポ骨格、共通ドメイン（packages/core）、DB スキーマ（packages/db）、SDK（packages/sdk）、API サーバー骨格（apps/api）。全ての後続フェーズの土台となるため最初に着手する。

### Phase 2: 認証・アカウント・投稿

認証/権限（RBAC）、SocialAccount 管理、PostDraft / ScheduledJob のドメインとユースケース。Provider 抽象（SocialProvider interface）を定義し、最低 1 SNS（X）で接続・投稿が動く状態にする。

### Phase 3: CLI + Web UI 基本

CLI の主要コマンド実装、Web UI の基本画面（ダッシュボード、投稿一覧、投稿作成、予約カレンダー、設定、help/CLI リファレンス）。Phase 2 のドメインを操作する Presentation 層。

### Phase 4: 全 SNS 対応 + 使用量

provider-line, provider-instagram の実装。使用量記録（UsageRecord）、予算ポリシー（BudgetPolicy）、コスト可視化画面。

### Phase 5: AI 連携

LLM ルーティング、Agent Gateway、skills パッケージ機構、Web UI チャットインターフェース。Phase 2-4 の core use cases を AI 経由で呼び出せるようにする。

### Phase 6: 監査・承認・受信

監査ログ、承認フロー、受信・会話管理（Inbox）。書き込み系操作の安全性を担保する最終レイヤ。

注: この順序は推奨であり、依存関係を考慮した上で実装者の判断で調整してよい。ただし Phase 1 は必ず最初に完了させること。

## 評価観点

### 主要ユーザーフロー

- SNS アカウントを接続し、投稿を作成・予約・公開する一連のフローが Web UI / CLI の両方で完遂できるか
- Web UI チャットから AI に投稿作成を指示し、プレビュー・承認・実行の流れが動作するか
- viewer ロールのユーザーが書き込み操作をブロックされるか

### API

- CLI / Web UI / SDK が共通の core use cases を経由しており、挙動が一致するか
- `--json` 出力と API レスポンスの形状が整合しているか
- idempotency key による重複実行防止が機能するか

### 保存状態

- 投稿の下書き→予約→公開の状態遷移が正しく永続化されるか
- 監査ログが全操作を漏れなく記録しており、追記のみで改ざんされていないか
- LLM ルーティング設定が保存・復元できるか

### エラー時挙動

- SNS API の認証エラー時にトークン再取得フローに誘導されるか
- 予約ジョブ失敗時に再試行が行われ、最終的な失敗状態が記録されるか
- 予算超過時に設定されたポリシー（warn / require-approval / block）が適用されるか
- 存在しない SNS アカウントや不正な入力に対して明確なエラーメッセージが返るか
