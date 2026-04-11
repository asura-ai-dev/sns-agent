# SNS Agent Masthead Unify - High-Level Specification

## 目的 / 背景

`ui-polish-v2` の issue #001〜#004 で共通辞書 `apps/web/src/lib/i18n/labels.ts`（`NAV_LABELS`, `SECTION_KICKERS`, `COMMON_ACTIONS`）を導入し、各ページに `SECTION_KICKERS` を import させるところまで到達した。しかし実際の **masthead（ページ最上段の見出しブロック）** と `<h1>` の文言は依然としてバラバラで、editorial トーンの「英語 kicker + 日本語本文」の原則が破れている。

### 現状の不整合（調査済み）

| path                 | 現状の h1 / masthead 文言                                                                                                                     | 問題カテゴリ                                      |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `/`                  | `SECTION_KICKERS.dashboard` = "Operations Ledger"                                                                                             | kicker をそのまま h1 に使い、日本語タイトルが不在 |
| `/posts`             | 「すべての SNS を一つの紙面で」                                                                                                               | 日本語詩的文言がインラインで散在                  |
| `/posts/new`         | 「新しい投稿を作成」                                                                                                                          | 素の日本語（統一 dict 外）                        |
| `/calendar`          | 「予約を一枚の暦で見渡す」                                                                                                                    | 日本語詩的文言がインラインで散在                  |
| `/inbox`             | 「会話を一箇所で読む」                                                                                                                        | 日本語詩的文言がインラインで散在                  |
| `/usage`             | "Treasury Bulletin"（`UsageMasthead.tsx` にハードコード）                                                                                     | dict にない独自英語、日本語 h1 無し               |
| `/skills`            | "Capabilities Gazette"（page.tsx で props 渡し）                                                                                              | dict にない独自英語、日本語 h1 無し               |
| `/agents`            | "The Wire Room"（`ChatContainer.tsx` にハードコード）                                                                                         | dict にない独自英語、日本語 h1 無し               |
| `/settings/accounts` | "Connected Accounts"（`SettingsShell` 経由）                                                                                                  | dict にない独自英語、日本語 h1 無し               |
| `/settings/users`    | "Members & Agents"                                                                                                                            | 同上                                              |
| `/settings/audit`    | "Operations Ledger"（dashboard と衝突）                                                                                                       | 同上・タイトル重複                                |
| `/settings/llm`      | "Dispatch Roster"                                                                                                                             | 同上                                              |
| `/settings/budget`   | "Allowances Register"                                                                                                                         | 同上                                              |
| `/help`              | "Help for Daily Operations" + 6 セクション独自 kicker（Reading Room, Queue Notes, Draft Method, Timing Ledger, Response Desk, Control Notes） | dict にない文言群                                 |

さらに、`apps/web/src/components/layout/Sidebar.tsx` の `NAV_ITEMS` は日本語ラベルがハードコードされており、定義済みの `NAV_LABELS` を参照していない。`NAV_LABELS` には `/help` が未登録のため、Sidebar 側の ad-hoc な列に存在している。

### 本 feature の目的

1. **全ページの masthead を単一パターンへ統一する**
2. **Sidebar を `NAV_LABELS` ベースに置き換える**

新規のドメインロジック・API 変更・デザイン言語の転換は含まない。`ui-polish-v2` で敷いた「英語 kicker + 日本語本文」のレール上で、文言を一箇所（`labels.ts`）に集約することが本質である。

## 統一 masthead パターン

全ページの masthead は以下の 3 要素で構成する：

1. **英語 kicker** — small caps, mono, letter-spacing、`SECTION_KICKERS.*` から取得
2. **日本語 h1** — Fraunces, text-4xl 相当、ページの本題を短く要約（新設 `MASTHEAD_TITLES.*.ja`）
3. **英語 subheading（任意）** — Fraunces italic, text-sm, 副題（新設 `MASTHEAD_TITLES.*.en`）

既存の「詩的日本語文言」（例:「すべての SNS を一つの紙面で」「予約を一枚の暦で見渡す」「会話を一箇所で読む」）は **保存する**。`MASTHEAD_TITLES.*.tagline`（optional、日本語）フィールドへ集約し、h1 の下に副題として配置する。`/help` / `/usage` / `/skills` / `/agents` など tagline を持たないページでは省略する。

> **spec 判断**: tagline を捨てず保持する。理由は (a) ui-polish-v2 で確立した editorial トーンを削る方向の変更は背景と矛盾する、(b) h1（短い名詞句）と tagline（情感的な説明）は役割が異なるため共存させても冗長にならない、(c) 実装コストはフィールド追加のみで小さい。

### `/help` の扱い

