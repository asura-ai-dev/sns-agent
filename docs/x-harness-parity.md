# X Harness Parity Plan

## Purpose

`sns-agent` の X 機能を `Shudesu/x-harness-oss` と同等以上に近づけるための実装計画です。
この文書は人間向けの読み物で、Codex やサブエージェントが実行単位として読む正規のチケット台帳は `docs/x-harness-parity-tickets.json` です。

## Source Baseline

- Reference repository: https://github.com/Shudesu/x-harness-oss
- Reference docs: `README.md`, `docs/SPEC.md`, `packages/db/schema.sql`
- Local baseline checked on: 2026-04-28
- Local branch: `dev`

## Current Local State

`sns-agent` は SNS 横断の基盤として以下をすでに持っています。

- Hono API server under `apps/api`
- Next.js dashboard under `apps/web`
- SQLite/Drizzle data layer under `packages/db`
- Generic domain/usecase layer under `packages/core`
- CLI, SDK, skills, LLM routing packages
- X OAuth 2.0 PKCE, post validation, publish, delete in `packages/provider-x`
- Generic posts, schedules, inbox, usage, budget, approvals, audit, users, accounts UI/API

X Harness OSS と比べて、X 固有の CRM / marketing automation はまだ不足しています。

## XHP-001 Credential Contract

X account credentials stay in the shared `social_accounts.credentials_encrypted` field. The
encrypted plaintext is a versioned JSON object with an explicit `credentialType`, so downstream X
features can tell which operations are available without guessing field names.

OAuth 2.0 PKCE credentials are used for the existing account connect, posting, inbox, and refresh
flow:

```json
{
  "version": 1,
  "credentialType": "x-oauth2",
  "accessToken": "x-access-token",
  "refreshToken": "x-refresh-token-or-null",
  "expiresAt": "2026-04-28T12:00:00.000Z",
  "tokenType": "bearer",
  "scope": "tweet.read tweet.write users.read offline.access",
  "xUserId": "1234567890"
}
```

OAuth 1.0a credentials are reserved for X-only operations that require request signing, such as
media upload handoff, DM send/read, follow, like, repost, and full-archive search:

```json
{
  "version": 1,
  "credentialType": "x-oauth1a",
  "accessToken": "oauth1-access-token",
  "accessTokenSecret": "oauth1-access-token-secret",
  "consumerKey": "optional-consumer-key",
  "consumerSecret": "optional-consumer-secret",
  "xUserId": "1234567890",
  "screenName": "alice"
}
```

`packages/provider-x/src/credentials.ts` owns parsing, serialization, legacy OAuth2 credential
compatibility, and the explicit OAuth 1.0a operation gate. Provider modules should consume these
helpers instead of reading raw credential JSON directly.

## Parity Capability Matrix

| Capability | X Harness OSS | Local State | Ticket |
| --- | --- | --- | --- |
| X account management | `x-accounts` routes and credentials | Generic social accounts, X OAuth present | XHP-001 |
| X API wrapper | typed X API v2 wrapper | minimal HTTP client | XHP-002 |
| Posts | create, media, quote, delete, history | generic create/publish/delete; media upload and quote incomplete | XHP-003 |
| Thread posting | supported by MCP/API | provider declares unsupported | XHP-003 |
| Scheduled posts | cron and DB | generic scheduler exists | XHP-004 |
| Engagement gates | core feature | missing | XHP-005 |
| Gate verify API | LINE Harness integration | missing | XHP-006 |
| Campaign wizard | post -> conditions -> LINE -> preview | missing | XHP-007 |
| Reply management | mentions/replies, like/repost/reply actions | generic inbox only, X provider lacks inbox methods | XHP-008 |
| DM management | conversations and send/receive | generic inbox route exists, X provider lacks DM implementation | XHP-009 |
| Quote tweets | detection and DB persistence | missing | XHP-010 |
| Followers | sync, profile, segments | missing | XHP-011 |
| Tags | follower tags | missing | XHP-012 |
| Follower tracking | daily snapshots and charts | missing | XHP-013 |
| Step sequences | step delivery | missing | XHP-014 |
| Usage analytics | endpoint/gate cost views | generic usage exists, gate-specific missing | XHP-015 |
| Staff/API keys | owner/admin/editor/viewer | generic users/agent identities exist | XHP-016 |
| MCP server | 30 tools | skills exist, MCP package missing | XHP-017 |
| TypeScript SDK | full feature SDK | generic SDK, X-specific resources missing | XHP-018 |
| Dashboard | X-specific admin pages | generic dashboard only | XHP-019 |
| Stealth controls | jitter/rate/template variation | missing | XHP-020 |
| Cloudflare deploy | Worker/D1/Wrangler | Node API/SQLite local-first | XHP-021 |

## Implementation Phases

### Phase 0: Contract And Data Foundation

Goal: add durable domain contracts, schema, repositories, and typed X client surfaces before behavior.

Tickets:

- XHP-001: X account model alignment
- XHP-002: typed X API client
- XHP-011: followers
- XHP-012: tags
- XHP-013: follower snapshots
- XHP-015: X usage dimensions

### Phase 1: Post And Scheduler Parity

Goal: make X posting operations match the reference before automation depends on them.

Tickets:

- XHP-003: X post/media/thread/quote publishing
- XHP-004: schedule parity and scheduler hardening

### Phase 2: Engagement Gate MVP

Goal: implement the X Harness killer feature with a low-cost reply-trigger path.

Tickets:

- XHP-005: engagement gate domain and API
- XHP-006: verify API and delivery tokens
- XHP-020: stealth controls

### Phase 3: CRM And Inbox

Goal: make operators able to handle X conversations and relationship state.

Tickets:

- XHP-008: reply management
- XHP-009: DM management
- XHP-010: quote tweet persistence
- XHP-014: step sequences

### Phase 4: Campaigns, UI, SDK, MCP

Goal: expose the feature set through all user and agent entry points.

Tickets:

- XHP-007: campaign wizard
- XHP-017: MCP server
- XHP-018: SDK X resources
- XHP-019: dashboard parity

### Phase 5: Deployment And Hardening

Goal: support the operational shape of X Harness OSS without weakening the existing local app.

Tickets:

- XHP-016: staff/API key parity review
- XHP-021: Cloudflare Worker/D1 deployment option

## Role Contract

- `planner`: owns this parity plan, ticket order, dependency updates, and scope decisions.
- `implementer`: owns one active XHP ticket at a time and changes only the ticket's declared paths.
- `verifier`: owns ticket-level verification artifacts and pass/fail judgment.
- `evaluator`: owns phase-level integration evaluation after a coherent batch lands.
- `reviewer`: owns UI review only when a ticket declares `ui_review: required`.

## Execution Rules For Codex

- Use `docs/x-harness-parity-tickets.json` as the machine-readable ticket source.
- Work one `ready` ticket at a time unless the user explicitly asks for parallel agents.
- Keep provider-specific X work under `packages/provider-x` unless a ticket explicitly expands scope.
- Preserve generic SNS abstractions; do not hard-code X behavior into shared layers without an extension point.
- Do not reintroduce old `tasks/`, `agent-output/`, or `feature/*/issues` task management files.
- Ticket verification is not phase evaluation. Run ticket checks first, then evaluate a phase.

## First Recommended Ticket

Start with XHP-001 or XHP-002.

XHP-001 is safest when the next session wants schema/domain clarity first. XHP-002 is safest when the next session wants to quickly unblock all X API behavior behind a typed client.
