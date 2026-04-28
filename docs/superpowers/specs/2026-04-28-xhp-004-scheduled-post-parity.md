# XHP-004 Scheduled Post Parity Spec

## Goal

Implement XHP-004 within the existing generic scheduler: scheduled X posts must publish the same text, media, thread, and quote variants added by XHP-003; failures must persist a clear retryable or terminal state; cancellation must be idempotent.

## Scope

- Keep scheduled publishing routed through `packages/core/src/usecases/schedule.ts` and `publishPost`.
- Add focused core tests that prove scheduled X posts pass XHP-003 `contentMedia` and `providerMetadata.x` variants to the provider.
- Persist retryable versus terminal failure state in the scheduled job record itself, while preserving the existing audit execution log detail.
- Make repeated cancellation of an already canceled schedule return the same canceled state without changing post status again.
- Do not refactor provider, API, CLI, SDK, or UI code unless tests show a ticket-scoped gap.

## Acceptance Criteria

- A scheduler test covers scheduled X text, media, thread, quote, and combined variants.
- Retryable failures produce `status=retrying`, `lastError` with a retryable marker, and `nextRetryAt`.
- Terminal failures produce `status=failed`, `lastError` with a terminal marker, and no `nextRetryAt`.
- Repeated cancellation of the same canceled schedule returns `status=failed` and `lastError=canceled_by_user` without throwing.
- Existing XHP-003 immediate publishing behavior remains untouched.

## Validation Plan

- Run the targeted core schedule test while red before implementation.
- Run `pnpm --filter @sns-agent/core test` after implementation.
- Run XHP-004 listed checks where available: `pnpm --filter @sns-agent/api test` and `pnpm --filter @sns-agent/cli test`.
- Browser UI verification is not required unless API/CLI changes force a user-visible schedule flow change.
