# SNS Agent Architecture

## 1. 目的

本ドキュメントは [requirements.md](/Users/kzt/Desktop/project-d/product/sns-agent/docs/requirements.md) を実装可能な構成に落とすためのアーキテクチャ定義である。

対象は以下。

- Web UI
- CLI
- API / Scheduler / Webhook
- LLM 連携
- skills パッケージ機構
- X / LINE / Instagram 向け provider 抽象

## 2. 設計原則

- 共通ドメインと SNS 固有実装を分離する
- 人間操作と AI 操作を同一 API と監査モデルに通す
- CLI は第一級インターフェースとして設計する
- 書き込み系操作は必ず権限・予算・承認を通す
- provider / llm / skills は差し替え可能にする
- まずは v1 を単純に作り、分散化は後から行う

## 3. システムコンテキスト

```txt
Human Operator
  -> Web UI
  -> API

AI Agent / CLI User
  -> CLI
  -> SDK / API

Web UI Chat
  -> Agent Gateway
  -> LLM Adapter
  -> Skills Runtime
  -> API

API
  -> Core Services
  -> Provider Adapters (X / LINE / Instagram)
  -> Database
  -> Queue / Scheduler
  -> Audit / Usage / Budget
```

## 4. 論理構成

### 4.1 レイヤ

```txt
Presentation
  - apps/web
  - packages/cli

Application
  - command handlers
  - use cases
  - approval policies
  - llm orchestration

Domain
  - account
  - post
  - inbox
  - usage
  - budget
  - skills
  - routing
  - audit

Infrastructure
  - db
  - queue
  - provider adapters
  - llm adapters
  - secret storage
```

### 4.2 モノレポ推奨構成

```txt
apps/
  web/
  api/
packages/
  core/
    domain/
    application/
    policies/
  db/
  sdk/
  cli/
  ui/
  llm/
  skills/
  provider-x/
  provider-line/
  provider-instagram/
  config/
docs/
```

## 5. コンポーネント責務

### 5.1 `apps/web`

- Next.js ベースの管理画面
- DaisyUI を使った UI レイヤ
- `@phosphor-icons/react` を用いたナビゲーション
- 投稿、予約、受信トレイ、使用量、LLM ルーティング、skills 管理、チャット画面を提供
- 書き込み系は API を直接叩かず server-side の service 経由で実行

### 5.2 `apps/api`

- REST API または RPC API を提供
- Webhook 受信
- 予約ジョブ実行
- provider 呼び出し前の権限・予算・承認チェック
- 監査ログと usage 記録の集約点

### 5.3 `packages/core`

- ビジネスルールの中心
- UI や CLI に依存しない use case を持つ
- provider 共通インターフェースを定義する

主要 use case:

- `connectAccount`
- `createPost`
- `schedulePost`
- `publishPost`
- `listInboxThreads`
- `recordUsage`
- `evaluateBudgetPolicy`
- `resolveLlmRoute`
- `executeSkillAction`

### 5.4 `packages/sdk`

- TypeScript SDK
- CLI と Web API client の共通土台
- 外部導入時の正式インターフェース

### 5.5 `packages/cli`

- 非対話実行を優先した CLI
- `--json` の機械可読出力を持つ
- API client と同じバリデーションルールを共有する

### 5.6 `packages/llm`

- LLM provider の抽象化
- Codex / Claude Code / 将来モデルの接続口
- route 解決、fallback、usage 記録、制限適用を担当

### 5.7 `packages/skills`

- skills パッケージ仕様
- skill manifest、引数定義、権限スコープ、互換情報を管理
- `platform + llm provider` ごとの bundle 生成を担当

### 5.8 `packages/provider-*`

- 各 SNS の API / webhook / payload 差分を吸収
- 共通 capability にマッピングできない機能は拡張 capability として保持

## 6. ドメイン境界

### 6.1 中核エンティティ

