# SNS Agent v1 - 詳細設計書

## 1. オープンクエスチョンの決定

### 1.1 DB / ORM

- **ORM**: Drizzle ORM を採用する
- **DB 切り替え戦略**: Drizzle の driver abstraction を利用し、`packages/db` 内で PostgreSQL driver と better-sqlite3 driver を切り替え可能にする
- **ローカル開発**: SQLite（better-sqlite3）をデフォルトとする。`.env` の `DATABASE_URL` で `file:./dev.db` を指定
- **本番**: PostgreSQL。`DATABASE_URL` に `postgres://` を指定すると自動切り替え
- **マイグレーション**: Drizzle Kit を使用。スキーマ定義は TypeScript で `packages/db/src/schema/` に配置

### 1.2 API スタイル

- **REST 中心**を採用する
- リソース指向のエンドポイント設計（`/api/accounts`, `/api/posts`, `/api/schedules` 等）
- 書き込み操作は `POST` / `PATCH` / `DELETE`、`X-Idempotency-Key` ヘッダ対応
- Agent Gateway 向けのみ RPC 風エンドポイント（`/api/agent/execute`）を許容
- API フレームワーク: **Hono** を採用（軽量、TypeScript ネイティブ、Edge 互換）

### 1.3 Queue / Scheduler

- **DB ベース queue** を v1 で採用する
- `packages/db` に `scheduled_jobs` テーブルを持ち、polling ワーカーで実行する
- ジョブ状態: `pending` -> `locked` -> `running` -> `succeeded` / `failed` / `retrying`
- Polling 間隔: 10 秒。`locked_at` + TTL でデッドロック回避
- 再試行: 最大 3 回、exponential backoff（30s, 120s, 480s）
- 将来的に BullMQ 等への差し替えを可能にするため、`packages/core` に `JobQueue` interface を定義

### 1.4 実行基盤

- **Node.js サーバー**を v1 で採用する（Cloudflare Workers は v1.5 以降で検討）
- `apps/api`: Hono on Node.js
- `apps/web`: Next.js（standalone モード）
- Scheduler Worker: `apps/api` 内の別プロセスまたは同一プロセスの setInterval

### 1.5 LLM 実行モード

- **同期応答**を基本とし、タイムアウト（30 秒）超過時のみ agent job 化する
- Web UI チャットは SSE（Server-Sent Events）でストリーミングレスポンスを返す
- CLI からの LLM 呼び出しも同期応答が基本

### 1.6 skills 配布フォーマット

- **独自 manifest 形式**を v1 で採用する
- manifest は JSON で定義（`skill.manifest.json`）
- 将来的に OpenAI function calling / Anthropic tool use 形式へのエクスポートを検討
- manifest 内容: name, version, platform, provider, actions[], permissions[], args schema (JSON Schema)

### 1.7 Provider OAuth 更新

- v1 ではトークンの有効期限チェック + ユーザーへの再認証誘導を実装
- 自動リフレッシュは refresh_token を持つプラットフォーム（Instagram）でのみ実装
- X は OAuth 2.0 PKCE + refresh_token で自動更新
- LINE は Channel Access Token v2.1 で長期トークンを使用（期限管理のみ）

### 1.8 Web UI から LLM を呼ぶ際の認証・課金

- LLM API キーはワークスペースの設定としてサーバーサイドに保管
- Web UI ユーザーは自身の LLM キーを直接触らない（サーバーが代理呼び出し）
- usage 記録に actor（User / AgentIdentity）を紐づけて課金追跡可能にする
- 予算ポリシーでワークスペース単位の LLM コスト上限を制御

### 1.9 モノレポツール

- **pnpm workspaces + turborepo** を採用する
- `pnpm-workspace.yaml` でパッケージを定義
- `turbo.json` でビルド・テスト・リントのパイプラインを定義
- パッケージ間の依存は `workspace:*` protocol

### 1.10 テストフレームワーク

