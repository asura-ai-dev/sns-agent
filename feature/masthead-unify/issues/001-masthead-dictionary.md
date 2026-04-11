---
id: 001
gh: null
title: labels.ts に MASTHEAD_TITLES を追加し NAV_LABELS に /help を追加
type: feat
depends_on: []
files:
  - apps/web/src/lib/i18n/labels.ts
done_when:
  - apps/web/src/lib/i18n/labels.ts に `export const MASTHEAD_TITLES` が存在する
  - MASTHEAD_TITLES は flat な `Record<string, string>` 形式（各 value が英語文字列）
  - MASTHEAD_TITLES に次の 14 key が含まれる - dashboard, posts, postsNew, calendar, inbox, usage, skills, agents, settingsAccounts, settingsUsers, settingsAudit, settingsLlm, settingsBudget, help
  - `NAV_LABELS` に `{ href: "/help", en: "Help", ja: "ヘルプ" }` 相当の entry が追加されている
  - 既存の `NAV_LABELS`, `SECTION_KICKERS`, `COMMON_ACTIONS` の既存 entry が全て維持されている
  - `pnpm --filter @sns-agent/web typecheck` が成功する
---

## Context

各ページの h1 に独自英語 ("Treasury Bulletin", "The Wire Room", "Capabilities Gazette") や日本語詩的副題がハードコードされており統一感がない。これを **1 ページ 1 英語単語** に揃える。

余計な階層（kicker / ja / en / tagline / subheading）は作らず、flat な `Record<key, string>` に統一する。

## Implementation Notes

### MASTHEAD_TITLES

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

### NAV_LABELS に /help を追加

既存 entry を維持し、`/settings` の直前に `/help` を追加:

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

### 禁止事項

- 既存 `SECTION_KICKERS` / `COMMON_ACTIONS` は削除・改名しない（そのまま維持）
- MastheadTitle interface, HELP_SECTIONS, tagline フィールド等の複雑な型は作らない
- 本 issue ではページファイル・Sidebar・masthead コンポーネントを一切触らない（適用は #002〜#005）

### 検証

```bash
pnpm --filter @sns-agent/web typecheck
```
