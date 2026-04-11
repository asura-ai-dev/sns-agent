---
id: 013
title: /help ページに CLI リファレンスセクションを追加
type: feat
depends_on: [012]
files:
  - apps/web/src/app/(dashboard)/help/page.tsx
done_when:
  - `help/page.tsx` 内に CLI リファレンスセクションが存在する（Grep で `accounts`, `post`, `schedule`, `inbox`, `usage`, `llm`, `skills` の 7 コマンド名がすべてヒット）
  - 各コマンドに対して代表的な使用例（`sns <command> ...`）が 1 つ以上記載されている
  - コード例は `<pre>` もしくは `<code>` 要素で描画されている
  - ページが既存の editorial トーンを保っている
  - `pnpm --filter @sns-agent/web typecheck` が成功する
  - `pnpm --filter @sns-agent/web build` が成功する
---

## Context

spec F4 / AC-14。012 で作成したヘルプページに、`packages/cli` のコマンド体系（accounts / post / schedule / inbox / usage / llm / skills）リファレンスを追加する。

## Implementation Notes

- `packages/cli/src/commands/*.ts` のコマンド定義を参考に、各コマンドの典型的なユースケース 1-2 例を抜粋
- 例（参考）:
  - `sns accounts list` / `sns accounts connect --platform x`
  - `sns post create --platform x --body "..."`
  - `sns schedule list`
  - `sns inbox list --platform line`
  - `sns usage show`
  - `sns llm routes list`
  - `sns skills list`
- コマンド一覧は 7 項目すべてをカバー（抜け漏れなし）
- 見出しは英語 kicker（例: "CLI Reference"）+ 日本語説明
- コード例は `<pre className="font-mono ...">` で等幅表示
- 実際の引数スペックを完全網羅する必要はなく、代表例で十分
- 012 で空のプレースホルダがあれば置き換え、なければ最下部に追加
