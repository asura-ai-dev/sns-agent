# SNS Agent UI Polish v2 - High-Level Specification

## 目的 / 背景

v1 で SNS Agent の Web UI は Operations Ledger / The Wire Room を参照する editorial トーン（Fraunces + DM Sans、DaisyUI sns-agent テーマ、paper ベース #FFFDF8）を確立した。一方で、開発を積み重ねるうちに次のような不整合が蓄積している。

- ページごとに英語・日本語のラベル粒度がバラバラで、editorial の「セクション名は英語 kicker、本文は日本語」の原則が徹底されていない
- サイドバーだけが `bg-secondary`（暗色）で、paper ベースの全体トーンから断絶している
- プラットフォームを表すチップ / ボタンがテキストラベル中心で、v1 で用意した `PlatformIcon` のブランドアイデンティティが活かされていない
- 投稿一覧 / Inbox のようなクロスプラットフォーム画面で、unified リスト以外の見せ方が選べない
- ヘルプ・CLI リファレンスの導線がなく、Web UI 単体でオペレータがセルフオンボードできない

本 feature の目的は、v1 で積み上げた editorial トーンを壊さずに、全ページを統一された磨き込みレベルへ引き上げることである。新規のアーキテクチャ変更やドメインロジックの追加は含まない。

## 主要機能

1. **言語レイヤの統一ルール適用**
   - 全ページの文言を以下の規則に揃える。
     - 英語: セクション見出し、ページタイトル kicker、eyebrow、カード / パネルのラベル見出し、ナビゲーション項目
     - 日本語: 本文説明、ボタンラベル、フォームラベルと placeholder、バリデーションエラー、トースト、empty state の説明文
   - 既存の辞書 / 定数をページ横断で一貫させ、今後の文言追加のガイドとなる共通ルールを定義する

2. **サイドバーのカラー統一**
   - Sidebar を paper ベースのトークン（`bg-base-100` 系 + accent rule）に差し替え、ヘッダー / 本文と地続きの面として成立させる
   - アクティブ項目 / ホバー / フォーカスの強調は既存 accent（rule, ink）で表現し、暗色ベタ塗りに依存しない
   - 既存の editorial hairline / ledger 風の境界線モチーフを維持する

3. **サイドバーのホバー自動展開**
   - デスクトップ（`md` 以上）でサイドバーを collapsed（アイコン + 短い rule）と expanded（アイコン + ラベル）の 2 状態に分離する
   - デフォルトは collapsed。ポインタがサイドバー領域に入ると expanded へ遷移し、離れると collapsed に戻る
   - 遷移はアクセシビリティを壊さない形（prefers-reduced-motion 尊重、focus 時は expanded を維持）で実装する
   - モバイルの drawer 挙動は v1 と同一

4. **ヘルプページ追加**
   - 新規ページ `/help`（または `/settings/help`、実装者判断）を追加
   - Web UI の主要画面の使い方の案内、および `packages/cli` の CLI コマンド体系（accounts / post / schedule / inbox / usage / llm / skills）のリファレンスを含める
   - ナビゲーション（サイドバーもしくはヘッダーの適切な位置）からアクセスできる
   - editorial トーン（Fraunces 見出し + DM Sans 本文、paper ベース）を踏襲する

5. **プラットフォームボタンのアイコン化**
   - 既存 `apps/web/src/components/settings/PlatformIcon.tsx` を活用し、以下の箇所でテキスト中心のプラットフォーム UI をアイコンチップ / アイコンボタンに差し替える
     - PostFilters のプラットフォーム絞り込み
     - 設定 / アカウント画面の新規接続ボタンおよびアカウントカード
     - Inbox のプラットフォーム絞り込みおよびスレッド行のプラットフォーム表示
     - Dashboard の PlatformOverview
   - アクセシビリティのため `aria-label` / tooltip で必ずプラットフォーム名を提供する
   - 既存 `PlatformIcon` で不足する variant（例: チップ用の小サイズ、outline 表現）が必要なら同ファイル内で拡張する

