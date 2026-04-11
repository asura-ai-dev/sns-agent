---
id: 001
gh: null
title: labels.ts に MASTHEAD_TITLES / HELP_SECTIONS を追加し NAV_LABELS に /help を追加
type: feat
depends_on: []
files:
  - apps/web/src/lib/i18n/labels.ts
done_when:
  - apps/web/src/lib/i18n/labels.ts に `export const MASTHEAD_TITLES` が存在する
  - MASTHEAD_TITLES に次の 14 key がすべて含まれる - dashboard, posts, postsNew, calendar, inbox, usage, skills, agents, settingsAccounts, settingsUsers, settingsAudit, settingsLlm, settingsBudget, help
  - 各 MASTHEAD_TITLES entry が `kickerKey`, `ja`, `en` の 3 フィールドを必ず持つ型になっている
  - `NAV_LABELS` に `{ href: "/help", en: "Help", ja: "ヘルプ" }` 相当の entry が追加されている
  - `SECTION_KICKERS` に `help` の entry（例 "Help Desk"）が追加されている
  - `HELP_SECTIONS` が export され、6 個の文字列 "Reading Room" "Queue Notes" "Draft Method" "Timing Ledger" "Response Desk" "Control Notes" を含む
  - 既存の `NAV_LABELS`, `SECTION_KICKERS`, `COMMON_ACTIONS` の既存 entry が全て維持されている (grep で旧 entry key が残存することを確認)
  - `pnpm --filter @sns-agent/web typecheck` が成功する
---

## Context

`ui-polish-v2` #001 で `labels.ts` を導入したが、各ページの masthead / h1 の実文言は集約されておらず、ページファイルや `UsageMasthead.tsx` / `SettingsShell` 呼び出し側にハードコードされている。

本 issue では、後続 #002〜#005 で masthead と Sidebar を差し替える前提として、**辞書ファイル 1 つだけ**に全 masthead 文言を集約する。

既存の詩的 tagline（「すべての SNS を一つの紙面で」等）は **保存せず破棄する**。masthead は英語 kicker + 日本語短名詞 h1 + 英語 subheading の 3 要素のみとする。

spec.md の F1 を参照。

## Implementation Notes

### MASTHEAD_TITLES の型

```ts
export interface MastheadTitle {
  /** SECTION_KICKERS の key（英語 kicker） */
  kickerKey: SectionKickerKey;
  /** 日本語 h1（短い名詞句、Fraunces 見出し用） */
  ja: string;
  /** 英語 subheading（kicker と異なる説明） */
  en: string;
}

export const MASTHEAD_TITLES = {
  dashboard: {
    kickerKey: "dashboard",
    ja: "ダッシュボード",
    en: "Operations Ledger",
  },
  posts: {
    kickerKey: "posts",
    ja: "投稿",
    en: "Editorial Queue",
  },
  postsNew: {
    kickerKey: "compose",
    ja: "新しい投稿",
    en: "Draft Desk",
  },
  calendar: {
    kickerKey: "calendar",
    ja: "カレンダー",
    en: "Publishing Calendar",
  },
  inbox: {
    kickerKey: "inbox",
    ja: "受信トレイ",
    en: "Message Queue",
  },
  usage: {
    kickerKey: "usage",
    ja: "使用量",
    en: "Treasury Bulletin",
  },
  skills: {
    kickerKey: "skills",
    ja: "スキル",
    en: "Capabilities Gazette",
  },
  agents: {
    kickerKey: "agents",
    ja: "チャット",
    en: "The Wire Room",
  },
  settingsAccounts: {
    kickerKey: "settingsAccounts",
    ja: "アカウント接続",
    en: "Connected Accounts",
  },
  settingsUsers: {
    kickerKey: "settingsUsers",
    ja: "メンバーとエージェント",
    en: "Members & Agents",
  },
  settingsAudit: {
    kickerKey: "settingsAudit",
    ja: "監査ログ",
    en: "Operations Audit",
  },
  settingsLlm: {
    kickerKey: "settingsLlm",
    ja: "LLM ルーティング",
    en: "Dispatch Roster",
  },
  settingsBudget: {
    kickerKey: "settingsBudget",
    ja: "予算ポリシー",
    en: "Allowances Register",
  },
  help: {
    kickerKey: "help",
    ja: "ヘルプ",
    en: "Help Desk",
  },
} as const satisfies Record<string, MastheadTitle>;

export type MastheadKey = keyof typeof MASTHEAD_TITLES;
```

### SECTION_KICKERS 追加

```ts
export const SECTION_KICKERS = {
  // 既存 entry はすべて維持
  dashboard: "Operations Ledger",
  posts: "Editorial Queue",
  compose: "Draft Desk",
  calendar: "Publishing Calendar",
  inbox: "Message Queue",
  usage: "Usage Ledger",
  skills: "Capabilities Section",
  agents: "Agent Desk",
  settings: "Control Room",
  settingsAccounts: "Settings / Accounts",
  settingsUsers: "Settings / Users",
  settingsAudit: "Settings / Audit",
  settingsLlm: "Settings / LLM",
  settingsBudget: "Settings / Budget",
  // ← 追加
  help: "Help Desk",
} as const;
```

### NAV_LABELS 追加

既存 entry を維持し、末尾または `/settings` の直前に `/help` を追加。`Sidebar` の現行順（#005 で整理）は `/help` が `/settings` の直前なので、揃えて下記順に差し込む。

```ts
export const NAV_LABELS = [
  { href: "/", en: "Dashboard", ja: "ダッシュボード" },
  { href: "/posts", en: "Posts", ja: "投稿" },
  { href: "/calendar", en: "Calendar", ja: "カレンダー" },
  { href: "/inbox", en: "Inbox", ja: "受信トレイ" },
  { href: "/usage", en: "Usage", ja: "使用量" },
  { href: "/skills", en: "Skills", ja: "スキル" },
  { href: "/agents", en: "Agents", ja: "チャット" },
  { href: "/help", en: "Help", ja: "ヘルプ" }, // ← 追加
  { href: "/settings", en: "Settings", ja: "設定" },
] as const;
```

### HELP_SECTIONS

`/help` の 6 セクションは `SECTION_KICKERS` と階層が違うので別定数に分離する。

```ts
export const HELP_SECTIONS = {
  dashboard: { kicker: "Reading Room", titleJa: "ダッシュボード" },
  posts: { kicker: "Queue Notes", titleJa: "投稿" },
  compose: { kicker: "Draft Method", titleJa: "投稿作成" },
  calendar: { kicker: "Timing Ledger", titleJa: "予約 / カレンダー" },
  inbox: { kicker: "Response Desk", titleJa: "受信トレイ" },
  settings: { kicker: "Control Notes", titleJa: "設定" },
} as const;

export type HelpSectionKey = keyof typeof HELP_SECTIONS;
```

### 禁止事項

- 既存 `NAV_LABELS` / `SECTION_KICKERS` / `COMMON_ACTIONS` の entry を削除・改名しない（追加のみ）
- 本 issue ではページファイル・Sidebar・masthead コンポーネントを **一切触らない**。適用は #002〜#005 の責務
- `COMMON_ACTIONS` の拡張や、他コンポーネントへの適用もしない
- tagline フィールドは追加しない（要件から削除済み）

### 検証

```bash
pnpm --filter @sns-agent/web typecheck
```

タイプチェック通過を確認する。ランタイムの描画変化はこの issue では生じない。
