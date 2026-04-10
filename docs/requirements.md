# SNS Agent 要件定義書

## 1. 背景

本プロダクトは、以下のオープンソース実装から着想を得た「各種SNSハーネスの統合基盤」である。

- X Harness OSS: https://github.com/Shudesu/x-harness-oss
- LINE Harness OSS: https://github.com/Shudesu/line-harness-oss
- Instagram Harness OSS: https://github.com/Shudesu/instagram-harness-oss

上記リポジトリから読み取れる強みは次の通り。

- SNSごとの業務機能が深い
- セルフホスト前提で低コスト運用できる
- SDK/MCP経由でAIエージェントから操作できる
- 管理画面で人間が手動運用しやすい

本プロダクトではこれを一段抽象化し、複数SNSを横断して扱える基盤として再設計する。

## 2. プロダクトビジョン

`sns-agent` は、X / LINE / Instagram などのSNS運用を以下の3経路から同一基盤で操作できるプラットフォームを提供する。

- 人間向け Web UI
- AIエージェント向け CLI
- LLM / エージェント統合向け SDK・skills パッケージ

各SNSの投稿、予約、配信、会話、分析、API料金可視化、利用上限管理を統合し、さらに Web UI のチャットインターフェースから Claude Code / Codex 等を呼び出して運用操作を支援できる状態を目指す。

## 3. 目標

### 3.1 主要目標

- SNSごとの運用機能を統一された概念で扱える
- CLI で全主要操作が実行でき、AIエージェントが扱いやすい
- Web UI で非エンジニアでも投稿・予約・監視・承認がしやすい
- LLMごとに適切な skills パッケージを配布できる
- API使用量、推定課金、利用上限を可視化できる
- 各SNS固有機能も拡張ポイントを通じて保持できる

### 3.2 非目標

- v1 で全SNSの全機能を完全統一すること
- 非公式APIや規約違反前提の自動化を標準機能にすること
- AIに無制限な書き込み権限を与えること

## 4. 想定ユーザー

### 4.1 運用担当者

- 投稿作成、予約、承認、配信結果確認を Web UI から行う

### 4.2 AIエージェント運用者

- Codex / Claude Code / 将来のCLIエージェントからコマンド実行する

### 4.3 開発者・導入担当

- SNSコネクタ、skills、LLMアダプタを追加する

## 5. 提供価値

- 1つの基盤で複数SNS運用の操作面を統一できる
- 人間操作とAI操作を同じ権限・監査モデルで扱える
- SNSごとに異なるLLM・skills配布戦略を選べる
- SaaS依存を下げつつ、拡張可能な自社運用基盤を持てる

## 6. スコープ

### 6.1 v1 スコープ

- X / LINE / Instagram の3SNS対応
- 投稿作成、下書き、予約、一覧、削除
- SNSごとの会話・問い合わせ系データの参照
- API使用量・推定料金・上限設定の可視化
- CLI経由の主要操作
- Web UI 経由の主要操作
- Web UI のチャット経由で LLM を呼び出し、許可された操作を実行
- skills パッケージの配布・選択
- LLMプロバイダごとのルーティング設定
- RBAC、監査ログ、承認フロー

### 6.2 v1.5 以降

- TikTok / YouTube / Threads 追加
- 複数ワークスペース
- 請求連携
- 高度な分析・スコアリング
- クロスSNSキャンペーンテンプレート

## 7. 機能要件

### 7.1 SNSアカウント管理

- 複数SNSアカウントを1つのワークスペースで管理できること
- SNSごとに認証情報、表示名、状態、権限を保持できること
- 接続状態、トークン有効期限、権限不足を検知できること

### 7.2 投稿・予約管理

- テキスト、画像、動画を含む投稿を作成できること
- SNSごとの投稿制約を事前検証できること
- 下書き保存、予約投稿、即時投稿、取消ができること
- 予約ジョブの成功・失敗・再試行状態を追跡できること
- 将来的なスレッド投稿、カルーセル、複数メッセージ連投に対応できる拡張性を持つこと

### 7.3 受信・会話管理

