# Proposal planner milestone

Natural-language requests now enter a durable PostgreSQL queue. A provider returns an untrusted candidate; only core validation and an atomic server transaction can produce a previewable immutable revision. Approval and publication remain separate user actions.

Number formatting is now a registered runtime capability: `{ capabilityId: 'customer-number-format', kind: 'set_number_format', fieldId: 'revenue', format: 'indian' | 'international' | 'plain' }`. Each column may persist an optional `numberFormat`; absence retains the existing Indian grouping. Only allowlisted displayable numeric fields can use it, including in saved-view snapshots. Preview and current tables use the same formatter, and search accepts raw or grouped amounts. Raw numbers, numeric filtering and sorting remain unchanged. Changing a format creates a hashed immutable draft and follows the usual approval, publication, and rollback sequence. Decimal precision, currency conversion, and arbitrary formatting code remain unsupported.

The demo installs `v5-customer-followups` with the exact former `v1`, `v2-number-format`, `v3-orders`, and `v4-page-actions` registries as explicitly trusted predecessors. The framework-independent `isAdditiveRegistryChange` check permits adding operations, pages, registered actions, or features while retaining every existing field, old operation, baseline, adapter, and component contract. Initialization serializes registry installation, verifies stored predecessor content, atomically switches the application registry, and records `RegistryExtended`. It preserves all existing active versions, generations, drafts, and approvals without rewriting immutable records, and initializes each new page independently. Clients accept only the five known registry hashes. Old queued jobs validate against their pinned predecessor capabilities; new requests and refinements use the current registry. Incompatible upgrades still require a separate migration.

Customer follow-ups are a registered workflow enabled through `set_feature`. Requests can preview an owner, due date, and completion workflow, then follow the same approval and publication sequence. Activated tasks are stored in PostgreSQL; rolling back the feature removes access while preserving records. Preview tasks are temporary. See [customer follow-up design and verification](customer-followups.md).

Customers and Orders share one editor and React table runtime. All page-level API calls carry the selected page ID; proposals, jobs, generations, history, and rollback remain scoped to that page. Orders supports column visibility/order, date and status filters, amount formatting, and saved views. On 12 October 2026, a live Gemini request for pending orders with international comma formatting produced three validated preview rows. It remains an unapproved draft. The customer formatting draft was separately submitted as Maya, approved and published as Arun, then rolled back to the immediately preceding version through the UI. See `docs/two-page-verification.md` for evidence and checks.

## Start without paying

The demo defaults to `EVOLVEKIT_PLANNER=local`. This is an explicit rules-based development mode, not an AI model. It requires no API key, model download, or network request. Try:

- `Hide revenue`
- `Show customers with no purchase in 90 days and hide revenue`
- `Filter last purchase older than 30 days`
- `Reorder columns revenue, customer, company, region, last purchase`
- `Add comma in revenue amount`
- `Format revenue with international commas`
- `Remove commas from revenue`

Separate supported commands with `and`, `then`, or semicolons. Unknown commands prevent partial fulfillment. Unknown/ambiguous fields and invalid day windows produce a clarification result. Local mode supports visibility, relative-date filters, full column order, and the number-format commands above. Saved views remain available through guided controls and Gemini. Refinements preserve other operations from the prior revision and replace matching filters/visibility/order/format operations against the original base. The manual options include a Revenue number style selector.

Live Gemini verification on 12 October 2026: the exact request “add comma in revenue amount” produced a validated ReadyForPreview revision with `numberFormat: 'indian'`. No approval or publication was performed on the live demo. Integration tests verify publication and rollback using an isolated schema.

Run the API and frontend using the existing setup in the backend guide. The API process includes a local worker; database leases allow multiple consumers. Both the request and its result survive an API restart. Generation history lets you reopen completed requests and reconnect to queued/running jobs.

## Enable Gemini's free tier

