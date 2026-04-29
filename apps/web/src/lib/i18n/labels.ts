export const NAV_LABELS = [
  { href: "/", en: "Dashboard", ja: "ダッシュボード" },
  { href: "/posts", en: "Posts", ja: "投稿" },
  { href: "/calendar", en: "Calendar", ja: "カレンダー" },
  { href: "/inbox", en: "Inbox", ja: "受信トレイ" },
  { href: "/gates", en: "Gates", ja: "ゲート" },
  { href: "/campaigns", en: "Campaigns", ja: "キャンペーン" },
  { href: "/followers", en: "Followers", ja: "フォロワー" },
  { href: "/tags", en: "Tags", ja: "タグ" },
  { href: "/quotes", en: "Quotes", ja: "引用" },
  { href: "/analytics", en: "Analytics", ja: "分析" },
  { href: "/sequences", en: "Sequences", ja: "シーケンス" },
  { href: "/usage", en: "Usage", ja: "使用量" },
  { href: "/skills", en: "Skills", ja: "スキル" },
  { href: "/agents", en: "Agents", ja: "チャット" },
  { href: "/help", en: "Help", ja: "ヘルプ" },
  { href: "/settings", en: "Settings", ja: "設定" },
] as const;

export const SECTION_KICKERS = {
  dashboard: "Operations Ledger",
  posts: "Editorial Queue",
  compose: "Draft Desk",
  calendar: "Publishing Calendar",
  inbox: "Message Queue",
  gates: "Engagement Gates",
  campaigns: "Campaign Desk",
  followers: "Follower Ledger",
  tags: "Segment Desk",
  quotes: "Quote Ledger",
  analytics: "Analytics Ledger",
  sequences: "Sequence Desk",
  usage: "Usage Ledger",
  skills: "Capabilities Section",
  agents: "Agent Desk",
  settings: "Control Room",
  settingsAccounts: "Settings / Accounts",
  settingsUsers: "Settings / Users",
  settingsAudit: "Settings / Audit",
  settingsLlm: "Settings / LLM",
  settingsBudget: "Settings / Budget",
} as const;

export const COMMON_ACTIONS = {
  save: "保存",
  cancel: "キャンセル",
  delete: "削除",
  retry: "再試行",
  create: "作成",
  update: "更新",
  edit: "編集",
  close: "閉じる",
  back: "戻る",
  confirm: "確認",
} as const;

export const MASTHEAD_TITLES = {
  dashboard: "Dashboard",
  posts: "Posts",
  postsNew: "New Post",
  calendar: "Calendar",
  inbox: "Inbox",
  gates: "Gates",
  campaigns: "Campaigns",
  followers: "Followers",
  tags: "Tags",
  quotes: "Quotes",
  analytics: "Analytics",
  sequences: "Sequences",
  usage: "Usage",
  skills: "Skills",
  agents: "Agents",
  settingsAccounts: "Accounts",
  settingsUsers: "Members",
  settingsAudit: "Audit",
  settingsLlm: "LLM",
  settingsBudget: "Budget",
  help: "Help",
} as const;

export type NavLabel = (typeof NAV_LABELS)[number];
export type SectionKickerKey = keyof typeof SECTION_KICKERS;
export type CommonActionKey = keyof typeof COMMON_ACTIONS;
export type MastheadKey = keyof typeof MASTHEAD_TITLES;