- **Vitest** を採用する
- ルート `vitest.config.ts` + 各パッケージの `vitest.config.ts`（workspace mode）
- カバレッジ: `@vitest/coverage-v8`
- E2E テストは Playwright（Web UI）と supertest（API）で補完

## 2. ディレクトリ構成

```
sns-agent/
  apps/
    web/                    # Next.js + DaisyUI + Tailwind
      src/
        app/                # App Router
          (auth)/           # 認証系レイアウト
          (dashboard)/      # ダッシュボード系レイアウト
            page.tsx        # ダッシュボード
            posts/          # 投稿一覧・作成
            calendar/       # 予約カレンダー
            inbox/          # 受信トレイ
            usage/          # 使用量
            skills/         # skills 管理
            agents/         # チャット
            settings/       # 設定
        components/         # 共通 UI コンポーネント
          layout/           # Sidebar, Header 等
          posts/            # 投稿関連
          calendar/         # カレンダー関連
          chat/             # チャット関連
        lib/                # ユーティリティ、API client
        hooks/              # カスタムフック
      tailwind.config.ts
      next.config.ts
    api/                    # Hono API サーバー
      src/
        routes/             # エンドポイント定義
          accounts.ts
          posts.ts
          schedules.ts
          usage.ts
          budget.ts
          llm.ts
          skills.ts
          agent.ts
          audit.ts
          webhooks/
        middleware/          # 認証、RBAC、idempotency、audit
        worker/             # Scheduler polling worker
        index.ts
  packages/
    core/                   # ドメインロジック
      src/
        domain/             # エンティティ、値オブジェクト
        usecases/           # ユースケース
        policies/           # 権限、予算、承認ポリシー
        interfaces/         # Repository, Provider 等のインターフェース
        errors/             # ドメインエラー
    db/                     # DB スキーマ + リポジトリ実装
      src/
        schema/             # Drizzle スキーマ定義
        repositories/       # Repository 実装
        migrations/         # マイグレーションファイル
        client.ts           # DB 接続ファクトリ
    sdk/                    # TypeScript SDK
      src/
        client.ts
        types.ts
    cli/                    # CLI
      src/
        commands/           # 各コマンド
        formatters/         # JSON / human-readable 出力
        index.ts
    ui/                     # 共通 UI コンポーネント（DaisyUI ラッパー）
      src/
        components/
        theme/
    llm/                    # LLM アダプタ
      src/
        adapters/           # OpenAI, Anthropic 等
        router.ts           # Route Resolver
        types.ts
    skills/                 # skills パッケージ機構
      src/
        manifest/           # manifest 定義・パーサー
        runtime/            # skill 実行ランタイム
        builder/            # パッケージビルダー
    provider-x/             # X (Twitter) プロバイダ
      src/
        index.ts
        auth.ts
        post.ts
        inbox.ts
        webhook.ts
    provider-line/          # LINE プロバイダ
      src/
    provider-instagram/     # Instagram プロバイダ
      src/
    config/                 # 共通設定、環境変数スキーマ
      src/
        env.ts
        constants.ts
```

## 3. DB スキーマ設計

### 3.1 主要テーブル

