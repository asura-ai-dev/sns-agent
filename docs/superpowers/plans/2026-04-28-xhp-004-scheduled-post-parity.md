# XHP-004 Scheduled Post Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add scheduled X post parity for XHP-003 variants, explicit persisted failure classification, and idempotent cancellation.

**Architecture:** Keep the scheduler generic and prove it delegates the full post payload to `publishPost`. Store compact classification markers in `ScheduledJob.lastError` because the scheduled job record is the durable scheduler state, while audit logs remain the richer operational history.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, existing core schedule and post usecases.

---

### Task 1: Spec And Plan

**Files:**

- Create: `docs/superpowers/specs/2026-04-28-xhp-004-scheduled-post-parity.md`
- Create: `docs/superpowers/plans/2026-04-28-xhp-004-scheduled-post-parity.md`

- [x] Write the scoped spec and plan.
- [x] Commit the spec and plan.

### Task 2: Scheduler Variant Contract

**Files:**

- Modify: `packages/core/src/usecases/__tests__/schedule.test.ts`

- [x] Write tests that schedule X posts with text-only, media, thread, quote, and combined media/thread/quote payloads, execute each job, and assert provider `publishPost` receives the expected `contentText`, `contentMedia`, and `providerMetadata`.
- [x] Run the targeted core schedule test and confirm the existing implementation already satisfies this contract.
- [x] Implement only the minimum test harness support needed to inspect provider calls.
- [x] Run the targeted core schedule test and confirm it passes.
- [x] Commit the scheduler variant test contract.

### Task 3: Persist Failure Classification

**Files:**

- Modify: `packages/core/src/usecases/schedule.ts`
- Modify: `packages/core/src/usecases/__tests__/schedule.test.ts`

- [x] Write failing tests for retryable and terminal scheduled X failures that assert `lastError` stores a classification marker.
- [x] Run the targeted core schedule test and confirm failure.
- [x] Add a compact classification formatter in `schedule.ts` and use it for retrying and failed jobs.
- [x] Run the targeted core schedule test and confirm it passes.
- [x] Commit the failure classification change.

### Task 4: Idempotent Cancellation

**Files:**

- Modify: `packages/core/src/usecases/schedule.ts`
- Modify: `packages/core/src/usecases/__tests__/schedule.test.ts`

- [x] Write a failing test that cancels the same schedule twice and expects the second call to return the already canceled job.
- [x] Run the targeted core schedule test and confirm failure.
- [x] Make `cancelSchedule` return an already `failed` job with `lastError=canceled_by_user` without rewriting it.
- [x] Run the targeted core schedule test and confirm it passes.
- [x] Commit the cancellation change.

### Task 5: Verification

**Files:**

- Modify if needed: `docs/x-harness-parity-tickets.json`

- [x] Run `pnpm --filter @sns-agent/core test`.
- [x] Run `pnpm --filter @sns-agent/api test`.
- [x] Run `pnpm --filter @sns-agent/cli test`.
- [x] If all pass, mark XHP-004 verified in `docs/x-harness-parity-tickets.json`.
- [x] Commit verification metadata if changed.
