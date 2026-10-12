# EvolveKit

Runtime evolution foundation for existing applications. The capability model lives in framework-independent TypeScript; React is the first rendering adapter.

## Run locally

Requires Node.js 22.19+ and pnpm 11.25.0.

```sh
pnpm install
pnpm db:up
pnpm db:generate
pnpm db:migrate
pnpm build
pnpm dev:api
```

First copy `.env.example` to `.env` and set a random session-signing secret (32+ characters). Start `pnpm dev` in a second terminal and open http://localhost:5173. The development command uses built SDK packages; after changing SDK source, run `pnpm build` again. Demo source updates through Vite automatically. Docker runs only this project's PostgreSQL container; you can instead supply your own PostgreSQL connection through `DATABASE_URL`.

```sh
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
```

Dependencies are pinned; commit the generated lockfile. Toolchain compatibility references: [Vite requirements](https://vite.dev/guide/), [Zod TypeScript setup](https://zod.dev/).

## What is implemented

- Core strict registry/configuration/operation schemas and field allowlists.
- Pure filtering, stable sorting, column visibility/order, persisted number formatting, and saved-view selection.
- Deterministic date evaluation and canonical JSON serialization.
- React provider and a table renderer shared by baseline and subtree-isolated preview.
- Synthetic Customers and Orders pages with shared request, preview, approval, publication, and rollback screens. Page switching resets the editor and loads page-specific drafts and history.
- Contract, data-error, mutation-safety and preview parity/isolation tests.
- Fastify API, Prisma schema/migrations, server authorization, immutable revisions, approval, atomic publication, rollback and audit logs.
- Connected demo with signed local account sessions, persisted configuration loading, and version/activation history.
- PostgreSQL integration tests for concurrency, permissions, isolation, durability and failure recovery.
- Gemini provider adapter, a free local rules planner, durable jobs, bounded retries, and generated/refined proposals behind authoritative validation.
- Explicit additive registry upgrades preserving old versions, drafts, and approvals.
- Registered page buttons can move between header, above-table, and below-table positions and change labels while preserving app-owned actions. See [page actions](docs/page-actions.md).
- Customer follow-ups can be proposed and activated as a registered workflow, with PostgreSQL tasks, ownership rules, due dates, completion/reopening, and a My follow-ups page. Rollback preserves records. See [customer follow-ups](docs/customer-followups.md).
- Column headings can be renamed through validated proposals while retaining stable field IDs and data. See [column labels](docs/column-labels.md).

The experimental Business tools page can generate pure calculators or decision rules and a React result component with Gemini. Text, numbers, and yes/no inputs can produce values, decisions, and explanations. Choose the Discount eligibility example to try branching business logic. The source is compiled and checked in Docker before preview; exact-source approval, local activation, and rollback are persisted. A developer command exports the immutable draft to a Git branch for a pull request. See the [integration guide](docs/code-evolution-integration.md) and [sandbox prototype](docs/code-evolution-prototype.md). This is local demo activation; production deployment and automatic merging are not implemented.

The demo generates proposals, saves server-validated drafts, accepts exact-revision approval, publishes durable configurations, and restores earlier versions. It defaults to a rules-based local planner without API charges. Gemini is available through explicit server configuration; live Gemini requests for customer filtering and revenue formatting have been verified. Try “add comma in revenue amount”, “format revenue with international commas”, or “remove commas from revenue”. The same number style is used in preview and production. Local unsaved controls reset on refresh; jobs, saved proposals and active versions persist. Demo account switching simulates host identity and is not production authentication. Data and the evaluation date are fixed synthetic fixtures.

The React API accepts direct registry/configuration/rows props. The demo supplies authenticated fetching, configuration polling, and lifecycle UI. The core operations use the TDD's stable capability identifiers and JSON contracts.

## Try the milestone

1. Change the inactivity window and compare matching rows with the unchanged baseline.
2. Hide Revenue or reorder columns using the arrow controls.
3. Include the Customer follow-up saved view and select it in the preview.
4. Close and reopen preview; baseline remains untouched.
5. Hide every column to see validation reject the draft while baseline stays available.
6. Open custom operations and try an unregistered capability or field. It is rejected.

Valid custom operation array:

```json
[{"capabilityId":"customer-filter","kind":"add_filter","filter":{"id":"inactive","label":"No purchase in 90 days","fieldId":"lastPurchaseAt","operator":"older_than_days","value":90}}]
```

## Structure

| Location | Responsibility |
|---|---|
| `packages/core` | JSON contracts, validation, pure runtime model; no React/browser/ORM imports |
| `packages/react` | Provider, shared table, preview override |
| `packages/server` | Scoped lifecycle services, transactions, validation, authorization, HTTP routes |
| `packages/ai` | Untrusted planner contract, Gemini REST adapter, local development rules |
| `apps/demo-erp` | Host capability registration, synthetic customer data, demo UI |
| `apps/demo-api` | Loopback demo API and fixed local identity adapter |
| `prisma` | Database models, migrations, immutable-record and scope constraints |
| `docker` | Dedicated local PostgreSQL service with persistent volume |

See [PRD](./EvolveKit-PRD.md), [TDD](./EvolveKit-TDD.md), and [demo design notes](./docs/demo-design.md).

See the [backend milestone guide](./docs/backend-milestone.md) for setup and approval-to-rollback guarantees, and the [planner guide](./docs/planner-milestone.md) for no-cost development, Gemini setup, durable job behavior, and current limits. Next: real-model quality evaluation, a second host integration, and release hardening.
