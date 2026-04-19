# SNS Agent X拡張ロードマップ

## 1. このドキュメントの目的

このドキュメントは、現在 `sns-agent` で確認済みの

- X 認証
- X 通常投稿

を出発点として、`x-harness-oss` 相当の X 運用基盤に近づけるための実装順序を整理したものである。

非エンジニア向けに一言で言うと、

- まず「予約した投稿が確実に出る仕組み」を完成させる
- 次に「X運用で日常的に必要な機能」を増やす
- その上で「Web UI / CLI から AI に自然言語で操作させる」
- 最後に「複数 LLM プロバイダを無理なく増やせる形」にする

という順番で進める。

### 1.1 現在の進捗サマリ

このドキュメントでは意味を以下で固定する。

- `[x]` = コード実装済み
- `[ ]` = まだ未実装
- `確認待ち` = コードはあるが、実アカウントや実データでの確認がまだ

実装済み:

- [x] Phase 1: X予約投稿の本番運用化
- [x] Phase 2: X運用機能の業務レベル強化
- [x] Phase 3: Web UI / CLI から AI に X操作をさせる基盤
- [x] Phase 4: 全 SNS 対応 + 使用量 / 予算の運用基盤化

確認待ち:

- Phase 4: 実アカウント・実トークンでの統合確認

未着手 / 未完了:

- [ ] Phase 5: AI 連携の残タスク整理と着手
- [ ] Phase 6: 全体統合テスト / E2E の完了

Phase 5 進捗:

- [x] Web UI チャットで、会話一覧だけでなく過去会話の本文も再表示できるようにした
- [x] Web UI で LLM ルーティング設定と Skills 管理を行い、どの AI をどの用途に使うか・AI に何を許可するかを画面で確認できるようにした
- [x] Task 5007 Phase A として、OpenAI Codex / ChatGPT ログイン方式の credentials 保存基盤、status / disconnect API、設定画面の接続状態表示を追加した

次にやること:

1. Phase 4 の実環境確認を行う
2. Phase 5 の `LLM アダプタ / ルーティング / Agent Gateway / Skills / Chat UI` を優先順で進める
3. 最後に Phase 6 の全体 E2E で、投稿・返信・AI 操作・使用量・承認の一連動作を閉じる

## 2. 先に決める方針

### 2.1 予約投稿は cron で進める

`What`
予約投稿の実行は `1 投稿 = 1 cron` ではなく、`1 本の cron が期限到来ジョブを拾う dispatcher 方式` にする。

```txt
cron (毎分)
  -> scheduler dispatcher
  -> due jobs を取得
  -> lock
  -> X投稿実行
  -> success / retry / failed 更新
```

`Why`

- 実装が単純で壊れにくい
- 予約数が増えても管理しやすい
- DB の `scheduled_jobs` を中心に監査・再試行・重複防止を統一できる
- 今の `polling worker` 実装を活かしつつ、本番運用に寄せられる

`How`

- cron は毎分実行を基本とする
- `scheduled_at <= now` のジョブを取得する
- `locked` で二重実行を防ぐ
- 失敗時は `retrying` と `next_retry_at` を更新する
- 将来 Cloud Scheduler / GitHub Actions / system cron のどれにも載せ替えられる形にする

### 2.2 LLM プロバイダ拡張は「設計を先、全面展開は後」

`What`
Grok / Gemini / Claude / Ollama / Kimi などの追加は必要だが、今すぐ全実装はしない。

`Why`

- 先に X の運用フローを完成させないと、AI だけ豪華でも実務で使いにくい
- LLM を増やすほど設定 UI、障害対応、費用管理が複雑になる
- まずは `X + チャット操作 + 主力プロバイダ 1〜2個` を完成させる方が価値が高い

`How`

- 今やる: 共通アダプタ設計、ルーティング設計、設定保存、UI の入口
- 後でやる: 各プロバイダ個別実装と運用チューニング

