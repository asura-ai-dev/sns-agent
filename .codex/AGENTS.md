# Codex Project Guide

## Current Focus

The active workstream is X Harness OSS parity for `sns-agent`.

Use these files first:

- Human-readable plan: [`docs/x-harness-parity.md`](../docs/x-harness-parity.md)
- Machine-readable tickets: [`docs/x-harness-parity-tickets.json`](../docs/x-harness-parity-tickets.json)
- Docs index: [`docs/README.md`](../docs/README.md)

## Source Of Truth

- For current implementation scope, dependencies, ticket status, candidate paths, and verification commands, read `docs/x-harness-parity-tickets.json`.
- For background and intent, read `docs/x-harness-parity.md`.
- `docs/requirements.md` and `docs/architecture.md` are background references only.
- Do not recreate old task-management trees such as `tasks/`, `agent-output/`, or `feature/*/issues`.

## Work Rules

- Work from the `dev` branch or another non-`main` branch.
- Prefer one `ready` XHP ticket at a time.
- Preserve the generic SNS architecture; add X-specific behavior through provider, usecase, route, SDK, CLI, and UI extension points.
- Keep ticket verification separate from phase evaluation.
- When UI work has `ui_review: required`, capture reviewer evidence separately from verification/evaluation artifacts.

## Reference Repository

- X Harness OSS: https://github.com/Shudesu/x-harness-oss
- X Harness spec: https://raw.githubusercontent.com/Shudesu/x-harness-oss/main/docs/SPEC.md
