# Generated calculators in EvolveKit

Open **Calculators** in the local demo. Maya can describe a calculator, supply independent expected results, build a preview, try inputs, inspect source, and send it for review. Arun can approve the exact source and activate it. Restore the previous calculator from the active view. The first restoration returns to an empty calculator slot; all proposals, approvals, and release records remain stored.

## Request to local activation

1. A scoped, authenticated request stores its cases, Git base commit, and current active generation. An idempotency key prevents duplicate requests.
2. The worker claims a queued proposal with a version check and a ten-minute lease. Gemini produces only `logic.ts` and `Feature.tsx`. Host validation restricts imports and APIs, TypeScript compiles source, and Docker checks independent expected results plus React rendering.
3. Successful checks store immutable source, cases, summary, and a canonical SHA-256 fingerprint. Failures stay visible. Interrupted jobs expire to Failed; create a new request to retry.
4. Preview inputs are evaluated inside the same restricted Docker runner used for the active calculator. The host displays numeric results and the generated React HTML in an inert sandboxed iframe. Generated code never runs in the API or browser process.
5. Submission and approval require the exact fingerprint and proposal version. A requester cannot approve their own proposal. Activation requires approval, the unchanged Git base commit, and the captured active generation. Concurrent activations have one winner.
6. Activation advances the scoped pointer and appends a release and audit record in one transaction. Rollback also checks the generation, advances the pointer, and appends history.

## Contracts and storage

The API in `apps/demo-api/src/code.ts` exposes `GET/POST /v1/code-proposals`, proposal `submit`, `approve`, and `activate` actions, `POST /v1/code-evaluate`, and `POST /v1/code-rollback`. Input records contain 1–20 finite numeric values; proposals need 3–30 independent cases. Evaluation input keys must match the case contract. Authorization and application/tenant scope come from the signed server session.

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

The integration suite covers request replay, permissions, source immutability, exact approval, tenant isolation, concurrent activation, stale base/generation rejection, durable reads, and rollback. Unit checks cover source restrictions and sandbox configuration. Production authentication, shared job infrastructure, deployment gates, and security review remain necessary before exposing this outside the loopback demo. Numeric calculators are the current generated feature contract; arbitrary pages, database-changing code, and external integrations are outside it.