推奨順:

1. OpenAI 互換 / Codex 系
2. Anthropic
3. Gemini
4. Grok
5. Ollama
6. Kimi

### 2.3 OpenClaw の参考点

`openclaw` は OpenAI（ChatGPT / Codex）を OAuth でも API キーでも扱えるようにし、複数の認証プロファイルを持たせた上で、セッション単位の固定とフェイルオーバーを行っている。

この考え方は `sns-agent` にも有効である。

参考にする点:

- provider ごとに認証プロファイルを分ける
- OAuth と API キーを同じ provider 抽象の中で扱う
- 同一 provider の中でも複数プロファイルを持てる
- セッション単位で使うプロファイルを固定し、失敗時のみ切り替える

このため `sns-agent` でも、今すぐ全プロバイダ実装を広げるより、先に

- `provider`
- `auth profile`
- `route`
- `fallback`

の責務を分離し、あとから Grok / Gemini / Ollama / Kimi を足しても設計が崩れない形を作る方がよい。

最終的には

```txt
LLM Provider
  -> provider 名
  -> auth profile (oauth / api key)
  -> model
  -> fallback
```

の形に寄せるのがよい。

## 3. 現状と目標の差分表

X を `x-harness-oss` に近づける観点で、現状との差分を整理する。

| 領域                      | 現状                    | 目標                           | 優先度   |
| ------------------------- | ----------------------- | ------------------------------ | -------- |
| X 認証                    | 動作確認済み            | 安定運用                       | 低       |
| X 通常投稿                | 動作確認済み            | 安定運用                       | 低       |
| 予約投稿 API              | 土台あり                | 本番運用可                     | 最優先   |
| cron 実行                 | 未完成                  | cron dispatcher で安定運用     | 最優先   |
| 予約一覧 / 実行状態       | 土台あり                | UI / CLI で即確認可            | 高       |
| 再試行 / 重複防止         | 土台あり                | 本番で安心して使える           | 高       |
| スレッド投稿              | 未対応に近い            | X固有機能として対応            | 中       |
| 引用投稿                  | 未対応に近い            | X固有機能として対応            | 中       |
| メンション / リプライ取得 | inbox 土台あり          | X運用で使える深さまで強化      | 高       |
| リプライ送信              | 未整備                  | Web UI / CLI / AI から返信可   | 高       |
| DM 一覧 / 送信            | 未整備                  | X運用の問い合わせ導線を支える  | 中       |
| API 使用量可視化          | あり                    | X運用向けに粒度強化            | 中       |
| Web UI チャット操作       | 土台あり                | 「投稿して」「予約して」が通る | 最優先級 |
| CLI 自然言語操作          | 未着手                  | X専用オペレータとして動く      | 中       |
| LLM プロバイダ            | OpenAI / Anthropic 前提 | 段階的に拡張                   | 中       |
| キャンペーン / ゲート     | 未着手                  | 将来課題                       | 低       |

## 4. 目標アーキテクチャ

```txt
運用担当
  -> Web UI

AI利用者
  -> CLI / Chat UI

Web UI / CLI
  -> API
  -> Agent Gateway
  -> Core Use Cases
  -> X Provider
  -> Database

cron
  -> Scheduler Dispatcher
  -> Scheduled Jobs
```

完成時のイメージ:

- 人は Web UI で投稿、予約、返信、確認ができる
- AI は Web UI チャットや CLI から自然言語で操作できる
- 実行は必ず API / Core / Audit を通る
- 予約投稿は cron により自動実行される

## 5. Phase 1-4 実装ロードマップ

## Phase 1. X予約投稿の本番運用化

### 目的

X の予約投稿を「登録できる」だけではなく、「指定時刻に安全に実行される」状態にする。

### これが終わるとできること

- X の予約投稿を本番で使える
- 実行失敗時に再試行や状態確認ができる
- 運用担当が「予約したのに出なかった」を追跡できる

