# SNS Agent Masthead Unify - Specification

## 目的

全ページの h1 を「ページ名そのもの」の英語 1 語に統一する。独自の editorial 英語フレーズ（Treasury Bulletin 等）や日本語詩的副題（「すべての SNS を一つの紙面で」等）を完全に除去し、シンプルでバラつきのない見出しにする。加えて Sidebar を `NAV_LABELS` 参照に切り替える。

## 現状の不整合（調査済み）

| path                 | 現状の h1                   | 問題                 |
| -------------------- | --------------------------- | -------------------- |
| `/`                  | Operations Ledger           | kicker がそのまま h1 |
| `/posts`             | すべての SNS を一つの紙面で | 日本語詩的           |
| `/posts/new`         | 新しい投稿を作成            | 素の日本語           |
| `/calendar`          | 予約を一枚の暦で見渡す      | 日本語詩的           |
| `/inbox`             | 会話を一箇所で読む          | 日本語詩的           |
| `/usage`             | Treasury Bulletin           | dict 外の独自英語    |
| `/skills`            | Capabilities Gazette        | dict 外の独自英語    |
| `/agents`            | The Wire Room               | dict 外の独自英語    |
| `/settings/accounts` | Connected Accounts          | dict 外              |
| `/settings/users`    | Members & Agents            | dict 外              |
| `/settings/audit`    | Operations Ledger           | dashboard と重複     |
| `/settings/llm`      | Dispatch Roster             | dict 外              |
| `/settings/budget`   | Allowances Register         | dict 外              |
| `/help`              | Help for Daily Operations   | dict 外              |

Sidebar `NAV_ITEMS` は日本語ラベルがハードコード、`NAV_LABELS`（en/ja 併記）を使っていない。

## 統一 masthead パターン

```tsx
<h1 className="font-display text-4xl font-semibold">
  {MASTHEAD_TITLES.posts} {/* = "Posts" */}
</h1>
```

**1 要素のみ**: 英語 1 語の h1 (page 名そのもの)。kicker / subheading / 日本語副題 / tagline は全て廃止。

既存の editorial 装飾（Fraunces / hairline / paper base / double-rule / edition メタ行 / 日付行等）は触らない。h1 の文字だけ差し替える。

## 主要機能

### F1. `labels.ts` 拡張

- 新規 `MASTHEAD_TITLES`: flat な `Record<key, string>` (英語 1 語)
- `NAV_LABELS` に `/help` を追加
- 既存 `SECTION_KICKERS` / `COMMON_ACTIONS` は触らない（追加も削除もしない、そのまま）

```ts
export const MASTHEAD_TITLES = {
  dashboard: "Dashboard",
  posts: "Posts",
  postsNew: "New Post",
  calendar: "Calendar",
  inbox: "Inbox",
  usage: "Usage",
  skills: "Skills",
  agents: "Agents",
  settingsAccounts: "Accounts",
  settingsUsers: "Users",
  settingsAudit: "Audit",
  settingsLlm: "LLM",
  settingsBudget: "Budget",
  help: "Help",
} as const;

export type MastheadKey = keyof typeof MASTHEAD_TITLES;
```

### F2. 全 masthead の h1 差し替え

全 14 ページの h1 を `{MASTHEAD_TITLES.<key>}` に置換。
既存の日本語詩的副題、独自英語フレーズ、description 長文はすべて削除。
既存レイアウト / 装飾は触らない。

### F3. Sidebar を `NAV_LABELS` ベースに

`Sidebar.tsx` の `NAV_ITEMS` 配列を `NAV_LABELS` 参照に差し替える。
icon は Sidebar ローカルの `NAV_ICONS` マップで href をキーに解決する。
`/help` が Sidebar に出現する。

## 非機能要件

- **デザイン言語維持**: Fraunces + DM Sans、paper base、editorial hairline 等はすべて維持
- **レイアウト不変**: masthead の高さ / 余白 / 罫線は現状と視覚的に同等
- **破壊変更ゼロ**: `SECTION_KICKERS`, `COMMON_ACTIONS`, `NAV_LABELS` の既存 entry は削除・改名しない
- **スコープ制限**: `COMMON_ACTIONS` の展開、日本語本文の書き換えは本 feature 対象外

## 受け入れ条件

### F1 (辞書)

- AC-1: `MASTHEAD_TITLES` が export されている (flat Record<string, string>)
- AC-2: 14 key (dashboard〜help) を含む
- AC-3: `NAV_LABELS` に `/help` が追加されている
- AC-4: `SECTION_KICKERS` / `COMMON_ACTIONS` の既存 entry が全て維持されている
- AC-5: `pnpm --filter @sns-agent/web typecheck` が成功

### F2 (masthead 差し替え)

- AC-6: 14 ページ全ての h1 が `{MASTHEAD_TITLES.<key>}` を描画している
- AC-7: 以下の literal が完全に除去されている
  - "すべての SNS を一つの紙面で"
  - "予約を一枚の暦で見渡す"
  - "会話を一箇所で読む"
  - "Treasury Bulletin"
  - "The Wire Room"
  - "Capabilities Gazette"
  - "Connected Accounts" (/settings/accounts h1 として)
  - "Members & Agents", "Dispatch Roster", "Allowances Register"
  - "Help for Daily Operations"
- AC-8: settings/audit の h1 "Operations Ledger" 重複が解消されている
- AC-9: `pnpm --filter @sns-agent/web build` が成功

### F3 (Sidebar)

- AC-10: `Sidebar.tsx` から日本語ラベル literal ("ダッシュボード", "投稿"…) が除去され、`NAV_LABELS` 参照に変わっている
- AC-11: Sidebar に `/help` 項目が出現
- AC-12: collapsed / expanded / drawer いずれでもラベルが `NAV_LABELS.ja` から描画される
- AC-13: `pnpm --filter @sns-agent/web build` が成功

## 影響範囲

### 編集対象

- `apps/web/src/lib/i18n/labels.ts`
- `apps/web/src/components/layout/Sidebar.tsx`
- `apps/web/src/app/(dashboard)/page.tsx`
- `apps/web/src/app/(dashboard)/posts/page.tsx`
- `apps/web/src/app/(dashboard)/posts/new/page.tsx`
- `apps/web/src/app/(dashboard)/calendar/page.tsx`
- `apps/web/src/app/(dashboard)/inbox/page.tsx`
- `apps/web/src/app/(dashboard)/usage/page.tsx` + `components/usage/UsageMasthead.tsx`
- `apps/web/src/app/(dashboard)/skills/page.tsx` + `components/skills/SkillsMasthead.tsx`
- `apps/web/src/app/(dashboard)/agents/page.tsx` + `components/chat/ChatContainer.tsx`
- `apps/web/src/app/(dashboard)/settings/{accounts,users,audit,llm,budget}/page.tsx`
- `apps/web/src/app/(dashboard)/help/page.tsx`

### 非対象

- API / DB / CLI / ドメインロジック
- デザイントークン（色・フォント・余白）
- `COMMON_ACTIONS` の展開
- `/help` 本文 body の書き換え
- locale 切替機能