```
workspaces
  id: uuid PK
  name: text NOT NULL
  created_at: timestamp
  updated_at: timestamp

users
  id: uuid PK
  workspace_id: uuid FK -> workspaces
  email: text UNIQUE NOT NULL
  name: text
  role: enum('viewer','operator','editor','admin','owner') NOT NULL
  created_at: timestamp

agent_identities
  id: uuid PK
  workspace_id: uuid FK -> workspaces
  name: text NOT NULL
  role: enum('viewer','operator','editor','admin','owner','agent') NOT NULL
  api_key_hash: text NOT NULL
  created_at: timestamp

social_accounts
  id: uuid PK
  workspace_id: uuid FK -> workspaces
  platform: enum('x','line','instagram') NOT NULL
  display_name: text NOT NULL
  external_account_id: text NOT NULL
  credentials_encrypted: text NOT NULL
  token_expires_at: timestamp
  status: enum('active','expired','revoked','error') NOT NULL DEFAULT 'active'
  capabilities: jsonb
  created_at: timestamp
  updated_at: timestamp

posts
  id: uuid PK
  workspace_id: uuid FK -> workspaces
  social_account_id: uuid FK -> social_accounts
  platform: enum('x','line','instagram') NOT NULL
  status: enum('draft','scheduled','publishing','published','failed','deleted') NOT NULL
  content_text: text
  content_media: jsonb  -- [{type, url, mime_type}]
  platform_post_id: text  -- 投稿後に SNS から返る ID
  validation_result: jsonb
  idempotency_key: text UNIQUE
  created_by: uuid  -- user_id or agent_identity_id
  created_at: timestamp
  updated_at: timestamp
  published_at: timestamp

scheduled_jobs
  id: uuid PK
  workspace_id: uuid FK -> workspaces
  post_id: uuid FK -> posts
  scheduled_at: timestamp NOT NULL
  status: enum('pending','locked','running','succeeded','failed','retrying') NOT NULL
  locked_at: timestamp
  started_at: timestamp
  completed_at: timestamp
  attempt_count: integer DEFAULT 0
  max_attempts: integer DEFAULT 3
  last_error: text
  next_retry_at: timestamp
  created_at: timestamp

conversation_threads
  id: uuid PK
  workspace_id: uuid FK -> workspaces
  social_account_id: uuid FK -> social_accounts
  platform: enum('x','line','instagram') NOT NULL
  external_thread_id: text
  participant_name: text
  last_message_at: timestamp
  status: enum('open','closed','archived') NOT NULL DEFAULT 'open'
  created_at: timestamp

messages
  id: uuid PK
  thread_id: uuid FK -> conversation_threads
  direction: enum('inbound','outbound') NOT NULL
  content_text: text
  content_media: jsonb
  external_message_id: text
  sent_at: timestamp
  created_at: timestamp

usage_records
  id: uuid PK
  workspace_id: uuid FK -> workspaces
  platform: text NOT NULL  -- 'x', 'line', 'instagram', 'openai', 'anthropic' 等
  endpoint: text NOT NULL
  actor_id: uuid
  actor_type: enum('user','agent') NOT NULL
  request_count: integer DEFAULT 1
  success: boolean NOT NULL
  estimated_cost_usd: decimal(10,6)
  recorded_at: timestamp NOT NULL
  created_at: timestamp

budget_policies
  id: uuid PK
  workspace_id: uuid FK -> workspaces
  scope_type: enum('workspace','platform','endpoint') NOT NULL
  scope_value: text  -- platform 名 or endpoint 名（workspace の場合は NULL）
  period: enum('daily','weekly','monthly') NOT NULL
  limit_amount_usd: decimal(10,2) NOT NULL
  action_on_exceed: enum('warn','require-approval','block') NOT NULL DEFAULT 'warn'
  created_at: timestamp
  updated_at: timestamp

llm_routes
  id: uuid PK
  workspace_id: uuid FK -> workspaces
  platform: text  -- NULL = default
  action: text    -- NULL = default
  provider: text NOT NULL  -- 'openai', 'anthropic' 等
  model: text NOT NULL
  temperature: decimal(3,2)
  max_tokens: integer
  fallback_provider: text
  fallback_model: text
  priority: integer DEFAULT 0
  created_at: timestamp
  updated_at: timestamp

skill_packages
  id: uuid PK
  workspace_id: uuid FK -> workspaces
  name: text NOT NULL
  version: text NOT NULL
  platform: text NOT NULL
  llm_provider: text NOT NULL
  manifest: jsonb NOT NULL
  enabled: boolean DEFAULT false
  created_at: timestamp
  updated_at: timestamp

approval_requests
  id: uuid PK
  workspace_id: uuid FK -> workspaces
  resource_type: text NOT NULL  -- 'post', 'budget_override' 等
  resource_id: uuid NOT NULL
  requested_by: uuid NOT NULL
  requested_at: timestamp NOT NULL
  status: enum('pending','approved','rejected','expired') NOT NULL DEFAULT 'pending'
  reviewed_by: uuid
  reviewed_at: timestamp
  reason: text

audit_logs
  id: uuid PK
  workspace_id: uuid FK -> workspaces
  actor_id: uuid NOT NULL
  actor_type: enum('user','agent','system') NOT NULL
  action: text NOT NULL
  resource_type: text NOT NULL
  resource_id: uuid
  platform: text
  social_account_id: uuid
  input_summary: jsonb
  result_summary: jsonb
  estimated_cost_usd: decimal(10,6)
  request_id: text
  created_at: timestamp NOT NULL
  -- 追記のみ: UPDATE / DELETE 不可のポリシーをアプリ層で強制
```

