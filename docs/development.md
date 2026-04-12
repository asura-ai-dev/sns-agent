# 開発手順

`sns-agent` は monorepo 構成です。ローカル開発では主に以下を扱います。

- `apps/web`: Next.js フロントエンド (`http://localhost:3000`)
- `apps/api`: Hono API サーバー (`http://localhost:3001`)
- `packages/db`: Drizzle ORM + SQLite
- `packages/cli`: `sns` CLI
- `scripts/setup.sh`: 初期セットアップ用スクリプト

`apps/web` は Next.js の rewrite で `/api/*` を `http://localhost:3001/api/*` にプロキシします。

## 1. 前提条件

- Node.js 20 以上
- `pnpm` 10 以上

バージョン確認:

```bash
node -v
pnpm -v
```

依存関係が未インストールの場合は、リポジトリルートで以下を実行します。

```bash
pnpm install
```

## 2. セットアップ

初回セットアップはリポジトリルートで以下を実行します。

```bash
bash scripts/setup.sh
```

このスクリプトは次を自動で行います。

- `.env.example` をもとに `.env` を生成
- `ENCRYPTION_KEY` が空の場合はランダム値を自動投入
- `pnpm --filter @sns-agent/db db:push` で DB スキーマを反映
- `pnpm --filter @sns-agent/db db:seed` で初期データを投入

補足:

- すでに `.env` が存在する場合、`scripts/setup.sh` は上書きしません
- ローカル開発の既定 DB は SQLite で、`.env.example` の `DATABASE_URL=file:./dev.db` を使います

## 3. 起動

リポジトリルートで以下を実行します。

```bash
pnpm dev
```

通常は Turbo 経由で各アプリの開発サーバーが起動します。

- Web UI: `http://localhost:3000`
- API: `http://localhost:3001`

フロントエンドから `/api/*` にアクセスした場合は、Next.js の rewrite により API サーバーへ転送されます。

## 4. 動作確認

ブラウザでは最低限、以下の画面が開けることを確認してください。

- `/`
- `/posts`
- `/calendar`
- `/inbox`
- `/settings/accounts`
- `/settings/llm`
- `/skills`
- `/usage`

API のヘルスチェックは以下で確認できます。

```bash
curl http://localhost:3001/api/health
```

レスポンス例:

```json
{"status":"ok"}
```

Web 側の rewrite 経由でも確認できます。

```bash
curl http://localhost:3000/api/health
```

## 5. CLI の使い方

CLI は `packages/cli` にあり、`sns` コマンドとして提供されます。利用前に一度ビルドしておくと確実です。

```bash
pnpm --filter @sns-agent/cli build
pnpm --filter @sns-agent/cli exec sns --help
```

CLI は以下の優先順で接続設定を読みます。

- `--api-url`, `--api-key`
- 環境変数 `SNS_API_URL`, `SNS_API_KEY`
- `~/.sns-agent/config.json`

既定の API URL は `http://localhost:3001` です。API キー未設定では CLI は実行できません。

### `accounts`

接続済み SNS アカウントを管理します。

- 主な用途: 一覧表示、詳細表示、OAuth 接続開始、切断
- 主なサブコマンド: `list`, `show`, `connect`, `disconnect`

例:

```bash
pnpm --filter @sns-agent/cli exec sns accounts list
pnpm --filter @sns-agent/cli exec sns accounts connect x --api-key <YOUR_API_KEY>
```

### `post`

投稿の作成、一覧取得、即時公開、削除を行います。

- 主な用途: 下書き作成、公開済み投稿の確認、手動公開
- 主なサブコマンド: `list`, `create`, `show`, `delete`, `publish`

例:

```bash
pnpm --filter @sns-agent/cli exec sns post list --api-key <YOUR_API_KEY>
pnpm --filter @sns-agent/cli exec sns post create --platform x --account <ACCOUNT_ID> --text "hello" --api-key <YOUR_API_KEY>
```

### `schedule`

予約投稿ジョブを管理します。

- 主な用途: 予約作成、一覧確認、時刻更新、キャンセル
- 主なサブコマンド: `list`, `create`, `show`, `update`, `cancel`

例:

```bash
pnpm --filter @sns-agent/cli exec sns schedule list --api-key <YOUR_API_KEY>
pnpm --filter @sns-agent/cli exec sns schedule create --post <POST_ID> --at 2026-04-20T09:00:00+09:00 --api-key <YOUR_API_KEY>
```

### `inbox`

受信スレッドとメッセージを参照します。

- 主な用途: スレッド一覧確認、特定スレッドのメッセージ確認
- 主なサブコマンド: `list`, `show`

例:

```bash
pnpm --filter @sns-agent/cli exec sns inbox list --api-key <YOUR_API_KEY>
pnpm --filter @sns-agent/cli exec sns inbox show <THREAD_ID> --api-key <YOUR_API_KEY>
```

### `usage`

API 利用量と概算コストを確認します。

- 主な用途: 期間別レポート、全体サマリー確認
- 主なサブコマンド: `report`, `summary`

例:

```bash
pnpm --filter @sns-agent/cli exec sns usage report --range monthly --api-key <YOUR_API_KEY>
pnpm --filter @sns-agent/cli exec sns usage summary --api-key <YOUR_API_KEY>
```

### `llm`

LLM ルーティング設定を管理します。

- 主な用途: ルート一覧、ルート追加・更新、ルート削除
- 主なサブコマンド: `route list`, `route set`, `route delete`

例:

```bash
pnpm --filter @sns-agent/cli exec sns llm route list --api-key <YOUR_API_KEY>
pnpm --filter @sns-agent/cli exec sns llm route set --platform x --provider openai --model gpt-5.4 --api-key <YOUR_API_KEY>
```

### `skills`

skills パッケージを管理します。

- 主な用途: 一覧表示、パッケージ生成、有効化、無効化、詳細確認
- 主なサブコマンド: `list`, `pack`, `enable`, `disable`, `show`

例:

```bash
pnpm --filter @sns-agent/cli exec sns skills list --api-key <YOUR_API_KEY>
pnpm --filter @sns-agent/cli exec sns skills pack --platform x --provider codex --api-key <YOUR_API_KEY>
```

## 6. OAuth プロバイダの設定（任意）

OAuth を使う場合は `.env` に必要な値を設定してから再起動してください。未設定でも Web と API の基本起動は可能です。

### X

- `X_CLIENT_ID`
- `X_CLIENT_SECRET`（必要な場合）
- `X_PREMIUM`（任意）

### Instagram

- `INSTAGRAM_CLIENT_ID`
- `INSTAGRAM_CLIENT_SECRET`
- `INSTAGRAM_WEBHOOK_SECRET`（任意。未指定時は `INSTAGRAM_CLIENT_SECRET` を利用）
- `INSTAGRAM_WEBHOOK_VERIFY_TOKEN`（必要に応じて設定）

### LINE

- `LINE_CHANNEL_ID`
- `LINE_ASSERTION_KID`
- `LINE_ASSERTION_PRIVATE_KEY`
- `LINE_CHANNEL_SECRET`（任意）
- `LINE_TOKEN_TTL_SECONDS`（任意）

補足:

- OAuth コールバック関連では `WEB_URL` を `http://localhost:3000` に合わせておくと扱いやすいです
- プロバイダ設定を変更したら `pnpm dev` を再起動してください

## 7. トラブルシュート

### DB をリセットしたい

ローカル DB を作り直したい場合は、開発サーバー停止後に SQLite ファイルを削除してから再セットアップします。

```bash
rm -f dev.db dev.db-shm dev.db-wal
bash scripts/setup.sh
```

### ポート 3000 / 3001 が競合する

既存プロセスを確認して停止してください。

```bash
lsof -i :3000
lsof -i :3001
```

API 側は `.env` の `API_PORT` で変更できます。API ポートを変えた場合は、Web 側の `/api/*` プロキシ先も合わせて見直してください。

### OAuth プロバイダ未設定時の挙動

必要な環境変数が不足しているプロバイダは API 起動時に登録されません。その場合:

- 起動自体は継続します
- 該当プロバイダについて警告ログが出ます
- OAuth 接続、トークン発行、投稿などの処理は失敗します

まずは `.env` の該当項目を設定し、開発サーバーを再起動してください。