### 実装タスク

#### P1-1. Scheduler 実行方式の整理

- [x] 現在の polling worker を dispatcher として整理する
- [x] `manual tick` と `cron entrypoint` を分離する
- [x] cron 実行に必要な API / CLI 入口を用意する

依存:

- なし

#### P1-2. scheduled_jobs の状態遷移を本番前提に見直す

- [x] `pending / locked / running / succeeded / failed / retrying` を明確化
- [x] `lock TTL` とデッドロック回復の条件を定義する
- [x] 二重実行防止ルールを明文化する

依存:

- P1-1

#### P1-3. 再試行ポリシーの明確化

- [x] X 投稿失敗時の再試行回数と backoff を固定する
- [x] 永続失敗時の通知対象と画面表示を決める
- [x] retry 対象外エラーと対象エラーを切り分ける

依存:

- P1-2

#### P1-4. 予約一覧 / 実行結果 UI の強化

- [x] 予約一覧に `pending / retrying / failed / succeeded` を表示する
- [x] 失敗理由、次回再試行時刻、最終実行時刻を見える化する
- [x] カレンダーと一覧の両方で状態を確認できるようにする

依存:

- P1-2
- P1-3

#### P1-5. 運用確認コマンド / API の整備

- [x] due jobs 手動実行コマンドを用意する
- [x] 予約ジョブ詳細取得 API を運用観点で使いやすくする
- [x] 実行ログ確認の導線を CLI / UI に揃える

依存:

- P1-1
- P1-2

### Phase 1 完了条件

- [x] X 投稿を予約できる
- [x] cron 実行で due job が自動実行される
- [x] 同一ジョブの二重実行が防止される
- [x] 失敗時に retry または failed が UI / CLI で確認できる

### Phase 1 完了後の確認手順

1. X 下書きを作成する
2. 1〜3 分先で予約する
3. cron entrypoint または手動 dispatcher を実行する
4. 投稿が X に出ることを確認する
5. 予約一覧で `succeeded` を確認する
6. 意図的に失敗条件を作り、`retrying` または `failed` が見えることを確認する
7. 同一ジョブが重複投稿されないことを確認する

## Phase 2. X運用機能を日常業務レベルまで強化

### 目的

投稿だけでなく、X 運用で日常的に必要な「反応確認」と「返信対応」を実用レベルまで持っていく。

### これが終わるとできること

- メンションやリプライを一覧で確認できる
- 運用担当が返信対応をこの基盤の中で完結できる
- `x-harness-oss` の中核運用機能に近づく

### 実装タスク

#### P2-1. X inbox モデルの明確化

- [x] メンション、リプライ、会話スレッドの取得単位を定義する
- [x] X 固有のフィールドをどこまで共通モデルへ載せるか決める
- [x] 自アカウント起点 / 他ユーザー起点の見え方を整理する

依存:

- Phase 1 完了

#### P2-2. メンション / リプライ取得 API 強化

- [x] X provider にメンション取得、返信スレッド取得を追加する
- [x] 差分取得のためのカーソル / since_id 戦略を決める
- [x] API 使用量記録と連携する

依存:

- P2-1

#### P2-3. X返信送信

- [x] `reply_to_post` 相当の provider 操作を追加する
- [x] 承認ポリシーと RBAC を適用する
- [x] 返信結果を監査ログに残す

依存:

- P2-2

#### P2-4. Web UI の inbox 画面強化

- [x] 一覧、詳細、返信フォームを整備する
- [x] 投稿との関連、送信状態、失敗状態を見える化する
- [x] 非エンジニアでも「今どの会話に対応しているか」がわかる導線にする

依存:

- P2-2
- P2-3

#### P2-5. X固有投稿拡張

- [x] スレッド投稿
- [x] 引用投稿
- [x] 画像 / 動画添付の実運用補強

依存:

