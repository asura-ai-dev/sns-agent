---
id: 008
gh: 8
title: settings/accounts の接続ボタンとカードで PlatformIcon を統一
type: ui
depends_on: [006]
files:
  - apps/web/src/app/(dashboard)/settings/accounts/page.tsx
done_when:
  - 新規接続ボタン群で `PlatformIcon` が使用されている（Grep で `<PlatformIcon` が 2 回以上ヒット: 新規接続 + アカウントカード）
  - 各新規接続ボタンに `aria-label` でプラットフォーム名が付与されている
  - アカウントカードの platform シンボルが `PlatformIcon` で統一されている（インライン SVG 直描きではない）
  - expired 警告等の既存機能が維持されている（Grep で `expired` 関連の分岐が残る）
  - `pnpm --filter @sns-agent/web typecheck` が成功する
  - `pnpm --filter @sns-agent/web build` が成功する
---

## Context

spec F5 / AC-17。設定 / アカウント画面の新規接続ボタンおよびアカウントカードを `PlatformIcon` ベースに統一する。

## Implementation Notes

- 既に `PlatformIcon` を import している箇所を洗い出し、重複定義や独自 SVG を置き換える
- 新規接続ボタンは `solid` variant + `size=40` 程度で OAuth 開始リンクのアフォーダンスを維持
- アカウントカードのシンボルも `PlatformIcon` 化（独自 style で background を書いていれば削除）
- RBAC / 切断 / 再接続のロジックは一切触らない
- 言語ルール（F1）の適用は別 issue（004）担当のため、ここではコピーは変更しない