- `/help` 自体の masthead は上記統一パターンに揃える。`SECTION_KICKERS.help` を新設、`MASTHEAD_TITLES.help.ja = "ヘルプ"` 相当、tagline は既存の「主要画面の見方と…」を移植
- `/help` 内の 6 セクション kicker（Reading Room, Queue Notes, Draft Method, Timing Ledger, Response Desk, Control Notes）は **`SECTION_KICKERS` には寄せず、`labels.ts` に新定数 `HELP_SECTIONS` として追加する**。理由は: これらはページ内セクション見出しであり、トップレベルのセクション kicker とは階層が違うため
  - `HELP_SECTIONS` は `{ key, kicker, titleJa, bodyJaList? }` のような構造だが、本 feature では最低限「6 セクションの kicker 英語文字列」を集約するに留める。body は既存コードに残して構わない

## 主要機能

### F1. `labels.ts` 拡張（破壊変更なし）

- 新規定数 `MASTHEAD_TITLES`: 全 masthead を持つページ（dashboard / posts / postsNew / calendar / inbox / usage / skills / agents / settingsAccounts / settingsUsers / settingsAudit / settingsLlm / settingsBudget / help）を key として、以下の形で定義
  ```ts
  export const MASTHEAD_TITLES = {
    dashboard: {
      kickerKey: "dashboard", // SECTION_KICKERS の key
      ja: "ダッシュボード", // 短い日本語 h1
      en: "Operations Ledger", // 英語 subheading（kicker と重複可）
      tagline: "投稿、予約、使用量、運用状況を毎日確認できる",
    },
    // …
  } as const;
  ```
- 新規 entry を `SECTION_KICKERS` に追加: `help: "Help Desk"`, `postsNew: "Draft Desk"`（後者は既存 `compose` と同値なら compose を流用）
- `NAV_LABELS` に `/help` を追加: `{ href: "/help", en: "Help", ja: "ヘルプ" }`
- 新規定数 `HELP_SECTIONS`: 6 セクションの `kicker` 英語文字列を集約
- 既存の `NAV_LABELS` / `SECTION_KICKERS` / `COMMON_ACTIONS` の既存 entry は削除・改名しない（追加のみ）

### F2. 全 masthead を `MASTHEAD_TITLES` 駆動へ差し替え

- dashboard / posts / posts/new / calendar / inbox / usage / skills / agents / settings/\* / help の masthead を `MASTHEAD_TITLES[key]` から描画するよう差し替え
- hardcoded な「すべての SNS を一つの紙面で」「Treasury Bulletin」「The Wire Room」「Connected Accounts」等をインラインから除去
- 既存のレイアウト / Double-rule / Fraunces スタイルなどの見た目（ledger 風 hairline、edition メタ行）は **破壊しない**。文言の差し替えのみ行う
- `UsageMasthead.tsx` / `SkillsMasthead.tsx` / `SettingsShell.tsx` / `ChatContainer.tsx` 内の ad-hoc 文言もここで除去対象
- `/help` の 6 セクション内部 kicker は `HELP_SECTIONS` を参照する

### F3. Sidebar を `NAV_LABELS` ベースへ差し替え

- `apps/web/src/components/layout/Sidebar.tsx` の `NAV_ITEMS` 配列から **label と href のハードコード値を除去**し、`NAV_LABELS`（from `@/lib/i18n/labels`）を参照する
- `icon` は `NAV_ITEMS` 側で保持して良い（phosphor の型が辞書側に漏れるのを避けるため）
- 実装方針: `NAV_LABELS` を name として、href をキーに icon をマップする `NAV_ICONS` を Sidebar ローカルで定義し、`.map()` で結合する
- collapsed 時は icon のみ、expanded 時は `ja` ラベルを表示（現状と同じ挙動）。`en` は aria-label / tooltip 用に使用する（将来の locale 切替余地）
- `/help` は `NAV_LABELS` に追加されたうえで Sidebar に出現する

## 非機能要件

- **デザイン言語の維持**: Fraunces + DM Sans、paper #FFFDF8、DaisyUI sns-agent テーマ、editorial hairline を破壊しない
- **レイアウト不変**: masthead の高さ・余白・罫線・edition メタ行は現状と視覚的に同等（文言のみ差し替え）
- **破壊変更ゼロ**: 既存の `NAV_LABELS`, `SECTION_KICKERS`, `COMMON_ACTIONS` の entry を削除・改名しない
- **型安全**: `MASTHEAD_TITLES` は `as const` + 型 export、未登録ページからの参照はコンパイルエラーにする
- **互換性**: ページ URL、API、localStorage キーは一切変更しない
- **a11y**: Sidebar の NAV item は `aria-label` に日本語または en/ja 併記で適切な説明を持つ
- **スコープ制限**: `COMMON_ACTIONS` 全面展開は本 feature 対象外。本 feature では触らない

## 受け入れ条件

### 辞書拡張 (F1)