- Phase 1 完了

#### P2-6. DM 対応の方針確定

- [x] v1 で DM 一覧まで入れるか
- [x] v1.5 に送るか
- [x] X の権限要件と制約を整理する

方針:

- v1 では `DM 一覧取得 + スレッド表示 + 返信送信` まで入れる
- 画像 / 動画つき DM 返信は provider 側で扱える形にし、UI の高度な添付操作は後続で磨く
- 権限は X OAuth の `dm.read` / `dm.write` を前提にし、リアルタイム反映は webhook、取りこぼし補完は sync で担保する

依存:

- P2-1

### Phase 2 完了条件

- メンション / リプライを取得できる
- Web UI と CLI で確認できる
- 承認つきで返信できる
- X 運用担当が予約投稿と返信対応を同一基盤で回せる

### Phase 2 完了後の確認手順

1. テスト用アカウントからメンションを送る
2. inbox 一覧に反映されることを確認する
3. スレッド詳細から返信案を作成する
4. 承認後に返信が X 上で送信されることを確認する
5. 監査ログに `reply` 操作が残ることを確認する
6. API 使用量に X inbox / reply 系の記録が残ることを確認する

## Phase 3. Web UI / CLI から AI に X操作をさせる

### 目的

Web UI のチャットや CLI から、自然言語で X 投稿・予約・一覧確認ができる状態にする。

### これが終わるとできること

- 「この内容を X に投稿して」
- 「明日の朝 9 時に予約して」
- 「今週の予約一覧を見せて」
- 「CLI でどう操作するか help ページで確認してから実行して」

といった操作を AI 経由で安全に実行できる。

### 実装タスク

#### P3-1. X 専用 skills の最小セット定義

- [x] `post.create`
- [x] `post.schedule`
- [x] `post.list`
- [x] `schedule.list`
- [x] 必要なら `inbox.list`

- [x] それぞれの manifest、引数、権限、dry-run 表示を定義する

依存:

- Phase 1 完了
- Phase 2 の P2-2 以降は inbox 系に必要

#### P3-2. Agent Gateway の X 向け system prompt 最適化

- [x] X 投稿で使う操作だけを LLM に見せる
- [x] 自由回答より `構造化 intent` を優先する
- [x] 曖昧な日時やアカウント名の扱いをルール化する

依存:

- P3-1

#### P3-3. Web UI チャットからのプレビューと承認

- [x] 投稿系は必ず preview を返す
- [x] `誰のどのアカウントに何を投稿するか` を明示する
- [x] 承認後に実行し、結果を会話に紐づけて監査する

依存:

- P3-1
- P3-2

#### P3-4. CLI 自然言語入口

- [x] `sns agent chat "明日9時に投稿して"` のような入口を追加する
- [x] JSON 出力と human readable 出力の両方を整える
- [x] 非対話で完結する実行モードを用意する

依存:

- P3-2

#### P3-5. 日時・アカウント解決の安全策

- [x] 曖昧な日付はタイムゾーンつき ISO に変換する
- [x] アカウント指定が曖昧な場合は preview で止める
- [x] 直接実行ではなく `approval-required` を既定にする

依存:

- P3-2

#### P3-6. help ページで CLI コマンド一覧を案内

- [x] `/help` に CLI の主要コマンド一覧を載せる
- [x] `accounts / post / schedule / inbox / usage / llm / skills` の代表例を掲載する
- [x] Web UI と CLI の役割分担が非エンジニアにもわかる説明にする

依存:

- P3-4

### Phase 3 完了条件

- Web UI チャットから X 投稿 / 予約の preview が出る
- 承認後に実行される
- CLI からも自然言語で同様の操作ができる
- `/help` から CLI コマンド一覧と代表例を参照できる
- 全操作が権限・監査・予算ポリシーを通る

### Phase 3 完了後の確認手順

