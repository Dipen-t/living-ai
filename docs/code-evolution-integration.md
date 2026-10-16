# Generated business tools in EvolveKit

Open **Business tools** in the local demo. Maya can describe a calculator or decision tool, supply independent expected results, build a preview, try inputs, inspect source, and send it for review. Arun can approve the exact source and activate it. Restore the previous tool from the active view. The first restoration returns to an empty tool slot; all proposals, approvals, and release records remain stored.

Choose **Discount eligibility · free built-in example** to try a fixed, host-authored decision tool without an AI call. It accepts a customer tier, order amount, and overdue-payment flag and returns a decision, discount percentage, and explanation. Overdue payment blocks the discount; otherwise a gold customer with an order of at least 10,000 gets ten percent. Cases cover priority, the threshold, other tiers, and case/space normalization. Only the exact bundled request and cases use this free source; custom or changed rules use Gemini. The example still passes compilation, Docker checks, source review, approval, and rollback. It does not change orders.

Gemini HTTP 429 responses show a usage-limit message with the free example as an alternative. Retrying a failed draft creates a new request key; duplicate clicks while a request is pending retain idempotency. A live synthetic custom decision request returned HTTP 429 during verification, so provider availability remains a separate limitation from the implemented typed execution path.

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

## Workspace data inputs

Expand **Use values from your workspace** when creating a draft. Choose Orders or Customers, then select a compatible registered field for each input to read. For the free discount example, map **Order amount** to the Orders **Order amount** field and leave tier and overdue status manual; those values are not part of the Orders data contract. Build a new preview, select a workspace order, and run the tool. The result shows the exact values read for that run.

The mapping is immutable from request creation and included in the source approval fingerprint. Mapping changes require a new proposal and approval. Old unbound proposal hashes remain unchanged. The mapping contains a pinned data-source contract version, source ID, and input-to-field pairs. The framework-independent resolver reads only those fields and rejects browser overrides, mismatched value types, missing fields, extra inputs, unknown fields, and stale contracts. Preview and active execution use the same resolver and source adapter. Data permission is checked again on every read and activation.

The loopback host registers read-only synthetic Orders and Customers adapters for demo-org and requires `code:data`. Record listing returns IDs and display labels; evaluation reads mapped fields from the selected server-side record. Only approved mapped values and remaining manual inputs enter the local Docker runner. Workspace rows are never sent to Gemini. The current adapters use the server fixtures shared with the demo tables; browser-only customer additions are not included. A production host must provide its own tenant-scoped adapter and authentication.

The additive `202610140007_tool_bindings` migration adds a nullable binding to CodeProposal and a database trigger preventing later edits. Git export includes `binding.json` alongside source and independent cases. Rollback preserves the original mapping. Data-source contract changes make evaluation fail until a new compatible proposal is checked.

### Verification status for workspace bindings

Unit checks cover field projection, type compatibility, forged-value rejection, permission and tenant isolation, and legacy review hashes. The PostgreSQL integration test covers immutable mappings and equal effective inputs across preview, activation, and rollback. Applying the migration and running that integration check require the dedicated database and Docker engine to be available.

## Use an approved tool from Orders

After activating a tool whose approved binding reads Orders, each visible order has a **Use tool** action. The fixed discount starter uses **Check discount**. Selecting it opens an inline panel with that order already selected; only unmapped inputs are editable. The panel shows the exact workspace values read for the run and shares the result renderer with Business tools. Running the tool never changes the order.

The action is available only for the current active Published tool and requires code:read and code:data. Drafts and tools bound to Customers do not add Orders actions. A lightweight `GET /v1/code-tools/active?sourceId=orders` lookup follows the active pointer directly, so it does not depend on whether that proposal is among the latest 30 drafts and does not send generated source files on each poll. Activation, rollback, account changes, or loss of access close the old panel and clear its results.

Inline runs send `proposalId: null`, the selected `recordId`, manual `input`, and `expectedActive: { proposalId, generation }`. The server rejects a stale panel before evaluation and rechecks the active pointer after execution. A changed generation produces HTTP 409 rather than a result from an obsolete active version. The optional guard preserves compatibility with existing preview clients. Host table row actions are an optional React adapter prop; the evolution and binding contracts remain independent of React.

Transport tests with isolated in-memory dependencies cover the metadata response, hidden actions after rollback, stale panels, effective workspace values, and an activation change during execution. The table test checks that row actions follow visible rows. These tests do not replace the pending PostgreSQL and live Docker verification.

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
