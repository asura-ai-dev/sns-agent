---
id: 005
gh: null
title: Sidebar の NAV_ITEMS を NAV_LABELS ベースに差し替え、/help を出現させる
type: refactor
depends_on: [001]
files:
  - apps/web/src/components/layout/Sidebar.tsx
done_when:
  - Sidebar.tsx が `import { NAV_LABELS } from "@/lib/i18n/labels"` を含む
  - Sidebar.tsx から文字列リテラル "ダッシュボード" "投稿" "カレンダー" "受信トレイ" "使用量" "チャット" "ヘルプ" "設定" が削除されている (grep で 0 件)
  - Sidebar.tsx から文字列リテラル "Skills" の hardcoded label が削除されている (NAV_LABELS の ja = "スキル" に差し替え)
  - ハードコードされた href 文字列 "/" "/posts" "/calendar" "/inbox" "/usage" "/skills" "/agents" "/help" "/settings" のうちラベル紐付けに使う列定義部分は NAV_LABELS から供給されている
  - collapsed / expanded / drawer いずれの表示状態でも、ラベルが NAV_LABELS.ja から描画される
  - /help の項目が Sidebar に出現する (NAV_LABELS の /help entry 経由)
  - icon の対応関係 (ダッシュボード→House, 投稿→PaperPlaneTilt 等) が維持されている
  - 各リンクに NAV_LABELS.en を用いた aria-label または title が付与されている (例 `aria-label="Dashboard"`)
  - `pnpm --filter @sns-agent/web typecheck` が成功する
  - `pnpm --filter @sns-agent/web build` が成功する
---

## Context

spec.md F3。`apps/web/src/components/layout/Sidebar.tsx` の `NAV_ITEMS` 配列は日本語ラベルがハードコードされており、`ui-polish-v2` で定義した `NAV_LABELS`（en/ja 併記）を使っていない。さらに:

- 既存の NAV_ITEMS では `Skills` が英語で（他は日本語）、内部で統一が取れていない
- `/help` の Sidebar 側 entry は存在するが、`NAV_LABELS` 側に対応する entry が無かった（001 で追加済み）

本 issue で Sidebar を `NAV_LABELS` ベースに差し替える。触るファイルは 1 つだけ。

## Implementation Notes

### 基本方針

`NAV_LABELS` は `{ href, en, ja }` の配列なので、ここから label / href を取り、icon は Sidebar 側でローカルマップから供給する。

```tsx
import {
  House,
  PaperPlaneTilt,
  CalendarBlank,
  Tray,
  ChartBar,
  Package,
  ChatCircle,
  Question,
  GearSix,
} from "@phosphor-icons/react";
import { NAV_LABELS } from "@/lib/i18n/labels";

// Icon を href で解決する map（NAV_LABELS は字面のみ保持）
const NAV_ICONS: Record<string, typeof House> = {
  "/": House,
  "/posts": PaperPlaneTilt,
  "/calendar": CalendarBlank,
  "/inbox": Tray,
  "/usage": ChartBar,
  "/skills": Package,
  "/agents": ChatCircle,
  "/help": Question,
  "/settings": GearSix,
};
```

描画部:

```tsx
{
  NAV_LABELS.map((item) => {
    const Icon = NAV_ICONS[item.href];
    const active = isActive(pathname, item.href);
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={onNavigate}
        data-active={active}
        aria-label={item.en}
        title={item.en}
        className="..."
      >
        <Icon size={22} weight={active ? "fill" : "regular"} className="shrink-0" />
        <span className="...">{item.ja}</span>
      </Link>
    );
  });
}
```

- collapsed (desktop default) は既存の CSS トリック（`sidebar-collapsible-label`）で `<span>` を fade out にする動作を維持
- `aria-label` / `title` に `item.en` を与えることで、collapsed でアイコンのみになった場合もスクリーンリーダーがラベルを読める
- `/help` entry は `NAV_LABELS` から自動で出現する（001 で追加済み）

### `NAV_ICONS` 未定義の href に備える

`NAV_LABELS` に将来 href が増えても壊れないよう、`NAV_ICONS[item.href] ?? Question` のようなデフォルト icon を用意しても良い。ただし本 issue では現行の 9 href だけ対応させれば done_when を満たす。

### 既存挙動の維持

- Brand ヘッダ（"SNS Agent" のロゴ行）
- footer の "v1.0.0" 表示
- collapsible 時のラベル fade
- desktop / drawer (mobile) の両方
- `isActive` 関数
- Link の className 群

これらはすべて **現状のまま維持**。差し替えは `NAV_ITEMS` 配列の定義位置と `.map()` 内で `item.label` を `item.ja` に置き換えるだけで済む。

### 禁止事項

- デザイン（余白、hover、アクティブ状態、スタイル）は一切変更しない
- `labels.ts` に新 entry を追加しない（001 で閉じている）
- `NAV_LABELS` を Sidebar のために並べ替えない（辞書の順序を信じる）
- masthead は触らない（002 / 003 / 004 の責務）

### 検証

```bash
pnpm --filter @sns-agent/web typecheck
pnpm --filter @sns-agent/web build
```

ローカルで以下を確認:

1. Desktop collapsed Sidebar: アイコンのみ、hover で展開するとラベル（日本語）が表示される
2. Mobile drawer Sidebar: 日本語ラベル + icon が縦に並ぶ
3. `/help` 項目が表示され、クリックで `/help` に遷移する
4. 各リンクの hover / active が従来と同じ見た目
