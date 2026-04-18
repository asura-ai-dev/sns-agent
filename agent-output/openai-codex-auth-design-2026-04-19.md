# OpenAI Codex / ChatGPT サブスク認証 追加設計メモ

## What

`OPENAI_API_KEY` 前提の既存 `openai` provider とは別に、`openai-codex` provider を新設し、
ChatGPT / Codex 系の OAuth 認証情報で LLM を呼び出せるようにする。

このメモは「今の実装に最小限どう足すか」の設計たたき台であり、まだ実装はしていない。

## Why

現状の SNS Agent は OpenAI を API キーでしか呼べない。

- [apps/api/src/routes/agent.ts](/Users/kazuto/Desktop/project-D/sns-agent/apps/api/src/routes/agent.ts:871)
  は `process.env.OPENAI_API_KEY` から adapter を構築している
- [packages/llm/src/router.ts](/Users/kazuto/Desktop/project-D/sns-agent/packages/llm/src/router.ts:283)
  も `openai` / `anthropic` の API キー前提

そのため、`ChatGPTのサブスクでログインして使う` という経路は今のままでは表現できない。

一方で、OpenAI 公式の Codex CLI では ChatGPT アカウント認証が案内されており、OpenClaw も
`openai-codex` という別 provider として扱っている。ここから、
「通常 API とは別の Codex 系認証経路がある」と考えるのが自然。

補足:
- `ChatGPT` と `API Platform` は別課金・別管理
- したがって `openai` provider に無理やり混ぜず、`openai-codex` を別 provider として
  追加するほうが設計上きれい

## アーキテクチャ

現状:

```txt
Web UI
  -> LLM Route (provider=openai)
  -> Agent Gateway
  -> packages/llm OpenAiAdapter
  -> OPENAI_API_KEY
  -> OpenAI API
```

追加後:

```txt
Web UI
  -> LLM Route (provider=openai-codex)
  -> API OAuth routes
  -> DB に OAuth credentials 保存
  -> Agent Gateway
  -> packages/llm OpenAiCodexAdapter
  -> ChatGPT / Codex 認証経路
```

## 実装方針

### 1. provider を分ける

`openai` は今まで通り API キー用に残す。  
新しく `openai-codex` を追加する。

理由:
- 既存運用を壊さない
- ルーティング画面で選び分けできる
- トラブル時に API キー経路へ戻しやすい

### 2. OAuth credentials を DB 保存する

新規テーブル案: `llm_provider_credentials`

想定カラム:
- `id`
- `workspace_id`
- `provider`
- `status`
- `access_token_encrypted`
- `refresh_token_encrypted`
- `expires_at`
- `scopes`
- `subject`
- `metadata`
- `created_at`
- `updated_at`

ポイント:
- 平文保存は避ける
- 既存 `ENCRYPTION_KEY` の流儀に合わせて暗号化
- workspace 単位で 1 provider 1接続を基本にする

### 3. OAuth 用 API を追加する

想定エンドポイント:
- `POST /api/llm/providers/openai-codex/connect`
- `GET /api/llm/providers/openai-codex/callback`
- `POST /api/llm/providers/openai-codex/refresh`
- `DELETE /api/llm/providers/openai-codex/disconnect`
- `GET /api/llm/providers/openai-codex/status`

役割:
- connect: 認証開始 URL を返す
- callback: code を受けて token 交換し DB 保存
- refresh: 明示再認証または token refresh
- disconnect: 接続解除
- status: UI 表示用

### 4. adapter を増やす

新規ファイル案:
- `packages/llm/src/adapters/openai-codex.ts`

要件:
- `LlmAdapter` を満たす
- 保存済み OAuth token を使って chat 実行する
- 有効期限切れなら refresh を試す
- 失敗時は `LlmError` へ正規化する

### 5. Agent Gateway の adapter 解決を拡張する

今は `buildDefaultAdapters()` が env ベースの固定構築になっている。  
ここを次の 2 段階に分ける。

1. `openai` / `anthropic` は env から生成
2. `openai-codex` は workspace ごとの DB credentials から生成

つまり、

```txt
route.provider
  -> adapter factory
  -> env key または DB credentials を解決
  -> 実行
```

の形にする。

### 6. Web UI を追加する

対象:
- `/settings/llm`
- 必要なら `/settings/llm/providers`

追加項目:
- provider 一覧に `openai-codex`
- 接続状態表示
  - 未接続
  - 接続済み
  - 期限切れ
  - 再認証必要
- 接続 / 再接続 / 切断ボタン

非エンジニア向け文言例:
- `OpenAI APIキー`: 開発者向けの接続方法。従量課金です
- `ChatGPT / Codex ログイン`: ChatGPT 側の認証で接続する方法です

## 既存コードへの主な変更点

### API

- `apps/api/src/routes/agent.ts`
  - env 固定の adapter 解決を provider 別の resolver に変更
- `apps/api/src/routes/llm.ts`
  - provider 値の許容範囲に `openai-codex` を追加
- 新規 `apps/api/src/routes/llm-providers.ts`
  - OAuth 接続 API

### Core / DB

- 認証情報 repository 追加
- credentials 保存 / 更新 / 取得 usecase 追加

### LLM package

- `packages/llm/src/router.ts`
  - adapter factory を拡張
- 新規 `packages/llm/src/adapters/openai-codex.ts`

### Web

- `apps/web/src/components/settings/llm/LlmRouteManager.tsx`
  - provider 選択肢追加
- 新規 `apps/web/src/components/settings/llm/LlmProviderConnections.tsx`
  - 接続状態 UI

## 非目標

今回の設計では次はやらない。

- `openai` provider をサブスク認証に置き換える
- ChatGPT の web session / cookie を直接使う非公式実装
- OpenAI 以外の subscription auth を同時に入れる
- 既存 API キー方式の撤廃

## リスク

1. 公式仕様の変動
   - Codex 系 OAuth の公開仕様や利用条件が変わる可能性がある
2. token refresh の不確実性
   - 期限切れ処理の失敗時 UX を丁寧に作る必要がある
3. 認証失敗と API 障害の見分け
   - 今回の `wire offline` のように、見た目だけでは原因が分かりにくくなりやすい
4. モデル差
   - `openai-codex` で使えるモデルと `openai` API で使えるモデルが完全一致しない可能性

## Done When

- `provider=openai-codex` の LLM ルートを保存できる
- Web UI から ChatGPT / Codex 接続を開始できる
- callback 後に接続状態が `connected` になる
- Agent Gateway が `openai-codex` route を解決して応答できる
- token 期限切れ時に refresh または再認証導線が出る
- 既存 `openai` API キー経路は壊れない

## 実装順序のおすすめ

1. DB schema / repository
2. OAuth routes
3. `openai-codex` adapter
4. Agent Gateway 統合
5. Web UI 接続画面
6. `/settings/llm` への provider 追加
7. 結合テスト

## 補足

この案は、OpenAI 公式の「ChatGPT と API は別管理」という前提を守りつつ、
Codex 系認証を別 provider として切り出すための最小設計である。

つまり、

- `openai` = 従来の API キー方式
- `openai-codex` = ChatGPT / Codex 認証方式

と明確に分けるのが中心思想になる。
