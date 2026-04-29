# XHP-021 Cloudflare D1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional Cloudflare Worker/D1 deployment path without changing the existing local Node/SQLite development flow.

**Architecture:** Keep `apps/api` as the Node Hono API backed by `better-sqlite3`. Add a separate `apps/worker` Cloudflare adapter app with a D1 binding contract and document how to produce a D1 schema bundle from the existing Drizzle SQLite migrations.

**Tech Stack:** TypeScript, Hono, Vitest, pnpm workspace, Cloudflare Workers/D1, Drizzle SQLite migrations.

---

### Task 1: D1 Migration Bundle Contract

**Files:**
- Create: `packages/db/src/d1-migrations.ts`
- Create: `packages/db/src/__tests__/d1-migrations.test.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Write failing tests** for ordering SQL migration files, ignoring Drizzle metadata, and annotating the D1 bundle with source filenames.
- [ ] **Step 2: Run** `pnpm --filter @sns-agent/db test -- src/__tests__/d1-migrations.test.ts` and confirm the helper is missing.
- [ ] **Step 3: Implement minimal helper** that accepts `{ filename, sql }[]` and returns a deterministic combined SQL string.
- [ ] **Step 4: Export the helper** from `packages/db/src/index.ts`.
- [ ] **Step 5: Run the package test** and keep it green.

### Task 2: Worker Adapter Contract

**Files:**
- Create: `apps/worker/package.json`
- Create: `apps/worker/tsconfig.json`
- Create: `apps/worker/vitest.config.ts`
- Create: `apps/worker/wrangler.toml`
- Create: `apps/worker/src/index.ts`
- Create: `apps/worker/src/__tests__/worker.test.ts`

- [ ] **Step 1: Write failing Worker tests** for `/api/health`, `/api/d1/schema-version`, and 503 behavior when the D1 binding is missing.
- [ ] **Step 2: Run** `pnpm --filter @sns-agent/worker test` and confirm the Worker package is missing.
- [ ] **Step 3: Add the minimal Worker Hono app** with a typed `DB` binding and no import from `@sns-agent/db` or `apps/api`.
- [ ] **Step 4: Add `wrangler.toml`** documenting the D1 binding name and migration directory.
- [ ] **Step 5: Run the Worker tests and build**.

### Task 3: Cloudflare Deployment Docs

**Files:**
- Create: `.dev.vars.example`
- Create: `apps/worker/migrations/0001_init.sql`
- Modify: `docs/development.md`
- Modify: `docs/x-harness-parity.md`

- [ ] **Step 1: Add docs** explaining the separate Worker adapter, D1 schema bundle source, deploy commands, and the unchanged local Node/SQLite flow.
- [ ] **Step 2: Add `.dev.vars.example`** with non-secret Worker local values.
- [ ] **Step 3: Add a generated/documented D1 migration bundle** sourced from existing Drizzle migrations.
- [ ] **Step 4: Run `pnpm build` and `pnpm test`** as XHP-021 verification.
- [ ] **Step 5: Update XHP-021 status if verification passes, commit, and push `dev` without creating a PR.