- X のリプライ/DM、LINE のチャット、Instagram のDM/コメントなどを参照できること
- 人間向け UI と CLI で一覧・詳細確認ができること
- AIが返信案を生成できるが、書き込みは権限と承認設定に従うこと

### 7.4 API使用量・料金・上限制御

- SNS API ごとの使用回数、失敗率、推定料金を可視化できること
- 日次・週次・月次で集計できること
- ワークスペース単位、SNS単位、エンドポイント単位の上限を設定できること
- 上限超過前に警告を出せること
- 上限超過時は自動停止、承認待ち、警告のみを選べること

### 7.5 CLI

- AIエージェントが扱いやすい単純で安定したCLIを提供すること
- 標準出力は人間可読とJSON出力の両方に対応すること
- 主要コマンドは非対話で完結できること
- 終了コード、エラー形式、JSONスキーマを安定化すること

想定コマンド例:

```bash
sns accounts list --json
sns post create --platform x --account main --file draft.md
sns post schedule --platform instagram --at "2026-04-12T09:00:00+09:00"
sns inbox list --platform line --limit 20 --json
sns usage report --platform x --range month
sns llm route set --platform instagram --provider codex --model gpt-5.4
sns skills pack --platform line --provider claude-code
```

### 7.6 Web UI

- DaisyUI をベースにした管理画面を提供すること
- 人間が短時間で操作できる情報設計にすること
- 投稿、予約、会話、コスト、設定、チャットを主要画面とすること
- デスクトップとモバイルの双方で利用可能であること
- UIコンポーネントは将来的なSNS追加に耐える一貫した設計を持つこと

#### ナビゲーション要件

- アイコンライブラリは `@phosphor-icons/react` を採用すること
- 例として `ChatCircle`, `GearSix`, `Timer` などをナビゲーションで利用できること

#### デザイン要件

- DaisyUI テーマを拡張して独自ブランドテーマを定義すること
- 色は LINE のグリーン、X のミニマルさ、Instagram の華やかさを統合した配色とすること
- 初期トークン候補を以下とすること

```txt
primary: #06C755
secondary: #111111
accent: #FF7A59
accent-2: #F77737
surface: #FFFDF8
base-content: #1F2937
info: #2F80ED
warning: #F4B740
error: #E5484D
```

### 7.7 Web UI内チャットインターフェース

- Web UI からチャット形式で AI オペレータを呼び出せること
- Claude Code / Codex / 将来の他LLM を切り替えられること
- チャットから実行可能な操作は skills と権限で制御されること
- 実行前プレビュー、承認、実行ログ、ロールバック不能注意を表示できること
- AIが参照したアカウント、SNS、コマンド、結果を会話に紐づけて監査できること

### 7.8 LLMルーティング

- どのSNSにどのLLMを割り当てるか設定できること
- SNS単位、アクション単位、ワークスペース単位でルーティングできること
- モデル、温度、トークン制限、使用上限を設定できること
- 失敗時のフォールバックモデルを設定できること

例:

- X 投稿作成補助: Codex
- LINE シナリオ文面生成: Claude Code
- Instagram コメント返信案: 軽量モデル

### 7.9 skills パッケージ機構

- SNS操作を skills パッケージとして配布可能にすること
- LLMごとに適した形式で配布・有効化できること
- skills にはコマンド定義、権限スコープ、引数仕様、例、失敗時挙動を含めること
- `platform x + provider codex` のような組み合わせをパッケージ単位で管理できること
- skills のバージョニング、署名、互換性表示を行えること

想定パッケージ例:

- `@sns-agent/skill-x-codex`
- `@sns-agent/skill-line-claude-code`
- `@sns-agent/skill-instagram-codex`

### 7.10 権限・承認・監査

- viewer / operator / editor / admin / owner などのロールを持てること
- AIエージェントにも明示的な権限主体を割り当てること
- 書き込み操作には承認必須ルールを設定できること
- 全操作について actor、対象SNS、対象アカウント、入力、結果、コストを記録すること

## 8. 非機能要件

### 8.1 拡張性

- 新しいSNSを `provider` 単位で追加できること
- 共通機能とSNS固有機能を分離したアーキテクチャにすること

### 8.2 可用性

- 予約投稿やWebhook処理が一時失敗しても再試行できること
- 外部API障害時の縮退動作を設計すること