- AC-1: `apps/web/src/lib/i18n/labels.ts` に `MASTHEAD_TITLES` が export されている
- AC-2: `MASTHEAD_TITLES` は最低 13 ページ分（dashboard, posts, postsNew, calendar, inbox, usage, skills, agents, settingsAccounts, settingsUsers, settingsAudit, settingsLlm, settingsBudget, help）の key を含む
- AC-3: 各 entry は `kickerKey`, `ja`, `en` を必ず含み、`tagline` は optional である
- AC-4: `NAV_LABELS` に `/help` の entry が追加されている
- AC-5: `SECTION_KICKERS` に `help` の entry が追加されている
- AC-6: `HELP_SECTIONS` が export され、6 個の kicker 文字列を含む（Reading Room / Queue Notes / Draft Method / Timing Ledger / Response Desk / Control Notes と一致）
- AC-7: 既存の `NAV_LABELS`, `SECTION_KICKERS`, `COMMON_ACTIONS` の entry はすべて維持されている（削除・改名なし）
- AC-8: `pnpm --filter @sns-agent/web typecheck` が成功する

### masthead 統一 (F2)

- AC-9: dashboard / posts / posts/new / calendar / inbox の masthead から以下の hardcoded 日本語が除去されている
  - 「すべての SNS を一つの紙面で」
  - 「予約を一枚の暦で見渡す」
  - 「会話を一箇所で読む」
  - （それぞれは `MASTHEAD_TITLES[*].tagline` として `labels.ts` に移動している）
- AC-10: `/usage` の masthead が `MASTHEAD_TITLES.usage` を参照し、`UsageMasthead.tsx` から `"Treasury Bulletin"` 文字列リテラルが除去されている
- AC-11: `/skills` の masthead が `MASTHEAD_TITLES.skills` を参照し、`page.tsx` の `title="Capabilities Gazette"` ハードコードが除去されている
- AC-12: `/agents` の masthead が `MASTHEAD_TITLES.agents` を参照し、`ChatContainer.tsx` から `"The Wire Room"` 文字列リテラルが除去されている
- AC-13: settings 5 ページ（accounts, users, audit, llm, budget）の `SettingsShell` 呼び出しが `title="..."` ハードコードではなく `MASTHEAD_TITLES[*]` を参照している
- AC-14: `/help` の h1 masthead が `MASTHEAD_TITLES.help` を参照し、6 セクションの kicker は `HELP_SECTIONS` を参照している
- AC-15: 全 13 ページで「英語 kicker → 日本語 h1 → 任意の英語 subheading or 日本語 tagline」の構造が共通して適用されている
- AC-16: `pnpm --filter @sns-agent/web build` が成功する（masthead 差し替え後に lint / typecheck / build を通る）

### Sidebar 統一 (F3)

- AC-17: `apps/web/src/components/layout/Sidebar.tsx` の `NAV_ITEMS` 配列から label の日本語文字列リテラル（`"ダッシュボード"`, `"投稿"`, `"カレンダー"`, `"受信トレイ"`, `"使用量"`, `"チャット"`, `"ヘルプ"`, `"設定"`）が除去されている
- AC-18: Sidebar が `NAV_LABELS` を import し、`.map()` で href / label を供給している
- AC-19: Sidebar に `/help` の項目が出現している（`NAV_LABELS` から供給）
- AC-20: collapsed（デスクトップ）時は icon のみ、expanded / drawer 時は日本語ラベルが表示されるという現行の視覚挙動が維持されている
- AC-21: `pnpm --filter @sns-agent/web build` が成功する

## 影響範囲

### 編集対象ファイル

- `apps/web/src/lib/i18n/labels.ts`（拡張）
- `apps/web/src/components/layout/Sidebar.tsx`（`NAV_ITEMS` 再構成）
- `apps/web/src/app/(dashboard)/page.tsx`（dashboard masthead）
- `apps/web/src/app/(dashboard)/posts/page.tsx`
- `apps/web/src/app/(dashboard)/posts/new/page.tsx`
- `apps/web/src/app/(dashboard)/calendar/page.tsx`
- `apps/web/src/app/(dashboard)/inbox/page.tsx`
- `apps/web/src/app/(dashboard)/usage/page.tsx` + `apps/web/src/components/usage/UsageMasthead.tsx`
- `apps/web/src/app/(dashboard)/skills/page.tsx` + `apps/web/src/components/skills/SkillsMasthead.tsx`
- `apps/web/src/app/(dashboard)/agents/page.tsx` + `apps/web/src/components/chat/ChatContainer.tsx`
- `apps/web/src/app/(dashboard)/settings/accounts/page.tsx`
- `apps/web/src/app/(dashboard)/settings/users/page.tsx`
- `apps/web/src/app/(dashboard)/settings/audit/page.tsx`
- `apps/web/src/app/(dashboard)/settings/llm/page.tsx`
- `apps/web/src/app/(dashboard)/settings/budget/page.tsx`
- `apps/web/src/app/(dashboard)/help/page.tsx`
- `apps/web/src/components/settings/SettingsShell.tsx`（必要なら型調整のみ）

### 非対象

- API / DB / CLI / ドメインロジック
- デザイントークン（色・フォント・余白）の変更
- `COMMON_ACTIONS` の他コンポーネントへの追加展開
- locale 切替機能の実装
- `/help` 本文の書き換え（kicker のみ辞書化し、body は現状維持）
