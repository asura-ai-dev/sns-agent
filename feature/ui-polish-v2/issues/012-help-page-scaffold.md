---
id: 012
title: /help ページを作成し Web UI 主要機能セクションを追加
type: feat
depends_on: [001, 005]
files:
  - apps/web/src/app/(dashboard)/help/page.tsx
  - apps/web/src/components/layout/Sidebar.tsx
done_when:
  - `apps/web/src/app/(dashboard)/help/page.tsx` が存在し、default export が React コンポーネント
  - ページ内に dashboard / posts / compose / schedule / inbox / settings の少なくとも 6 機能の説明セクションが存在する（Grep で 6 機能名のうち 6 件すべてがヒット）
  - ページの見出しは Fraunces / section kicker は英語（F1 言語ルール準拠）
  - `Sidebar.tsx` の `NAV_ITEMS` または副次ナビに `/help` へのリンクが追加されている
  - `pnpm --filter @sns-agent/web typecheck` が成功する
  - `pnpm --filter @sns-agent/web build` が成功する
  - dev server 起動後 `/help` にアクセスして 200 で返る（ビルド成功をもって担保）
---

## Context

spec F4 / AC-12, AC-13, AC-15。ヘルプページの雛形と Web UI 機能説明セクションを追加する。CLI リファレンスは 013 で別途対応。

## Implementation Notes

- ルートは `/help`（`(dashboard)/help/page.tsx`）とし、既存のダッシュボードレイアウト（Sidebar + Header）を流用
- editorial トーン（Fraunces 見出し + DM Sans 本文、paper ベース、hairline）を踏襲
- セクション構成例:
  - `Dashboard` — KPI とプラットフォーム概況の読み方
  - `Posts` — 一覧 / 絞り込み / 新規作成
  - `Compose` — 投稿エディタの使い方
  - `Schedule / Calendar` — 予約投稿
  - `Inbox` — DM / リプライ / コメント返信
  - `Settings` — アカウント接続 / ユーザー管理
- 各セクションは short kicker（英語）+ 日本語本文 3-5 行程度
- Sidebar の NAV_ITEMS に `/help` を追加（ラベルは `Help`、日本語併記はルール通り）
- CLI リファレンスは空のセクション（plaything）を置いておくか省略（013 が追加する）
- 外部リンクは不要、純粋な社内ドキュメントとして描画
