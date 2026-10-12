# Backend milestone

Implemented: PostgreSQL persistence, an application authorization adapter, immutable revisions, exact-revision review, atomic version activation, restore history, audit events, and a connected React demo. The subsequent [planner milestone](./planner-milestone.md) adds durable generation/refinement jobs, Gemini integration, and a free local rules mode.

## Local setup

```sh
pnpm install
```

Copy `.env.example` to `.env`, choose a random session secret with at least 32 characters, and run:

```sh
pnpm db:up
pnpm db:generate
pnpm db:migrate
pnpm build
```

Start these in separate terminals:

```sh
pnpm dev:api
pnpm dev
```

The API listens on `127.0.0.1:3040`. Vite proxies `/api` to it. PostgreSQL is bound only to `127.0.0.1:54329`, with a named Docker volume. Development credentials in Compose are local fixtures, not production credentials. Prisma loads the root `.env`; the API uses Node's `--env-file` support. A git-ignored `.env` was created for this workspace with a random session-signing secret.

The Docker startup failure on this machine came from an inaccessible stale analytics socket. The old `C:\Users\dipen\AppData\Local\Docker\run` directory was preserved as `run.codex-backup-20261012` and a fresh runtime directory was created. No container images, named volumes, or WSL disks were reset.

## Try the complete flow

1. Choose Maya (requester), configure a draft, and save it.
2. Interact with the server-validated preview and acknowledge the exact revision.
3. Submit it for approval. Requester approval/publication controls remain unavailable.
4. Choose Arun (approver), review and acknowledge the revision, then approve it.
5. Publish. The active table changes only after the database transaction commits.
6. Refresh the browser or restart the API; the published configuration remains active.
7. Restore the original baseline from version history. The activation generation increases again, and both versions remain available.
8. Inspect activation history and the approver's audit log.

Use New proposal to start against the current active configuration. Editing a saved editable proposal produces a new immutable revision when saved; previous approval is not inherited. Filters combine using AND. Removing/replacing already-published filters is not a registered capability in this milestone; restore an earlier version to remove an existing filter.

## Guarantees enforced by this implementation

- The server resolves application/tenant/user identity through `AuthorizationAdapter`; browser-supplied role or tenant fields grant no permissions.
- Proposal revisions, registry snapshots, approvals, configurations, validation runs, activation events, requests, and audit records reject updates/deletes through PostgreSQL triggers.
- Lifecycle transitions and lock-version increments are also checked in PostgreSQL.
- Composite foreign keys constrain tenant/page ownership and approval configuration hashes.
- Approval/refinement lock the proposal row. Publication also locks the active pointer, checks the exact base version/generation, and verifies the immutable approval hash.
- Configuration version, active pointer, activation event, lifecycle update, idempotency result, and audit record commit together.
- Request creation, refinement, publication, and rollback support scoped idempotency keys. Retries return the original committed response; key reuse with different input fails.
- Rollback validates compatibility and increments a monotonic generation without deleting historical versions.
- Preview remains a local override of the shared renderer. The frontend validates configuration and registry hashes before accepting server responses.
- Active configuration polling runs every 15 seconds while visible and on focus. Failed reads keep the last compatible configuration in memory, or the safe baseline before first successful load.

## Deliberate limits versus the full TDD

The explicit-operation path accepts hand-authored runtime operations synchronously (`201`) and validates them before persisting a previewable revision. Natural-language requests now use durable jobs (`202`); see the planner guide. Unvalidated Draft/Validating revisions are deliberately not exposed.

The demo's signed HttpOnly, SameSite cookie selects fixed local accounts. The loopback-only account switcher is a simulation for development, not production authentication. Deployments must supply their real host identity/authorization adapter, transport policy, and production data adapters. Registry upgrades require an explicit migration; the server refuses silently changing an installed registry label or enabled contract.

History currently returns the most recent 50 configurations and activations; audit returns the most recent 100 events. Cursor pagination, retention policy, production RBAC storage, rate limiting, continuous backup/restore operations, full containerized API deployment, and a second host integration remain release work. Direct React configuration props remain the rendering interface; the demo currently owns the authenticated fetch/polling code.

The SQL migrations contain authoritative composite foreign keys and triggers beyond Prisma's scalar model declarations. Do not use `prisma db push` as a replacement for those migrations.

## Verification

```sh
pnpm test
pnpm test:integration
pnpm typecheck
pnpm build
```

Integration tests create and remove only a generated `evolvekit_test_*` schema on the dedicated local EvolveKit database. They refuse a different host/port/database. They test complete lifecycle and reconnect persistence, unauthorized actions and denial logs, unsafe operations, cross-tenant references, immutable revisions, stale locks/hashes, rejected proposals, publication conflicts, approval/refinement races, idempotency, database constraints, audit-write failure atomicity, rollback/publication races, HTTP authentication, origin checks, and forged roles.

Runtime compatibility references: [Prisma ORM 6 requirements](https://docs.prisma.io/docs/guides/upgrade-prisma-orm/v6), [Fastify 5 migration](https://fastify.dev/docs/v5.0.x/Guides/Migration-Guide-V5/), and [PostgreSQL locking](https://www.postgresql.org/docs/17/explicit-locking.html).
