# Generated business tools in EvolveKit

Open **Business tools** in the local demo. Maya can describe a calculator or decision tool, supply independent expected results, build a preview, try inputs, inspect source, and send it for review. Arun can approve the exact source and activate it. Restore the previous tool from the active view. The first restoration returns to an empty tool slot; all proposals, approvals, and release records remain stored.

Choose **Discount eligibility** as the starter example. It accepts a customer tier, order amount, and overdue-payment flag and generates a decision, discount percentage, and explanation. Overdue payment blocks the discount; otherwise a gold customer with an order of at least 10,000 gets ten percent. Cases cover priority, the threshold, other tiers, and case/space normalization. These are generated preview rules, not order mutations.

## Request to local activation

1. A scoped, authenticated request stores its cases, Git base commit, and current active generation. An idempotency key prevents duplicate requests.
2. The worker claims a queued proposal with a version check and a ten-minute lease. Gemini produces only `logic.ts` and `Feature.tsx`. Host validation restricts imports and APIs, TypeScript compiles source, and Docker checks independent expected results plus React rendering.
3. Successful checks store immutable source, cases, summary, and a canonical SHA-256 fingerprint. Failures stay visible. Interrupted jobs expire to Failed; create a new request to retry.
4. Preview inputs are evaluated inside the same restricted Docker runner used for the active calculator. The host displays numeric results and the generated React HTML in an inert sandboxed iframe. Generated code never runs in the API or browser process.
5. Submission and approval require the exact fingerprint and proposal version. A requester cannot approve their own proposal. Activation requires approval, the unchanged Git base commit, and the captured active generation. Concurrent activations have one winner.
6. Activation advances the scoped pointer and appends a release and audit record in one transaction. Rollback also checks the generation, advances the pointer, and appends history.

## Contracts and storage

The API in `apps/demo-api/src/code.ts` exposes `GET/POST /v1/code-proposals`, proposal `submit`, `approve`, and `activate` actions, `POST /v1/code-evaluate`, and `POST /v1/code-rollback`. The framework-independent contract in `packages/core/src/generated-tools.ts` allows 1–20 named values: finite numbers bounded to ±1e12, text up to 500 characters, or booleans. Proposals need 3–30 cases with consistent input and output fields and types. Runtime inputs and outputs must match that exact contract; values are not coerced. Arrays, nested objects, null, reserved prototype fields, and extra fields are rejected. Old numeric-only drafts remain compatible. Authorization and scope come from the signed server session.

States are Queued → Generating → Ready → PendingApproval → Approved → Published, with generation errors entering Failed. `CodeProposal`, `CodeApproval`, `CodeActive`, and `CodeRelease` persist the lifecycle. Database constraints protect scope, immutable generated source, approvals, and release history. The existing framework-independent Capability Registry remains separate from this experimental generated-code path.

## Developer source review

Commit the host implementation before generating a draft, so its base commit remains current. Export only checked source:

```sh
pnpm code:draft export <proposal-id>
pnpm code:draft link <proposal-id> https://github.com/Dipen-t/living-ai/pull/<number>
```

Export uses a separate Git index, writes the exact stored files, cases, and review metadata under `generated-features/<proposal-id>/`, creates `codex/feature-<proposal-id>`, and pushes to the authorized `Dipen-t/living-ai` repository. Create a draft pull request against the proposal's host branch, then link its URL. Retry reuses an identical existing export branch and refuses to overwrite different source. Credentials stay in the developer environment. Pull request creation, merging, and production deployment are not performed by the application.

## Setup, verification, and limits

Run database generation/migrations, build SDK packages, and start the API and frontend as described in README. Gemini requires the existing server-side environment configuration. Calculator generation and evaluation need the Docker engine and the official Node sandbox image; ordinary registry changes only need PostgreSQL. Sandbox containers have no network, host mounts, API keys, or Docker socket, and enforce memory, CPU, process, filesystem, and execution limits.

The integration suite covers request replay, permissions, source immutability, exact approval, tenant isolation, concurrent activation, stale base/generation rejection, durable reads, rollback, and typed decision preview/activation parity. Unit checks cover source restrictions, typed contracts, and sandbox configuration. Production authentication, shared job infrastructure, deployment gates, and security review remain necessary before exposing this outside the loopback demo. Pure calculations and business decisions are the generated feature contract; arbitrary pages, database-changing code, and external integrations are outside it. Decisions currently use manually entered inputs and do not automatically apply discounts to orders.