6. **ヘッダーのプラットフォーム表示モード切替**
   - 対象ページ: 投稿一覧 `/posts` と `/inbox`
   - ヘッダー右寄り（既存の通知ベル / アバターと同帯）にモードトグル UI を配置する
   - 2 モードを提供する
     - `unified`: 全プラットフォームを 1 つのリストで表示（現状の挙動）
     - `columns`: 各プラットフォームごとに独立カラムを並べ、水平スクロールで横断できる
   - 選択状態はページ単位で URL クエリパラメータ（例: `?view=columns`）と localStorage の両方で保持する。URL 優先、なければ localStorage、なければ `unified`
   - 対象ページ以外ではトグル UI は非表示

## 非機能要件

- **レスポンシブ**: `sm` / `md` / `lg` ブレークポイントで破綻しない。モバイルでは columns モードは horizontal scroll の snap で操作でき、hover 展開は無効
- **アクセシビリティ**: すべての新規 UI は `aria-label` / `aria-pressed` / `aria-expanded` を適切に付与し、キーボード操作で同等の操作ができる。`prefers-reduced-motion` を尊重する
- **デザイン言語の維持**: Fraunces + DM Sans、paper #FFFDF8 ベース、DaisyUI sns-agent テーマ、editorial hairline を破壊しない。新規の色・フォント・大型シャドウを導入しない
- **i18n 拡張余地**: 言語レイヤ統一の実装は、将来的に locale 切替を入れる際に文言抽出しやすい形（定数化 / 共通辞書化）を意識する。ただし locale 切替自体は本 feature の範囲外
- **パフォーマンス**: サイドバーのホバー展開や columns 表示切替でレイアウトシフトや明確な jank を起こさない
- **互換性**: 既存のページ URL、API、localStorage キーの既存値を壊さない（新規キーのみ追加）

## 受け入れ条件

### 言語レイヤ統一 (F1)

- AC-1: 全 13 ページを通じて、セクション見出し / eyebrow / ナビゲーション項目は英語で表現されている
- AC-2: 全 13 ページを通じて、本文説明 / ボタンラベル / フォームラベルと placeholder / エラーメッセージ / empty state は日本語で表現されている
- AC-3: 同じ概念（例: 「投稿を作成」）に対して複数の表記ゆれが存在しない（Grep で単語の揺れが解消されていることを確認できる）

### サイドバーのカラー統一 (F2)

- AC-4: Sidebar のルート要素から `bg-secondary` など暗色ベタの背景指定が削除され、paper ベーストークンに置き換わっている
- AC-5: アクティブ項目 / ホバー / フォーカス状態が視認でき、AA コントラストを満たす
- AC-6: 既存のヘッダー / 本文と境界線 / 余白が整合し、editorial hairline が維持されている

### サイドバーのホバー自動展開 (F3)

- AC-7: `md` 以上でサイドバーはデフォルト collapsed（アイコン + rule のみ）である
- AC-8: ポインタが Sidebar 内に入ると expanded（アイコン + ラベル）へ遷移し、離脱すると collapsed に戻る
- AC-9: キーボードフォーカスが Sidebar 内にある間は expanded 状態が保持される
- AC-10: モバイル drawer の挙動は v1 と同一（既存の開閉操作が破壊されていない）
- AC-11: `prefers-reduced-motion: reduce` のとき遷移アニメーションが無効化される

### ヘルプページ (F4)

- AC-12: `/help`（または `/settings/help`）が存在し、サイドバーまたはヘッダーから 1 クリックで到達できる
- AC-13: Web UI の主要機能（dashboard / posts / compose / schedule / inbox / settings）の概要説明が掲載されている
- AC-14: CLI コマンド（accounts / post / schedule / inbox / usage / llm / skills）の代表的な使用例が掲載されている
- AC-15: ページは Fraunces + DM Sans、paper ベースの editorial トーンを維持している

### プラットフォームアイコン化 (F5)

- AC-16: PostFilters のプラットフォーム絞り込みが `PlatformIcon` ベースのチップで表現されている
- AC-17: 設定 / アカウント画面の新規接続ボタンおよびアカウントカードが `PlatformIcon` を使用している
- AC-18: Inbox のプラットフォーム絞り込みおよびスレッド行で `PlatformIcon` が使用されている
- AC-19: Dashboard の PlatformOverview が `PlatformIcon` を使用している
- AC-20: 各アイコン UI に `aria-label` / tooltip でプラットフォーム名（X / LINE / Instagram）が付与されている