- `Workspace`
- `User`
- `AgentIdentity`
- `SocialAccount`
- `PostDraft`
- `ScheduledJob`
- `ConversationThread`
- `Message`
- `UsageRecord`
- `BudgetPolicy`
- `LlmRoute`
- `SkillPackage`
- `ApprovalRequest`
- `AuditLog`

### 6.2 集約の考え方

- `SocialAccount` は provider 接続状態と権限を持つ
- `PostDraft` は投稿本文、添付、対象 platform、検証結果を持つ
- `ScheduledJob` は予約実行の状態遷移を持つ
- `UsageRecord` は API 使用量と推定コストの最小記録単位
- `BudgetPolicy` は停止条件と警告条件を持つ
- `LlmRoute` は platform / action / workspace に対する解決順を持つ

## 7. Provider 抽象

### 7.1 共通インターフェース

```ts
interface SocialProvider {
  platform: "x" | "line" | "instagram" | string;
  getCapabilities(): ProviderCapabilities;
  connectAccount(input: ConnectAccountInput): Promise<ConnectAccountResult>;
  validatePost(input: ValidatePostInput): Promise<ValidationResult>;
  publishPost(input: PublishPostInput): Promise<PublishResult>;
  scheduleSupport(): Promise<ScheduleSupport>;
  listThreads(input: ListThreadsInput): Promise<ListThreadsResult>;
  getUsage(input: GetUsageInput): Promise<UsageSnapshot>;
  handleWebhook(input: WebhookInput): Promise<WebhookResult>;
}
```

### 7.2 capability モデル

provider ごとの差分は capability で管理する。

例:

- `supportsTextPost`
- `supportsImagePost`
- `supportsVideoPost`
- `supportsThreadPost`
- `supportsDirectMessage`
- `supportsCommentReply`
- `supportsBroadcast`
- `supportsNativeSchedule`
- `supportsUsageApi`

UI と CLI は capability を参照して入力項目やコマンド可用性を制御する。

### 7.3 provider 固有拡張

共通モデルに無理に押し込まず、固有機能は namespaced な拡張として扱う。

例:

- Instagram コメントトリガー
- LINE リッチメッセージ
- X スレッド投稿

## 8. AI / LLM / Skills アーキテクチャ

### 8.1 主要コンポーネント

```txt
Web Chat / CLI
  -> Agent Gateway
  -> Route Resolver
  -> LLM Adapter
  -> Skill Planner
  -> Skill Executor
  -> Core Use Cases
```

### 8.2 Agent Gateway

- Web UI のチャット入力を受ける
- actor を `User` または `AgentIdentity` に解決する
- workspace、対象 platform、許可された skill scope を文脈に注入する

### 8.3 Route Resolver

- `platform`
- `action`
- `workspace`
- `cost ceiling`
- `fallback policy`

上記を元に使用モデルを決定する。

### 8.4 Skill Planner / Executor

- モデル出力を任意コマンドに直結しない
- 実行可能なのは manifest 登録済み skill のみ
- 引数検証、権限検証、予算検証、dry-run、承認の順に通す

### 8.5 実行モード

- `read-only`
- `draft`
- `approval-required`
- `direct-execute`

v1 の推奨デフォルトは `approval-required`。

## 9. データフロー

### 9.1 投稿作成から予約まで

```txt
Web UI / CLI
  -> CreatePost use case
  -> Provider.validatePost
  -> save PostDraft
  -> create ScheduledJob
  -> enqueue job

Scheduler
  -> lock job
  -> budget check
  -> approval check
  -> Provider.publishPost
  -> record UsageRecord
  -> write AuditLog
  -> update ScheduledJob status
```

### 9.2 Web UI チャットから操作まで

```txt
User message
  -> Agent Gateway
  -> resolve LlmRoute
  -> model response with skill intent
  -> skill validation
  -> dry-run preview
  -> optional approval
  -> execute use case
  -> audit + usage logging
  -> chat timeline update
```

### 9.3 Webhook 受信

```txt
SNS Webhook
  -> apps/api webhook endpoint
  -> provider adapter parse/verify
  -> normalize event
  -> store thread/message/event
  -> trigger rules or notify operators
```