### 3.2 インデックス戦略

- `posts`: (workspace_id, status), (workspace_id, platform, created_at), (idempotency_key)
- `scheduled_jobs`: (status, scheduled_at) -- polling クエリ用
- `usage_records`: (workspace_id, platform, recorded_at)
- `audit_logs`: (workspace_id, created_at), (actor_id, created_at)

## 4. API エンドポイント設計

### 4.1 認証

- セッションベース認証（Web UI）: Next.js の server-side session
- API キー認証（CLI / SDK / Agent）: `Authorization: Bearer <api_key>` ヘッダ
- 両方とも `packages/core/policies` の RBAC チェックを通る

### 4.2 主要エンドポイント

```
# アカウント管理
GET    /api/accounts                    # 一覧
POST   /api/accounts                    # 接続開始（OAuth URL 返却）
GET    /api/accounts/:id                # 詳細
DELETE /api/accounts/:id                # 切断
POST   /api/accounts/:id/refresh        # トークン更新

# 投稿管理
GET    /api/posts                       # 一覧（フィルタ: platform, status, date range）
POST   /api/posts                       # 作成（下書き or 即時投稿）
GET    /api/posts/:id                   # 詳細
PATCH  /api/posts/:id                   # 更新（下書き編集）
DELETE /api/posts/:id                   # 削除
POST   /api/posts/:id/publish           # 即時公開

# 予約
GET    /api/schedules                   # 予約一覧
POST   /api/schedules                   # 予約作成（post_id + scheduled_at）
GET    /api/schedules/:id               # 予約詳細
PATCH  /api/schedules/:id               # 予約変更
DELETE /api/schedules/:id               # 予約キャンセル

# 使用量
GET    /api/usage                       # 使用量集計（period, platform フィルタ）
GET    /api/usage/summary               # サマリ（ダッシュボード用）

# 予算
GET    /api/budget/policies             # ポリシー一覧
POST   /api/budget/policies             # ポリシー作成
PATCH  /api/budget/policies/:id         # ポリシー更新
DELETE /api/budget/policies/:id         # ポリシー削除
GET    /api/budget/status               # 現在の消費状況

# LLM ルーティング
GET    /api/llm/routes                  # ルート一覧
POST   /api/llm/routes                  # ルート作成
PATCH  /api/llm/routes/:id             # ルート更新
DELETE /api/llm/routes/:id             # ルート削除

# Skills
GET    /api/skills                      # パッケージ一覧
POST   /api/skills/generate             # パッケージ生成
PATCH  /api/skills/:id                  # 有効化 / 無効化
GET    /api/skills/:id/manifest         # manifest 取得

# Agent Gateway
POST   /api/agent/chat                  # チャットメッセージ送信（SSE レスポンス）
POST   /api/agent/execute               # skill 実行（承認フロー込み）
GET    /api/agent/history               # チャット履歴

# 受信・会話
GET    /api/inbox                       # スレッド一覧
GET    /api/inbox/:threadId             # メッセージ一覧
POST   /api/inbox/:threadId/reply       # 返信（承認フロー込み）

# 監査
GET    /api/audit                       # 監査ログ一覧（フィルタ: actor, action, date range）

# 承認
GET    /api/approvals                   # 承認リクエスト一覧
POST   /api/approvals/:id/approve       # 承認
POST   /api/approvals/:id/reject        # 却下

# Webhook
POST   /api/webhooks/x                  # X Webhook 受信
POST   /api/webhooks/line               # LINE Webhook 受信
POST   /api/webhooks/instagram          # Instagram Webhook 受信
```