### プラットフォーム表示モード切替 (F6)

- AC-21: `/posts` と `/inbox` のヘッダー帯にモードトグルが表示される
- AC-22: `unified` 選択時は既存と同じ単一リスト表示になる
- AC-23: `columns` 選択時は各プラットフォームごとのカラムが並び、水平スクロールで横断できる
- AC-24: URL に `?view=columns` を付けてリロードするとその状態で復元される
- AC-25: URL 指定がない場合は localStorage に保存した最後の選択状態が復元される
- AC-26: 対象ページ以外（例: dashboard, settings）にはトグル UI が表示されない

## スコープ境界

以下は本 feature の範囲に含めない（別タスク扱い）。

- v1 の known_gaps として挙がっている audit / inbox の OfflineBanner 共通化
- Sidebar の情報設計や分類体系の全面再設計（階層追加 / グループ化）
- locale 切替機構（i18n ランタイム）本体の導入
- モバイル実機での E2E 検証環境整備
- 新規ドメイン機能の追加、API スキーマ変更、権限モデル変更
- 既存ページの情報アーキテクチャ変更（カラム構成の抜本変更など、本 feature の範囲外の編集）

## 影響範囲

既存調査結果を転記する。

- ページ群: `/`（dashboard）から `/settings/users` まで 13 ページ、言語混在
- `apps/web/src/components/.../Sidebar.tsx`: `bg-secondary`、ホバー展開なし
- `apps/web/src/components/.../Header.tsx`: ハンバーガー + ワークスペース名 + 通知ベル + アバターのみ、モードトグル未実装
- `apps/web/src/components/settings/PlatformIcon.tsx`: X / LINE / Instagram のブランドアイコン + カラー定義あり、活用可
- `PostFilters`, `inbox` の platform chip は既存あり
- `packages/cli` の既存コマンド体系: accounts / post / schedule / inbox / usage / llm / skills

## 実装順序

以下は推奨順。実装者の判断で調整してよい。

### Phase 1: 基盤整備

1. **言語レイヤ統一 (F1)** - 先に文言ルールを固め、後続フェーズで追加される新規 UI もこのルールに従う前提を作る
2. **サイドバーのカラー統一 (F2)** - paper ベースへの差し替え。Phase 3 のホバー展開の土台になる

### Phase 2: 主要改善

3. **プラットフォームアイコン化 (F5)** - 既存 `PlatformIcon` を横展開。Phase 3 の columns モードで使うヘッダー / カラムタイトルにも再利用されるため、columns より先に済ませておく
4. **サイドバーのホバー自動展開 (F3)** - F2 の後に着手。collapsed/expanded の 2 状態を導入する

### Phase 3: 新規機能

5. **ヘルプページ (F4)** - 既存デザイン言語と Phase 1 の言語ルールが整ってから追加すると一貫性を保ちやすい
6. **プラットフォーム表示モード切替 (F6)** - F5 のアイコン化が済んでいる前提で columns モードのカラムヘッダーを構成する。最後に着手

## 評価観点

Evaluator は以下を重点的に確認する。

- **言語ルール**: 13 ページをサンプリングし、見出し / 本文 / ボタン / エラーメッセージの言語がルール通りになっているか
- **サイドバー外観**: `bg-secondary` が残っていないこと。ヘッダー / 本文との地続き感があること。AA コントラストを満たすこと
- **サイドバー挙動**: desktop でホバーにより collapsed / expanded が切り替わること、focus 中は expanded が維持されること、モバイル drawer が壊れていないこと、`prefers-reduced-motion` が尊重されること
- **ヘルプページ**: 導線、主要機能説明、CLI リファレンスの 3 要素が揃っていること
- **プラットフォームアイコン化**: 対象 4 箇所（PostFilters / settings-accounts / inbox / dashboard PlatformOverview）すべてで `PlatformIcon` が使われ、`aria-label` が付与されていること
- **表示モード切替**: `/posts` と `/inbox` で `unified` / `columns` の両モードが動くこと、URL クエリと localStorage の両方で状態が復元されること、対象外ページにトグルが露出していないこと
- **回帰**: v1 の主要ユーザーフロー（アカウント接続 / 投稿作成 / 予約 / inbox 閲覧 / 設定変更）が壊れていないこと
