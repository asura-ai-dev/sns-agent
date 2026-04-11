---
id: 003
gh: null
title: usage / skills / agents の h1 を MASTHEAD_TITLES に差し替え
type: refactor
depends_on: [001]
files:
  - apps/web/src/app/(dashboard)/usage/page.tsx
  - apps/web/src/components/usage/UsageMasthead.tsx
  - apps/web/src/app/(dashboard)/skills/page.tsx
  - apps/web/src/components/skills/SkillsMasthead.tsx
  - apps/web/src/app/(dashboard)/agents/page.tsx
  - apps/web/src/components/chat/ChatContainer.tsx
done_when:
  - UsageMasthead.tsx から "Treasury Bulletin" literal が削除されている
  - skills/page.tsx から `title="Capabilities Gazette"` ハードコードが削除されている
  - ChatContainer.tsx から "The Wire Room" literal が削除されている
  - 3 ページすべての h1 が `{MASTHEAD_TITLES.<key>}` を描画している
  - 既存の日本語 italic 副題ブロックは削除されている
  - `pnpm --filter @sns-agent/web typecheck` が成功する
  - `pnpm --filter @sns-agent/web build` が成功する
---

## Context

usage / skills / agents は masthead が専用コンポーネントに切られているか props 経由で文言を渡しているが、いずれも辞書を使わずハードコード。001 の flat `MASTHEAD_TITLES` を経由する形に置き換える。

## Implementation Notes

### usage (`UsageMasthead.tsx`)

```tsx
import { MASTHEAD_TITLES } from "@/lib/i18n/labels";

<h1 className="font-display text-4xl">{MASTHEAD_TITLES.usage}</h1>;
```

- 現状 "Treasury Bulletin" の literal を削除
- 既存の日本語 italic 副題ブロックは削除
- meta 行（`SECTION_KICKERS.usage` 参照など）は既存のまま残して良い

### skills (`skills/page.tsx` + `SkillsMasthead.tsx`)

呼び出し側で `title` prop を辞書値に差し替え:

```tsx
import { MASTHEAD_TITLES } from "@/lib/i18n/labels";

<SkillsMasthead
  title={MASTHEAD_TITLES.skills}  // ← "Skills"
  description=""                   // or 既存 description を空に
  packageCount={...}
/>
```

- `SkillsMasthead.tsx` 本体の props interface は変更しない
- 既存の長い日本語 description は削除（空文字 or 最小化）

### agents (`ChatContainer.tsx`)

```tsx
import { MASTHEAD_TITLES } from "@/lib/i18n/labels";

<h1>{MASTHEAD_TITLES.agents}</h1>;
```

- "The Wire Room" literal を削除
- 既存の日本語 italic 副題ブロックは削除

### 禁止事項

- masthead コンポーネントのレイアウト / スタイル / アニメーションは変更しない
- `SkillsMasthead` の props interface は変更しない
- dashboard / posts / calendar / inbox / settings / help / Sidebar は触らない（002 / 004 / 005 の責務）

### 検証

```bash
pnpm --filter @sns-agent/web typecheck
pnpm --filter @sns-agent/web build
```