### 4.3 共通レスポンス形式

```typescript
// 成功
{
  data: T,
  meta?: { page, limit, total }
}

// エラー
{
  error: {
    code: string,      // "VALIDATION_ERROR", "UNAUTHORIZED" 等
    message: string,
    details?: unknown
  }
}
```

### 4.4 ミドルウェアチェーン

```
リクエスト
  -> requestId 付与
  -> 認証（session or API key）
  -> RBAC チェック
  -> Idempotency チェック（書き込み操作）
  -> ハンドラ実行
  -> 監査ログ記録
  -> レスポンス
```

## 5. パッケージ間依存関係

```
packages/config     <- 全パッケージが参照
packages/core       <- config
packages/db         <- config, core（interfaces を実装）
packages/sdk        <- config, core（types を利用）
packages/cli        <- sdk, config
packages/ui         <- config
packages/llm        <- config, core
packages/skills     <- config, core, llm
packages/provider-x         <- config, core
packages/provider-line      <- config, core
packages/provider-instagram <- config, core
apps/api            <- core, db, sdk, llm, skills, provider-*, config
apps/web            <- ui, sdk, config
```

## 6. Provider インターフェース

```typescript
// packages/core/src/interfaces/social-provider.ts

export type Platform = "x" | "line" | "instagram";

export interface ProviderCapabilities {
  textPost: boolean;
  imagePost: boolean;
  videoPost: boolean;
  threadPost: boolean;
  directMessage: boolean;
  commentReply: boolean;
  broadcast: boolean;
  nativeSchedule: boolean;
  usageApi: boolean;
}

export interface SocialProvider {
  readonly platform: Platform;
  getCapabilities(): ProviderCapabilities;
  connectAccount(input: ConnectAccountInput): Promise<ConnectAccountResult>;
  validatePost(input: ValidatePostInput): Promise<ValidationResult>;
  publishPost(input: PublishPostInput): Promise<PublishResult>;
  deletePost(input: DeletePostInput): Promise<DeleteResult>;
  listThreads?(input: ListThreadsInput): Promise<ThreadListResult>;
  getMessages?(input: GetMessagesInput): Promise<MessageListResult>;
  sendReply?(input: SendReplyInput): Promise<SendReplyResult>;
  handleWebhook?(input: WebhookInput): Promise<WebhookResult>;
  refreshToken?(accountId: string): Promise<RefreshResult>;
}
```

## 7. RBAC 権限マトリクス

```
操作 \ ロール          | viewer | operator | editor | admin | owner | agent
-----------------------|--------|----------|--------|-------|-------|------
アカウント閲覧          | o      | o        | o      | o     | o     | o
アカウント接続/切断     | -      | -        | -      | o     | o     | -
投稿閲覧               | o      | o        | o      | o     | o     | o
投稿作成（下書き）      | -      | o        | o      | o     | o     | o
投稿公開               | -      | -        | o      | o     | o     | *
予約管理               | -      | -        | o      | o     | o     | *
使用量閲覧             | o      | o        | o      | o     | o     | o
予算ポリシー管理        | -      | -        | -      | o     | o     | -
LLM ルーティング管理    | -      | -        | -      | o     | o     | -
skills 管理            | -      | -        | -      | o     | o     | -
ユーザー管理           | -      | -        | -      | o     | o     | -
ワークスペース設定      | -      | -        | -      | -     | o     | -
監査ログ閲覧           | -      | -        | -      | o     | o     | -
チャット利用           | -      | o        | o      | o     | o     | -
承認操作               | -      | -        | -      | o     | o     | -

* agent ロールは skill の permission scope に従う（approval-required がデフォルト）
```

