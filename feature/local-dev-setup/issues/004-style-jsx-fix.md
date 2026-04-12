---
id: 004
title: style jsx 修正を main に反映
type: fix
depends_on: []
files:
  - apps/web/src/app/(dashboard)/settings/accounts/page.tsx
  - apps/web/src/app/(dashboard)/settings/audit/page.tsx
  - apps/web/src/app/(dashboard)/settings/users/page.tsx
  - apps/web/src/components/approvals/ApprovalListItem.tsx
  - apps/web/src/components/approvals/ApprovalStamp.tsx
  - apps/web/src/components/approvals/NotificationDropdown.tsx
  - apps/web/src/components/layout/Header.tsx
  - apps/web/src/components/settings/ConfirmDialog.tsx
done_when:
  - Grep で `<style jsx>` が apps/web/src/ 内に 0 件
  - pnpm --filter @sns-agent/web build が成功する
---

## Context

Next.js 15 + React 19 で `<style jsx>` が insertBefore ランタイムエラーを起こす。既に dev ブランチで修正コミット済み (`044ef94`)。この issue は PR に含めて main に反映するためのトラッキング用。