1. Web UI チャットで「今日の夕方 18:00 に X に投稿して」と入力する
2. preview に投稿本文、対象アカウント、予約時刻が出ることを確認する
3. 承認後に予約が作成されることを確認する
4. CLI から同等の自然言語コマンドを実行する
5. 監査ログに `agent.chat` と `agent.execute` が残ることを確認する
6. 権限不足ユーザーでは実行が blocked されることを確認する
7. `/help` に CLI コマンド一覧があり、主要コマンドの代表例を確認できることを確認する

## Phase 4. 全 SNS 対応 + 使用量の運用基盤化

### 目的

X 中心で育ててきた運用基盤を、LINE / Instagram まで広げ、さらに「どれだけ使ったか」「使いすぎていないか」まで同じ仕組みで管理できる状態にする。

### これが終わるとできること

- X / LINE / Instagram を同じ基盤で接続・投稿・監視できる
- API 使用量と推定コストを画面と API で確認できる
- 予算上限を超えそうな操作を `warn / require-approval / block` で制御できる

### What

- Phase 4 では「SNS を増やすこと」と「使った量を見える化すること」を同時に進める
- 対象は `provider-line`, `provider-instagram`, `usage`, `budget`, `Web UI`

### Why

- X だけ完成していても、運用現場では LINE や Instagram も同じ画面で扱いたくなる
- 投稿できても、コストや API 使用量が見えないと本番運用で不安が残る
- 予算ポリシーがないと、AI や自動処理を広げたときに「便利だが止めにくい」状態になりやすい

### How

- provider を追加しても Core Use Cases はできるだけ変えない
- 使用量記録は provider 呼び出しの結果を usecase 層から集約する
- 予算判定は投稿実行前に差し込み、必要に応じて承認や block に分岐する
- Web UI では「状況確認」と「制御設定」がすぐ見える導線を用意する

完成イメージ:

```txt
運用担当
  -> Web UI
     -> 使用量画面
     -> 予算ポリシー画面

API / Core Use Cases
  -> Provider Registry
     -> X Provider
     -> LINE Provider
     -> Instagram Provider
  -> Usage Recorder
  -> Budget Policy
  -> Database
```

### 実装タスク

ここでの `[x]` は「コードとして実装済み」を意味する。
Phase 4 全体の完了は、この下の「残確認項目」まで終わってから判断する。

#### P4-1. LINE プロバイダ実装

- [x] LINE 接続と投稿の provider を追加する
- [x] LINE 固有の投稿制約を validate できるようにする
- [x] webhook と inbox 拡張の入口を整える

依存:

- Phase 2 完了

#### P4-2. Instagram プロバイダ実装

- [x] Instagram 接続と投稿の provider を追加する
- [x] 画像 / 動画 / カルーセル投稿制約を validate できるようにする
- [x] webhook と inbox 拡張の入口を整える

依存:

- Phase 2 完了

#### P4-3. 使用量記録と集計 API

- [x] provider 呼び出しごとの使用量を記録する
- [x] `usage report` と `usage summary` を API から取得できるようにする
- [x] 推定コストを集計し、画面表示に渡せる形にする

依存:

- Phase 2 完了

#### P4-4. 予算ポリシー管理

- [x] workspace / platform / endpoint 単位で上限を定義できるようにする
- [x] `warn / require-approval / block` の 3 アクションを扱えるようにする
- [x] 投稿実行時に予算判定を差し込み、必要なら承認へ回せるようにする

依存:

- P4-3

#### P4-5. Web UI の使用量 / 予算画面

- [x] 使用量と推定コストをグラフと一覧で見える化する
- [x] 予算ポリシーの一覧・作成・更新・削除を画面から行えるようにする
- [x] 非エンジニアでも「今どこでどれだけ使っているか」がわかる導線にする

依存:

- Phase 3 完了
- P4-3
- P4-4

### Phase 4 完了条件