## 8. 暗号化・シークレット管理

- OAuth トークン、LLM API キーは `aes-256-gcm` で暗号化して DB に保管
- 暗号化キーは環境変数 `ENCRYPTION_KEY` から取得
- `packages/core/src/domain/crypto.ts` に encrypt/decrypt ユーティリティを配置
- 復号は provider 呼び出し直前のみに行い、メモリ上の滞留を最小化

## 9. エラーハンドリング方針

### 9.1 ドメインエラー

```typescript
// packages/core/src/errors/
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

// 派生: ValidationError, AuthorizationError, NotFoundError,
//       BudgetExceededError, ProviderError, RateLimitError
```

### 9.2 エラーコード体系

```
AUTH_xxx     - 認証・認可エラー
VALID_xxx    - バリデーションエラー
PROVIDER_xxx - SNS プロバイダエラー
BUDGET_xxx   - 予算エラー
LLM_xxx      - LLM エラー
SKILL_xxx    - skill 実行エラー
SYSTEM_xxx   - システムエラー
```

## 10. Web UI コンポーネント設計

### 10.1 レイアウト

- `AppShell`: Sidebar + Header + Main content
- Sidebar: ナビゲーション（Phosphor Icons 使用）、レスポンシブで drawer に変化
- Header: ワークスペース名、通知、ユーザーメニュー

### 10.2 主要画面

| 画面           | パス              | 概要                                                |
| -------------- | ----------------- | --------------------------------------------------- |
| ダッシュボード | `/`               | 投稿数、予約数、使用量サマリ、最近のアクティビティ  |
| 投稿一覧       | `/posts`          | 全SNS横断の投稿リスト、フィルタ、検索               |
| 投稿作成       | `/posts/new`      | SNS選択、コンテンツ入力、バリデーション、プレビュー |
| 予約カレンダー | `/calendar`       | 月/週/日ビュー、ドラッグ&ドロップ                   |
| 受信トレイ     | `/inbox`          | スレッド一覧 + メッセージ詳細                       |
| 使用量         | `/usage`          | グラフ表示、日次/週次/月次切り替え                  |
| Skills管理     | `/skills`         | パッケージ一覧、生成、有効化/無効化                 |
| チャット       | `/agents`         | AIチャットUI、実行プレビュー、履歴                  |
| 設定           | `/settings`       | アカウント接続、LLMルーティング、予算、ユーザー管理 |
| 監査ログ       | `/settings/audit` | ログ一覧、フィルタ                                  |

### 10.3 DaisyUI テーマ

```javascript
// tailwind.config.ts に定義
daisyui: {
  themes: [
    {
      "sns-agent": {
        primary: "#06C755",
        secondary: "#111111",
        accent: "#FF7A59",
        neutral: "#1F2937",
        "base-100": "#FFFDF8",
        "base-content": "#1F2937",
        info: "#2F80ED",
        warning: "#F4B740",
        error: "#E5484D",
      },
    },
  ];
}
```

## 11. 投稿バリデーション

### 11.1 プラットフォーム別制約

| プラットフォーム | テキスト上限                           | 画像                       | 動画               |
| ---------------- | -------------------------------------- | -------------------------- | ------------------ |
| X                | 280文字 (Basic) / 25,000文字 (Premium) | 最大4枚、5MB               | 1本、512MB         |
| LINE             | 5,000文字                              | リッチメッセージ対応       | 動画メッセージ対応 |
| Instagram        | 2,200文字                              | 必須（フィード）、最大10枚 | リール対応         |

### 11.2 バリデーション実行タイミング

1. クライアントサイド: 即時フィードバック（文字数カウント等）
2. API 受信時: `core/usecases/validatePost` で provider の `validatePost` を呼び出し
3. 公開直前: 最終バリデーション（トークン有効性含む）