1. Open [Google AI Studio](https://aistudio.google.com/apikey) and create an API key for a free-tier project **without billing enabled**. Availability and quotas depend on your account/region/model.
2. Edit the existing root `.env` (do not replace its database URL or signing secret):

   ```dotenv
   EVOLVEKIT_PLANNER=gemini
   GEMINI_API_KEY=your-key-here
   GEMINI_MODEL=gemini-2.5-flash
   ```

3. Restart `pnpm dev:api`. The interface should show **Gemini**, rather than **Local rules · free**.
4. Generate a request, interact with its preview, acknowledge the exact revision, and submit. Arun can approve and publish it through the existing workflow.

Never use a `VITE_` prefix for the key. Credentials are server-only and sent to Google's fixed API endpoint in a header. The application does not enable billing, buy credits, change models on quota failure, or silently fall back to a different provider. Billing must be disabled in the Google project; the application cannot independently verify a key's billing tier. Free-tier Google content may be used to improve Google's products. Provider inputs exclude customer rows, user/tenant IDs, executable data adapters, and authentication secrets; request text and configuration values are sent.

The adapter uses Google's documented `generateContent` REST endpoint with `responseMimeType` and `responseJsonSchema`, supported by the [API reference](https://ai.google.dev/api/generate-content). The newer `responseFormat` contract did not enforce the expected output on the tested model. The provider schema omits nested length/range constraints to stay within Google's schema compiler budget; strict wire parsing and core validation still enforce all limits before a revision can be stored. Gemini 3 models use low reasoning; older models omit that model-specific setting. The default is Gemini 2.5 Flash, listed with free input/output pricing on 12 October 2026. This is configurable, not a guarantee of permanent free access. See [pricing](https://ai.google.dev/gemini-api/docs/pricing).

A live Gemini 2.5 Flash request was verified on 12 October 2026: “Hide revenue and filter last purchase older than 90 days” produced a durable, validated ReadyForPreview revision. The shared renderer displayed four customers without the revenue column; active generation 3 retained all eight customers. No approval or publication was performed. Earlier failed diagnostic jobs remain in generation history. This smoke test verifies integration, not broad real-model quality. Selecting Gemini without a key reports the planner as unavailable while active configuration reads and guided proposals remain available. Starting a New proposal clears generation idempotency keys so identical text can represent a fresh request; retries within the same intent retain their key.

## APIs and exact sequence

`POST /v1/evolution-requests` accepts `{ pageId, text, expectedGeneration }` without operations, with an idempotency key, and returns `202` with job/request/proposal IDs. The existing explicit-operation shape remains a synchronous `201` path for guided/manual proposals.

`POST /v1/proposals/:id/revisions` accepts `{ parentRevisionId, expectedLockVersion, refinement }` without operations and returns `202`. Exact parent ownership/state/lock version is checked before queuing and again at completion. A generated refinement never inherits approval.

`GET /v1/planner-jobs/:id` reads a scoped job; `GET /v1/planner-jobs?pageId=...` returns the newest 50 visible jobs. `GET /v1/planner?pageId=...` reports the configured mode. Unauthenticated calls fail, mutation origins are checked, and identity remains host-owned.

1. Authorize, lock the active pointer or parent proposal, enforce generation/lock expectations, and capture base version/generation and registry inputs.
2. Atomically persist the request/proposal placeholder/job, enqueue audit record, and idempotency response. Refinements reuse the original request/proposal.
3. A worker leases one job using `FOR UPDATE SKIP LOCKED`, increments attempts, and assigns a unique lease token. The provider call happens outside the transaction.
4. Bound generation to 60 seconds. Validate the candidate structure; distinguish runtime, unsupported, and clarification results. Transient network/quota errors retry after 5 then 10 seconds, at most three total attempts. Permanent/malformed/refused outputs do not retry.
5. Lock the proposal and job; require the still-live lease token. Recheck permission, registry compatibility, and parent state/version. Apply operations to the immutable pinned base and validate the complete configuration.
6. In one transaction, insert immutable revision content, validation record, preview-ready lifecycle, updated proposal pointer, successful job result, and audit record. Supersede the parent only after successful validation. Database write failures roll back all completion writes and leave the leased job recoverable.
7. The client fetches and hashes the validated revision and opens the same renderer used for active configurations. Approval/publication checks remain unchanged. If another change was published during generation, publication of this old-base proposal conflicts rather than rebasing it.

Job states: `Queued → Running → Succeeded / Unsupported / NeedsClarification / Failed`; transient failures return `Running → Queued`, and expired leases permit a new `Running` attempt. Three exhausted crash attempts end in `Failed`. Inputs and terminal results cannot be changed/deleted through normal database writes. Composite foreign keys bind jobs to exact scoped proposals/requests, base versions, parents, and output revisions. Stale workers cannot overwrite a newer completion.

Enqueue limits are 10 jobs per principal per minute and at most 3 unfinished jobs. Request/refinement text is limited to 4,000 characters at the HTTP boundary. Responses are limited to 256 KiB, candidate operations to 32, summaries/reasons to 1,000 characters. Telemetry records result codes and attempt counts, not provider bodies, keys, raw requests, or customer rows.

## Verification and remaining work

`pnpm test` covers core/React contracts, local parsing, strict candidate rejection, and injected Gemini REST responses including quota/auth failures, refusal, truncation, invalid JSON, response size, and abort behavior. `pnpm test:integration` covers the existing lifecycle plus durable enqueue, idempotency, worker competition, lease recovery/exhaustion, stale worker fencing, bounded timeout, permission revocation, pinned bases, refinement races, scoped job reads, immutable inputs, rate limits, HTTP `202` contracts, and audit-failure atomicity. Tests use a disposable schema on the dedicated EvolveKit database.

This milestone validates before inserting revision content, rather than persisting unvalidated Draft/Validating revisions. Generation failures remain job results and never appear as usable previews. The worker currently runs in the demo API process; a separate worker app, deployment configuration, per-job model provenance, cursor pagination, richer clarification conversations, continuous provider availability reporting, a second host, and production authentication/release hardening remain follow-up work. Curated real-model quality evaluation requires an API key and is not claimed by deterministic transport tests.