### 8.3 セキュリティ

- APIキー、OAuthトークン、LLMキーを安全に保管すること
- 監査ログは改ざん耐性を考慮すること
- AI実行時に危険コマンド、対象誤り、大量送信を防ぐガードを持つこと

### 8.4 観測性

- アプリログ、監査ログ、ジョブログ、API使用量ログを分離すること
- 主要失敗イベントに対して通知できること

### 8.5 準拠性

- 各SNSの公式API、利用規約、レート制限を前提に設計すること
- 危険な自動化は opt-in とし、運用責任範囲を明確化すること

## 9. 推奨アーキテクチャ

参照元3リポジトリの共通点を踏まえ、初期構成はモノレポを推奨する。

```txt
apps/
  web/          # Next.js + DaisyUI 管理画面
  api/          # API / Webhook / Scheduler
packages/
  core/         # 共通ドメイン
  cli/          # CLI
  sdk/          # TypeScript SDK
  ui/           # 共通UI
  skills/       # skills パッケージ仕様とビルド
  llm/          # LLMアダプタ
  provider-x/
  provider-line/
  provider-instagram/
docs/
```

### 技術方針

- Web UI: Next.js + DaisyUI + Tailwind CSS
- API: TypeScript ベースの軽量構成
- SDK: TypeScript
- CLI: Node.js ベース
- DB: 運用規模に応じて SQLite 系またはPostgreSQL系を選択
- Queue / Scheduler: 予約投稿と再試行に耐える構成

Cloudflare Workers 中心の構成は参照元と整合的で有力だが、本プロダクトは CLI / Web UI / skills 配布の統合が主題のため、実行基盤は将来差し替え可能な抽象化を維持する。

## 10. ドメインモデル

主要エンティティ:

- Workspace
- User
- AgentIdentity
- SocialAccount
- Post
- ScheduledJob
- Conversation
- Message
- UsageRecord
- BudgetPolicy
- LlmRoute
- SkillPackage
- AuditLog

## 11. 画面要件

最低限必要な画面:

- ダッシュボード
- 投稿一覧
- 投稿作成
- 予約カレンダー
- 会話/受信トレイ
- API使用量/予算
- skills 管理
- LLMルーティング設定
- エージェントチャット
- ワークスペース設定

## 12. CLI/SDK API方針

- CLI は SDK を内部利用し、重複ロジックを避けること
- Web UI の server actions / API routes も同じ SDK または service 層を利用すること
- 出力仕様は docs で機械可読に定義すること

## 13. リスク

- SNSごとに API制約と審査要件が大きく異なる
- AIによる自動投稿は誤送信・ブランド毀損リスクがある
- 料金可視化は「実請求額」ではなく「推定額」になる場合がある
- skills 配布はLLMごとの互換性差分を吸収する必要がある

## 14. 未解決事項

- 実行基盤を Cloudflare 中心にするか、より汎用なNodeサーバー構成にするか
- 予約ジョブをどの基盤で安定実行するか
- skills 配布フォーマットを独自化するか、既存エージェント仕様に寄せるか
- Web UI から Claude Code / Codex を呼ぶ際の認証と課金責任をどう分離するか
- SNS横断の共通投稿モデルをどこまで抽象化するか

## 15. 受け入れ条件

- X / LINE / Instagram の3つでアカウント接続ができる
- 各SNSで少なくとも1種類の投稿または送信を作成・予約できる
- CLI から一覧・作成・予約・使用量取得が実行できる
- Web UI から投稿、予約、使用量、チャット操作ができる
- LLMルーティング設定を保存できる
- skills パッケージを1つ以上生成・有効化できる
- 監査ログで AI 実行履歴を追跡できる

## 16. 実装優先順位

### P0

- モノレポ骨格
- 認証/権限
- SocialAccount
- Post / ScheduledJob
- CLI
- Web UI 基本画面
- UsageRecord / BudgetPolicy
- LLMルーティング

### P1

- Web UI 内チャット
- skills パッケージ生成
- Inbox / Conversation
- 監査ログ詳細

### P2

- クロスSNSキャンペーン
- 高度分析
- 追加SNS対応