- X / LINE / Instagram の 3 SNS を同じ provider 方式で扱える
- 使用量記録と集計 API があり、推定コストを確認できる
- 予算ポリシーにより warn / require-approval / block を適用できる
- Web UI から使用量確認と予算設定ができる

### Phase 4 の今の状態

- コード実装: 完了
- テスト確認: 主要テスト通過
- 実環境確認: まだ
- 次にやること: 実アカウントで接続、投稿、usage、budget の流れを通して確認する

### Phase 4 の残確認項目

- [ ] LINE 実アカウントで接続から投稿まで確認する
- [ ] Instagram 実アカウントで接続から投稿まで確認する
- [ ] `/api/usage` と Web UI 使用量画面が実データで増えることを確認する
- [ ] 予算ポリシーの `warn / require-approval / block` を実フローで確認する
- [ ] 既存の X 投稿 / 予約 / inbox / チャット導線に回帰がないことを確認する

### Phase 4 完了後の確認手順

1. LINE と Instagram の接続設定を追加する
2. X / LINE / Instagram それぞれでテスト投稿を実行する
3. `/api/usage` と Web UI の使用量画面に記録が増えることを確認する
4. 予算ポリシーを `warn`, `require-approval`, `block` で切り替え、挙動差を確認する
5. 既存の X 投稿 / 予約 / inbox / チャット導線が壊れていないことを回帰確認する

## 6. 依存関係まとめ

```txt
Phase 1
  -> cron 予約投稿の安定化

Phase 2
  -> Phase 1 に依存
  -> X inbox / reply / thread 強化

Phase 3
  -> Phase 1 に依存
  -> inbox 系は Phase 2 に依存
  -> Web UI / CLI から AI 操作

Phase 4
  -> Phase 2 の provider / usecase を土台にする
  -> Phase 3 の Web UI 基盤に接続する
  -> LINE / Instagram / usage / budget を追加する
```

タスク単位の主な依存:

- P1-1 -> P1-2 -> P1-3
- P1-2 -> P1-4
- P2-1 -> P2-2 -> P2-3 -> P2-4
- P3-1 -> P3-2 -> P3-3
- P3-2 -> P3-4
- P3-4 -> P3-6
- P4-1 / P4-2 -> Phase 2 完了
- P4-3 -> Phase 2 完了
- P4-4 -> P4-3
- P4-5 -> Phase 3 完了, P4-3, P4-4

## 7. 今すぐ着手する順番

最初の着手順は以下を推奨する。

1. P1-1 Scheduler 実行方式の整理
2. P1-2 scheduled_jobs 状態遷移見直し
3. P1-3 再試行ポリシー明確化
4. P1-4 予約一覧 / 実行結果 UI 強化
5. P2-1 X inbox モデルの明確化

理由:

- 予約投稿の本番信頼性が最優先
- 次に X 運用の反応確認と返信対応を閉じる方が実務価値が高い
- 全 SNS 対応と使用量 / 予算は、その共通基盤の上に載せる方が安全

## 8. 実装後に何がどう変わるか

### Phase 1 完了後

- 「予約できる」から「予約が確実に出る」に変わる
- 運用担当が予約失敗を追跡できるようになる

### Phase 2 完了後

- 投稿管理ツールから、返信対応まで含む X 運用基盤に変わる

### Phase 3 完了後

- 手作業中心から、AI に指示して安全に実行する運用へ変わる
- CLI を知らないメンバーでも help ページを見ながら操作を追えるようになる

### Phase 4 完了後

- X 専用基盤から、X / LINE / Instagram を一元管理できる運用基盤へ変わる
- どれだけ使ったか、どこで使いすぎそうかを運用担当が画面で判断できるようになる

## 9. 参考

- `x-harness-oss`: https://github.com/Shudesu/x-harness-oss
- `openclaw`: https://github.com/openclaw/openclaw
- OpenClaw README のモデル / 認証 / failover 記述