## 10. データストア

### 10.1 推奨

- 主 DB: PostgreSQL
- ローカル/軽量環境: SQLite 互換構成を許容
- Queue: DB queue またはマネージド queue
- Blob: 画像・動画メタデータ用にオブジェクトストレージ

### 10.2 保存対象

- 認証対象メタデータ
- 投稿ドラフト
- 添付ファイル参照
- 予約ジョブ
- 受信会話
- usage records
- budget policies
- llm routes
- skill manifests
- approvals
- audit logs

### 10.3 保存しないもの

- 生の秘密鍵の平文
- 長期保存不要な LLM 一時文脈
- 再生成可能な一時レスポンス

## 11. API 設計方針

### 11.1 API 分類

- `public API`: SDK / CLI 用
- `internal API`: Web UI server-side 用
- `webhook API`: SNS 受信専用
- `agent API`: Web UI チャットと skill 実行用

### 11.2 原則

- 書き込み操作は idempotency key に対応する
- 非同期操作は job resource を返す
- 監査対象操作には actor と request id を必須にする
- `--json` 出力と API のレスポンス形状を可能な限り揃える

## 12. 権限と承認

### 12.1 権限モデル

- `viewer`
- `operator`
- `editor`
- `admin`
- `owner`
- `agent`

### 12.2 評価順

1. 認証
2. workspace 所属確認
3. role 判定
4. skill scope 判定
5. budget policy 判定
6. approval policy 判定
7. provider 実行

### 12.3 承認対象

- 投稿の即時公開
- 大量配信
- AI による自動返信
- 予算閾値超過時の続行

## 13. 使用量・コスト管理

### 13.1 収集ポイント

- provider API call
- LLM API call
- queue 実行
- 添付アップロード

### 13.2 主要指標

- request count
- success rate
- failure count
- retry count
- estimated cost
- budget consumed percentage

### 13.3 制御ポリシー

- `warn`
- `require-approval`
- `block`

## 14. Web UI 設計方針

### 14.1 UI 構造

- `Dashboard`
- `Posts`
- `Calendar`
- `Inbox`
- `Usage`
- `Skills`
- `Agents`
- `Settings`

### 14.2 デザインシステム

- DaisyUI をベースにテーマ拡張する
- アイコンは `@phosphor-icons/react`
- 色は LINE のグリーン、X の黒基調、Instagram の暖色アクセントを統合する

推奨トークン:

```txt
primary: #06C755
secondary: #111111
accent: #FF7A59
accent-2: #F77737
surface: #FFFDF8
base-content: #1F2937
muted: #6B7280
border: #E8E3DA
```

## 15. デプロイ方針

### 15.1 v1 推奨

- `apps/web` と `apps/api` を同一リポジトリで運用
- まずは単一リージョン
- queue / cron / webhook を同一運用面で管理

### 15.2 将来拡張

- Webhook 処理の分離
- Scheduler ワーカーの分離
- provider ごとの高負荷処理分離
- マルチワークスペース課金分離

## 16. 実装順序

### Phase 1

- `packages/core`
- `packages/db`
- `packages/sdk`
- `packages/cli`
- `apps/api`
- `apps/web` の基本画面

### Phase 2

- provider-x
- provider-line
- provider-instagram
- usage / budget
- audit / approval

### Phase 3

- llm routing
- agent gateway
- skills packaging
- web chat

## 17. 主要な技術判断

- provider は adapter pattern を採用する
- skills は任意コード実行ではなく manifest 駆動で制御する
- AI 実行は直接 provider を叩かず use case を通す
- CLI / Web UI / Chat は共通 core を通す
- 料金可視化は billing exact ではなく estimated cost を基本とする

## 18. オープンクエスチョン

- API スタイルを REST 中心にするか RPC 寄りにするか
- queue を DB ベースで始めるか専用基盤を採用するか
- LLM 実行を同期応答中心にするか agent job 化するか
- skills manifest をどの程度標準仕様に寄せるか
- provider の OAuth 更新処理をどこまで自動化するか
