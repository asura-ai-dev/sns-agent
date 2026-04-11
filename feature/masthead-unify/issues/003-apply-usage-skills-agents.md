---
id: 003
gh: null
title: usage / skills / agents の masthead を MASTHEAD_TITLES 駆動に差し替え
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
  - UsageMasthead.tsx から文字列リテラル "Treasury Bulletin" が削除されている
  - UsageMasthead.tsx から文字列リテラル "API 利用量、LLM トークン、推定コストの推移を確認できます" が削除されている
  - skills/page.tsx から `title="Capabilities Gazette"` のハードコード prop が削除されている (MASTHEAD_TITLES.skills 経由に置き換え)
  - ChatContainer.tsx から文字列リテラル "The Wire Room" が削除されている
  - ChatContainer.tsx から文字列リテラル "SNS Agent と対話しながら依頼内容を整理・実行できます" が削除されている
  - 対象 3 ページすべての masthead が「英語 kicker → 日本語 h1 → 任意の subheading / tagline」の構造を持つ
  - usage / skills / agents の masthead で h1 の日本語表示は MASTHEAD_TITLES.*.ja を参照している
  - `pnpm --filter @sns-agent/web typecheck` が成功する
  - `pnpm --filter @sns-agent/web build` が成功する
---

## Context

spec.md F2 の 2 つ目。usage / skills / agents は masthead が専用コンポーネントに切られているか、page.tsx から props で文言を渡す形になっており、いずれも辞書を経由していない。本 issue で辞書経由に置き換える。

## Implementation Notes

### usage (`UsageMasthead.tsx` + `usage/page.tsx`)

現状: `UsageMasthead.tsx` の h1 が `"Treasury Bulletin"` ハードコード、副題 italic も日本語ハードコード。
目標:

- `UsageMasthead.tsx` を「masthead の描画責務のみ」に保ち、文言は props または直接 import で辞書から取得
- 推奨: `UsageMasthead.tsx` 内で `import { MASTHEAD_TITLES, SECTION_KICKERS } from "@/lib/i18n/labels"` して、以下を描画
  - kicker: `SECTION_KICKERS[MASTHEAD_TITLES.usage.kickerKey]`（= "Usage Ledger"）
  - h1: `MASTHEAD_TITLES.usage.ja` = "使用量"
  - italic 副題: `MASTHEAD_TITLES.usage.tagline`
- 既存の meta 行（`SECTION_KICKERS.usage` と "api & llm spend" を繋いでいる行）は `SECTION_KICKERS.usage` 参照のまま残して良い

`usage/page.tsx` 側は引数変更がなければ触らなくて良い（import 追加のみ）。

### skills (`skills/page.tsx` + `SkillsMasthead.tsx`)

現状: `page.tsx` が `<SkillsMasthead eyebrow={SECTION_KICKERS.skills} title="Capabilities Gazette" description="..." ... />` を呼ぶ。
目標:

- `page.tsx` で `eyebrow`, `title`, `description` を `MASTHEAD_TITLES.skills` から生成して渡す
  ```tsx
  import { SECTION_KICKERS, MASTHEAD_TITLES } from "@/lib/i18n/labels";
  const m = MASTHEAD_TITLES.skills;
  <SkillsMasthead
    eyebrow={SECTION_KICKERS[m.kickerKey]}
    title={m.ja}
    description={m.tagline}
    packageCount={...}
  />
  ```
- `SkillsMasthead.tsx` の interface は変更しない（props 名を維持）。内部のレンダリングも変更しない。本質は呼び出し側の文言差し替えのみ
- 英語 subheading（`m.en` = "Capabilities Gazette"）を表示したい場合は `SkillsMasthead` の既存スロットに収まるように 1 行だけ追加して良いが、既存 UI を破壊しないこと。最小変更は呼び出し側のみで十分

### agents (`ChatContainer.tsx`)

現状: ChatContainer.tsx 内 283-297 行付近で h1 が "The Wire Room" ハードコード、italic 副題も日本語ハードコード。
目標:

- `ChatContainer.tsx` に `import { MASTHEAD_TITLES, SECTION_KICKERS } from "@/lib/i18n/labels"` を追加
- 現状 279 行付近の `SECTION_KICKERS.agents` 参照はそのまま維持
- h1 を `MASTHEAD_TITLES.agents.ja` = "チャット" に置換
- italic 副題を `MASTHEAD_TITLES.agents.tagline` に置換

注意: ChatContainer はクライアントコンポーネントであり masthead 以外の責務も多い。本 issue では masthead 周辺以外の改変は行わない。

### 禁止事項

- 各 masthead コンポーネントのレイアウト / スタイル / アニメーションは変更しない
- `SkillsMasthead` の props interface は変更しない（破壊変更を避ける）
- dashboard / posts / calendar / inbox / settings / help / Sidebar は触らない（002 / 004 / 005 の責務）
- `MASTHEAD_TITLES` に entry を足さない（001 で閉じている）

### 検証

```bash
pnpm --filter @sns-agent/web typecheck
pnpm --filter @sns-agent/web build
```

ローカルで `/usage`, `/skills`, `/agents` の masthead を目視確認し、視覚上のレイアウトが変わっていないこと、h1 が日本語になっていることを確認する。
