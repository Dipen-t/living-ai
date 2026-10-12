# EvolveKit — Technical Design Document

**Version:** 1.0  
**Status:** Proposed implementation design  
**Target:** SDK v0.1  
**Source requirements:** [EvolveKit PRD](./EvolveKit-PRD.md)  
**Scope:** Framework-independent runtime evolution with a React adapter, a Node.js/Fastify backend, and PostgreSQL persistence.

This document defines the initial implementation contracts. API names and schemas below are proposed EvolveKit interfaces, not claims about APIs already implemented in this repository. The workspace currently contains the PRD; application code and infrastructure remain to be built.

## 1. Architecture decisions

### ADR-001: Framework-independent capability model

`@evolvekit/core` owns serializable capability definitions, configuration schemas, operations, deterministic transformation functions, and lifecycle types. It imports no React types, browser APIs, ORM models, or AI provider SDKs.

Capabilities describe what may change, not how a framework renders it. React components and server data adapters are registered separately by stable identifiers. Registry metadata sent to the planner never contains executable functions or production records.

React is the first rendering adapter. A future Vue or other adapter must consume the same validated configuration and transformation contracts. Cross-framework rendering support is outside v0.1.

### ADR-002: Shared preview and production execution

Preview and production call the same configuration resolver, table model builder, and React renderer. Their differences are the configuration source, authorized data source, and explicit preview chrome. No separate mock implementation of filtering, sorting, column visibility, or saved views is permitted.

Synthetic preview data is visibly identified. Identical rendering logic guarantees consistent configuration semantics; it cannot guarantee identical results across different datasets or data that changes over time.

### ADR-003: Immutable versions and authorization from day one

Every proposal revision and configuration version is immutable. Approval targets an exact revision and configuration hash. Publication requires fresh server authorization and a compare-and-swap against the active configuration generation. Rollback creates a new activation event referencing an earlier compatible configuration; it never deletes history or decrements the active generation.

### Additional v0.1 decisions

- Code-registered capabilities, installed through a trusted server startup/admin interface.
- Self-hostable backend; no hosted service dependency.
- Mandatory approval and tenant/organization-wide publication. Personal scopes are deferred.
- Opinionated React table with replaceable rendering contracts.
- Client-side table transformation over bounded, authorized datasets in v0.1. Server-side query compilation is a later adapter.
- One AI provider implementation behind a provider interface. No AI publishing authority.
- PostgreSQL is authoritative; no required Redis or background queue service.
- Polling retrieves active configuration; push subscriptions are deferred.

## 2. System boundaries and dependency graph

```text
core <- ai
core <- server -> ai
core <- react
demo-erp / demo-crm -> react
demo backend integrations -> server
```

The server owns authentication integration, persisted registries, proposals, validation, approval, configuration activation, and audit events. The host owns identity, permissions, data authorization, and React application routing.

The AI planner receives an allowlisted registry projection and emits an untrusted candidate. Only server validation can produce a validated revision. Browser-submitted role names, tenant IDs, validation results, or approval flags are never authoritative.

An installed registry is part of the application's trusted integration contract. Developers deploy baseline configurations and matching adapters before enabling that registry version for publication. A browser cannot install or modify a registry.

## 3. Package APIs

### `@evolvekit/core`

Public exports include JSON-safe types and runtime validators:

```ts
export type Permission =
  | 'evolution:request' | 'evolution:read' | 'evolution:refine'
  | 'evolution:submit' | 'evolution:approve' | 'evolution:publish'
  | 'evolution:rollback' | 'evolution:audit';

export interface Scope {
  applicationId: string;
  tenantId: string; // Single-tenant hosts also use an explicit tenant.
  pageId: string;
}

export interface ConfigurationEnvelope {
  versionId: string;
  schemaVersion: 1;
  registryVersionId: string;
  configurationHash: string;
  configuration: TableConfiguration;
}

export function validateRegistry(input: unknown): RegistryValidationResult;
export function validateOperations(
  input: unknown, registry: CapabilityRegistry
): OperationValidationResult;
export function applyOperations(
  base: TableConfiguration, operations: RuntimeOperation[],
  registry: CapabilityRegistry
): TableConfiguration;
export function buildTableModel(
  rows: readonly Record<string, unknown>[],
  config: TableConfiguration, registry: CapabilityRegistry,
  context: { evaluationTime: string }
): TableModel;
```

All transformations are pure and deterministic. Use a fixed evaluation timestamp per render/request for relative date predicates. Return structured errors with stable codes and JSON paths. Validation results above are discriminated unions; errors never return a partially trusted configuration. IDs are opaque strings; no caller should infer access from an ID.

### `@evolvekit/ai`

```ts
export interface PlannerProvider {
  generate(input: PlannerInput, signal: AbortSignal): Promise<unknown>;
}
export interface PlannerInput {
  request: string;
  registry: PlannerRegistryProjection;
  baseConfiguration: TableConfiguration;
  previousDraft?: { operations: RuntimeOperation[]; userRefinement: string };
}
export type PlannerCandidate =
  | { kind: 'runtime'; operations: RuntimeOperation[]; summary: string }
  | { kind: 'unsupported'; reason: string; missingCapabilities: string[] };
```

The package owns provider prompts, structured-output requests, timeouts, and output parsing. It receives no database connection, authentication credentials, approval service, or publication function. Provider output remains untrusted even when it parses correctly.

### `@evolvekit/server`

```ts
export interface Principal {
  subjectId: string;
  applicationId: string;
  tenantId: string;
}
export interface AuthorizationAdapter {
  authenticate(request: unknown): Promise<Principal>;
  authorize(principal: Principal, permission: Permission,
    resource: Scope & { requesterId?: string }): Promise<boolean>;
}
export function createEvolveServer(options: {
  databaseUrl: string;
  authorization: AuthorizationAdapter;
  planner: PlannerProvider;
  previewData: PreviewDataAdapter;
  limits: { maxRequestChars: number; maxPreviewRows: number };
}): EvolveServer;
```

The facade exposes a Fastify plugin, registry installation service, and lifecycle services. The HTTP handlers call those same services; routes contain no independent authorization or state-transition implementation. Transactions and resource scoping are enforced in repositories/services.

### `@evolvekit/react`

```tsx
<EvolveProvider
  applicationId="erp"
  apiClient={authenticatedClient}
  registry={installedRegistry}
  components={componentRegistry}
  dataAdapters={dataAdapterRegistry}
>
  <CustomersPage />
  <EvolveAssistant pageId="customers" />
</EvolveProvider>
```

Exports: `EvolveProvider`, `EvolveAssistant`, `EvolvableTable`, `EvolvePreview`, `ProposalStatus`, `ApprovalDialog`, `EvolutionHistory`, `useActiveConfiguration`, and `useProposal`. `EvolvableForm` is deferred beyond v0.1 because the MVP supports table operations only.

`apiClient` uses the host's authenticated transport; it does not accept privileged browser secrets. `useActiveConfiguration(pageId)` returns `{ configuration, loading, error, generation }`. `EvolvableTable` accepts `pageId` and uses the resolved configuration. Preview passes a validated envelope through an internal configuration override to that same table renderer.

Applications supply an immutable safe baseline configuration. If configuration retrieval fails, keep the last compatible configuration, or the baseline on first load. Render an accessible status within SDK UI without blocking unrelated application screens.

## 4. Capability contract and configuration semantics

```ts
export interface CapabilityRegistry {
  schemaVersion: 1;
  applicationId: string;
  version: string; // Developer label; persisted version ID is authoritative.
  pages: PageCapability[];
}
export interface PageCapability {
  pageId: string;
  routeKey: string; // Metadata, never an authorization boundary.
  component: { id: string; contractVersion: 1 };
  dataAdapter: { productionId: string; previewId: string; contractVersion: 1 };
  fields: FieldDefinition[];
  operations: CapabilityOperationDefinition[];
  baseline: TableConfiguration;
}
export interface FieldDefinition {
  id: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'date';
  nullable: boolean;
  filterOperators: FilterOperator[];
  canDisplay: boolean;
  canSort: boolean;
}
export interface CapabilityOperationDefinition {
  id: string;
  kind: RuntimeOperation['kind'];
  allowedFieldIds: string[];
}
export type FilterOperator =
  | 'eq' | 'neq' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte'
  | 'is_null' | 'is_not_null' | 'older_than_days';
export type RuntimeOperation =
  | { capabilityId: string; kind: 'add_filter'; filter: FilterDefinition }
  | { capabilityId: string; kind: 'set_column_visibility';
      fieldId: string; visible: boolean }
  | { capabilityId: string; kind: 'reorder_columns'; fieldIds: string[] }
  | { capabilityId: string; kind: 'set_number_format'; fieldId: string;
      format: 'plain' | 'indian' | 'international' }
  | { capabilityId: string; kind: 'create_saved_view'; view: SavedView };
export interface FilterDefinition {
  id: string;
  label: string;
  fieldId: string;
  operator: FilterOperator;
  value?: string | number | boolean;
}
export interface ViewConfiguration {
  columns: { fieldId: string; visible: boolean;
    numberFormat?: 'plain' | 'indian' | 'international' }[];
  filters: FilterDefinition[]; // AND semantics in v0.1.
  sort: { fieldId: string; direction: 'asc' | 'desc' }[];
}
export interface SavedView {
  id: string;
  name: string;
  configuration: ViewConfiguration;
}
export interface TableConfiguration extends ViewConfiguration {
  schemaVersion: 1;
  pageId: string;
  savedViews: SavedView[];
  defaultViewId: string | null;
}
```

`show`/`hide` map to `set_column_visibility`; only fields declared displayable can be shown. `reorder_columns` must contain every configured column exactly once. Saved views are complete snapshots validated against the same registry; activating a saved view is a local selection and does not publish a new configuration. Sorting configuration is supported by the renderer but no standalone AI sorting mutation is exposed in v0.1.

The implemented number-format extension uses `set_number_format` for allowlisted numeric fields, with no arbitrary formatter functions or currency conversion. Formatting belongs to the immutable column configuration and saved-view snapshot; both runtime and preview read that same value. The demo retains Indian grouping for old configurations without a `numberFormat` property, preserving all old content hashes. Registry v2 adds this operation to the exact v1 contract; v3 adds Orders as an independent page. Only explicitly trusted predecessors satisfying `isAdditiveRegistryChange` may remain compatible. That check permits additional pages and operations while preserving every existing page contract. Initialization verifies stored predecessor content, serializes installation, records an audit event, and changes the application registry pointer without rewriting prior drafts, approvals, or active versions. New pages receive their own baseline version and generation. Old jobs validate against their pinned registry; new refinements record the current registry. Other registry changes still require a separately designed migration.

The implemented v4 extension adds registered page actions with allowlisted labels and placements. The v5 extension adds registered features and `set_feature`, with `enabledFeatures` persisted in immutable configurations. Customer follow-ups use shared preview and live UI, with temporary preview records and tenant-scoped PostgreSQL records after activation. Runtime routes check activation and permissions, enforce optimistic record versions, and audit mutations atomically. Rollback preserves task records while disabling access. The exact capability contract, schema, endpoints, request-to-publication sequence, and verification are documented in [the customer follow-up design](docs/customer-followups.md).

Operations apply in array order to the proposal's exact base configuration. Resolve the full candidate once on the server and store it; browsers never replay an AI operation list into production. Disallow duplicate IDs, unknown keys, unknown fields, arbitrary expressions, URLs, component imports, JavaScript strings, and unregistered adapters. Bound counts, string lengths, and numeric values through schemas. Allow at most 32 operations, 32 filters, and 20 saved views per proposal/configuration in the initial implementation.

Dates are valid ISO timestamps normalized to UTC. `older_than_days` accepts a positive integer up to 3650 and means strictly earlier than `evaluationTime - days × 24 hours`. Null does not match comparison predicates, including `older_than_days`; explicit null operators are required. `contains` is case-insensitive with documented locale-independent normalization. Missing required data fields are adapter errors rather than silently interpreted nulls. Stable sorting uses row order as its final tie breaker, with null values last.

The example "customers who haven't purchased in 90 days" needs a registered `lastPurchaseAt` field and an agreed policy for never-purchased customers. If that policy is ambiguous, return an unsupported/clarification result instead of silently inventing OR or null semantics. OR groups and derived business metrics require future contracts or explicit host-provided fields.

Registry JSON is canonicalized and hashed. Install identical content idempotently; reject reuse of a developer version label with different content. Persist immutable registry snapshots. An installed adapter advertises exact supported registry IDs and contract versions. An incompatible deployment must migrate or roll back its configuration before marking a new registry active for publishing.

## 5. Database schema

Use PostgreSQL with Prisma migrations. UUID identifiers are generated server-side. Store timestamps as `timestamptz`, hashes as SHA-256 hex, and validated contracts as `jsonb`. Logical schema:

| Table | Important columns and constraints |
|---|---|
| `applications` | `id`, `external_key UNIQUE`, `name`, `created_at` |
| `tenants` | `id`, `application_id`, `external_key`; unique `(application_id, external_key)` |
| `registry_versions` | `id`, `application_id`, `version_label`, `content`, `content_hash`, `installed_by`, `created_at`; unique `(application_id, version_label)` |
| `evolution_requests` | `id`, `application_id`, `tenant_id`, `page_id`, `requester_id`, `text`, `created_at` |
| `proposals` | `id`, scope columns, `request_id`, `current_revision_id`, `created_by`, `created_at` |
| `proposal_revisions` | `id`, scope columns, `proposal_id`, `revision_number`, `parent_revision_id`, `registry_version_id`, `base_version_id`, `base_generation`, `operations`, `resolved_configuration`, `configuration_hash`, `summary`, `refinement_text`, `created_by`, `created_at`; unique `(proposal_id, revision_number)` |
| `revision_lifecycle` | `revision_id PK`, scope columns, `state`, `lock_version`, `updated_at`; mutable state separate from immutable revision content |
| `validation_runs` | `id`, scope columns, `revision_id`, `validator_version`, `phase`, `result`, `errors`, `configuration_hash`, `created_at`; append-only |
| `approvals` | `id`, scope columns, `revision_id`, `decision`, `configuration_hash`, `actor_id`, `reason`, `created_at`; one terminal decision per revision |
| `configuration_versions` | `id`, scope columns, `registry_version_id`, `parent_version_id`, `source_revision_id`, `configuration`, `configuration_hash`, `created_by`, `created_at`; immutable, baseline has null source/parent |
| `active_configurations` | scope columns as composite PK, `version_id`, `generation BIGINT`, `updated_at` |
| `activation_events` | `id`, scope columns, `generation`, `previous_version_id`, `version_id`, `kind` (`baseline`, `publish`, `rollback`), `approval_id`, `actor_id`, `created_at`; unique scope + generation |
| `audit_events` | `id`, scope columns where known, `actor_id`, `event_type`, `resource_id`, `correlation_id`, `redacted_metadata`, `created_at`; append-only |
| `planner_jobs` | `id`, scope columns, `request_id`, `proposal_id`, `parent_revision_id`, `status`, `attempts`, `lease_until`, `base_version_id`, `base_generation`, `registry_version_id`, `input`, `result_code`, `created_at`, `completed_at` |
| `idempotency_keys` | `application_id`, `tenant_id`, `actor_id`, `route_key`, `key`, `request_hash`, `response_status`, `response_body`, `created_at`; composite unique scope/actor/route/key |

All tenant-owned records have `(application_id, tenant_id)` and composite foreign keys that include those columns. Page configuration/version relationships also include `page_id`. Referenced tables expose matching composite unique keys. Registry references enforce matching `application_id`; revision references enforce matching proposal ownership. Use SQL migrations for constraints Prisma cannot express directly.

Indexes cover scope + creation time for history, proposal + revision number, lifecycle state within scope, and pending jobs + lease expiry. Use database constraints/triggers to reject updates/deletes of immutable revision content, approvals, versions, registry snapshots, activation events, and audit events. Retention/redaction maintenance requires a separate explicit operational policy.

Baseline creation is a trusted integration step. Insert a validated baseline version, active pointer at generation 1, and baseline activation event in one transaction before accepting proposals for that page.

## 6. Proposal state machine

Revision content and workflow state are distinct. Each refinement creates a new revision; an old approval never transfers to it.

```text
Draft -> Validating -> ReadyForPreview -> PendingApproval -> Approved -> Published
               |                             |
               v                             v
        ValidationFailed                  Rejected

Approved -> PublicationConflict
Draft / ValidationFailed / ReadyForPreview / PendingApproval / Approved
  -> Superseded (when a new revision becomes current)
Published -> RolledBack (when its activation is explicitly undone)
```

| Transition | Preconditions / actor |
|---|---|
| Candidate → Draft | Planner job parses supported candidate; revision inserted immutably |
| Draft → Validating | Server validation service acquires lifecycle lock |
| Validating → ReadyForPreview / ValidationFailed | Append validation result; valid schema, capability, and scope checks required |
| ReadyForPreview → PendingApproval | Authorized submitter; current revision; server revalidates; user acknowledges preview |
| PendingApproval → Approved / Rejected | Approver permission; exact current revision/hash; append immutable decision |
| Approved → Published | Publisher permission; atomic publication transaction succeeds |
| Approved → PublicationConflict | Active generation/base mismatch; rebase as a new revision and obtain new approval |
| Eligible draft state → Superseded | Authorized refinement installs a new current revision in a transaction |
| Published → RolledBack | Explicit rollback from its active publication; activation event remains authoritative |

Generation failures and unsupported requests are planner job results, not previewable revisions. Failed validation requires a corrected new revision. A crashed validation can resume with its immutable inputs. Rejected, superseded, failed, and conflicted revisions cannot publish.

Published is a historical outcome, not a promise that the revision is currently active. New publications do not rewrite old revision states. Re-activating an older configuration is recorded by activation history; UI reads the active pointer to display current status. This avoids conflating configuration lineage with proposal review state.

Every state mutation checks expected `lock_version` and increments it. Refinement and approval lock the proposal row so that an approval racing with a new current revision cannot approve stale content. UI actions carry explicit revision IDs rather than implicitly selecting the latest revision.

## 7. Permissions and tenant isolation

Host authentication resolves principal and tenant membership. Route identifiers in URLs/bodies must match the authenticated principal's authorized scope. Requesters normally read/refine their own proposals; administrators may read within their authorized tenant. The authorization adapter decides this using resource ownership.

Permission checks occur on request, read, refinement, preview, submission, approval, publication, rollback, and audit retrieval. A requester can also approve only if the host explicitly grants that permission; v0.1 does not impose mandatory separation of duties.

Check permissions again immediately before privileged transactions. The host authorization adapter must provide a fresh decision; if the host needs stronger atomic revocation semantics, it must supply a policy version/token verifiable inside the write transaction. No external identity system can otherwise guarantee that a revocation racing after a decision takes effect before that commit.

Production data adapters independently enforce host data access. Column visibility is presentation, not data authorization. The SDK must never receive fields the viewer is unauthorized to access, even if those columns are hidden. Preview uses synthetic records by default and a server-registered, read-only adapter. Tenant predicates are mandatory in every resource query; return scoped 404s for inaccessible IDs. Use host-origin policy and CSRF defenses appropriate to cookie authentication, request limits, and secret redaction.

## 8. Preview engine

1. Fetch a validated revision envelope from the server after scoped read/preview authorization.
2. Check registry and component/data contract compatibility against the installed host adapter.
3. Obtain bounded synthetic rows through the registered preview data adapter. No caller-selected URL or executable code is accepted.
4. Mount the same `EvolvableTable` renderer with the revision envelope as a subtree-local override.
5. Compare against the proposal's base version, labelled with its version ID. If current production differs, also show a stale-base notice.
6. Close preview by removing the local override; do not write any active configuration.

Both paths call `buildTableModel` and share input controls and field renderers. Preview wrappers add banners and disable host actions with side effects. The v0.1 table exposes only reading, sorting, filter controls, view selection, and column presentation; custom cell renderers admitted to preview must meet the same side-effect-free contract. React subtree isolation prevents configuration leakage but is not a security sandbox for arbitrary code. All registered renderers are trusted host code.

Transient filter inputs and local view selection do not change the revision. To persist a different default or filter specification, create a refinement and preview that new revision. Preview acknowledgement stores the revision/hash for UX, not an authorization proof or evidence that every behavior was tested.

## 9. HTTP contracts and exact request-to-publication sequence

All routes are prefixed `/v1`, JSON only, and require authenticated application/tenant context. Mutation responses include a correlation ID. Errors use `{ code, message, details?, correlationId }` without secrets.

| Endpoint | Contract |
|---|---|
| `GET /capabilities?pageId=...` | Authorized registry projection and version/hash |
| `POST /evolution-requests` | `{ pageId, text }`; idempotency key required; returns `202 { requestId, proposalId, jobId }` |
| `GET /evolution-requests/:id` | Scoped request, job result, current revision and state |
| `POST /proposals/:id/revisions` | `{ parentRevisionId, refinement, expectedLockVersion }`; returns job ID |
| `POST /proposals/:id/validate` | `{ revisionId }`; schedules/reuses validation of exact revision |
| `GET /proposals/:id/preview?revisionId=...` | Validated config envelope, base envelope, synthetic dataset descriptor, state |
| `POST /proposals/:id/submit` | `{ revisionId, configurationHash, expectedLockVersion, previewAcknowledged: true }` |
| `POST /proposals/:id/approve` | `{ revisionId, configurationHash, expectedLockVersion }` |
| `POST /proposals/:id/reject` | Same identifiers plus optional reason |
| `GET /configurations/active?pageId=...` | Envelope + monotonic generation; ETag based on scoped generation/hash |
| `GET /configurations/history?pageId=...&cursor=...` | Paginated versions and activation events |
| `POST /configurations/publish` | `{ revisionId, expectedGeneration }`; idempotency key required |
| `POST /configurations/rollback` | `{ pageId, targetVersionId, expectedGeneration, reason }`; idempotency key required |
| `GET /audit-events?cursor=...` | Permission-checked, scoped, paginated, redacted events |

Use `401` for unauthenticated, `403` for denied actions, scoped `404` for inaccessible resources, `409` for stale state/version/idempotency conflict, `422` for invalid contracts, and `503` for temporary service unavailability. Validate sizes before invoking the planner. Initial defaults: 4,000 characters per request/refinement, 1,000 preview rows, 10 requests per principal per minute, and a 60-second planner attempt timeout; tune through measured pilot use.

### Ordered sequence

1. Host initializes provider and fetches the authorized active envelope for its page. The SDK checks compatibility and renders through the shared adapter.
2. Requester posts text. Server authenticates, checks request permission, resolves page/registry, and captures the active version and generation.
3. In one transaction, persist request, proposal placeholder, planner job with pinned base/registry inputs, idempotency result, and creation audit event. Return `202`.
4. Worker leases the job from PostgreSQL. It sends only necessary capability metadata, base configuration, and request text to the provider.
5. Parse candidate. Unsupported/generation failures are persisted with understandable status. Valid candidates become immutable revisions; lock the proposal when allocating revision number/current revision.
6. Resolve operations against the pinned base, validate the complete candidate, and hash its canonical JSON. Store revision content before exposing it. A malformed candidate may be recorded as a failed job rather than a usable revision. Append validation results and transition to preview-ready only after authoritative validation.
7. Requester fetches preview and synthetic data. Shared runtime displays base and candidate. Refinement repeats steps 3–6 with parent revision and pinned base; install it only if parent/current state still matches.
8. Requester submits exact revision/hash after preview. Server rechecks current revision, permission, and validation, then moves to pending approval with audit event.
9. Approver reviews exact revision and chooses approve/reject. Server locks proposal/lifecycle, checks expected state/hash, appends decision and audit event, and commits the transition.
10. Publisher requests publication. Server freshly authorizes, checks compatibility with the publish-enabled registry, and revalidates the approved immutable content.
11. In a transaction, lock proposal, lifecycle, and active pointer in consistent order. Confirm approved/current revision, matching approval hash, registry still enabled, `expectedGeneration == active.generation == revision.baseGeneration`, and active version equals revision base version.
12. Insert a configuration version with parent equal to current active version. Increment generation and swap pointer. Append activation event and audit event; transition revision to published. Store idempotent response in the same transaction and commit. Any error rolls back the entire write.
13. SDK polls active configuration every 15 seconds while visible and on focus; use conditional requests. On a new generation, atomically replace its local compatible envelope. Page refresh fetches the durable pointer. In-flight data loads are canceled or discarded when their configuration generation becomes stale.

If validation/registry compatibility changed after approval, refuse publication and require a new revision and approval. A base conflict is never auto-merged into approved content. The conflict response identifies the newer generation; an explicit rebase generates and validates a new revision for review.

## 10. Rollback and failure recovery

Rollback freshly checks permission and compatibility of a target version from the same application, tenant, and page. It revalidates against the registry supported by the current deployment. In one transaction, lock the active pointer, compare expected generation, increment generation, point to the historical target, append rollback activation/audit events, and mark the undone source revision rolled back where applicable. Rollback needs no AI call.

No-op rollback to the active version returns its current envelope without fabricating an activation. A retry with the same idempotency key returns the original successful result, even if newer activation occurred later; responses therefore identify the committed generation explicitly.

Configuration lineage is immutable: after rollback, the next new version uses the restored version as its parent. Activation events capture the complete chronological sequence that lineage alone cannot express.

Use expiring job leases and transactional completion so worker crashes can retry without creating duplicate revisions. Deduplicate completion by job ID; at most two retry attempts for transient planner failures. A failed final validation or publication preserves the old active pointer. Audit-event insertion for successful privileged writes is part of their transaction; denial events are written separately after rejection. Log operational failures without secrets when the audit database itself is unavailable.

An incompatible configuration response is rejected by the SDK, which keeps its last compatible envelope and displays an actionable integration error. Browser caches are scoped by application, tenant, page, registry and authenticated session; clear them on logout/tenant switch. Do not persist sensitive data rows in configuration caches. Checkpoints and backups protect PostgreSQL history; rehearse restore before pilot use.

## 11. Local development and deployment

```text
evolvekit/
  apps/demo-erp/         # First host integration and synthetic data
  apps/demo-crm/         # Second independent host integration
  apps/api/             # Fastify bootstrap and host integration wiring
  apps/worker/          # Planner/validation job consumer
  packages/core/
  packages/react/
  packages/server/
  packages/ai/
  packages/test-support/
  prisma/schema.prisma
  prisma/migrations/
  docker/compose.yaml
  docs/
```

Use pnpm workspaces and Turborepo build dependencies. Pin supported Node.js, package-manager, React, PostgreSQL, and library versions when scaffolding, after checking their official compatibility documentation. This design does not assume that runtimes or Docker are already installed.

Docker Compose runs PostgreSQL, API, worker, and demo apps. API and worker share the database; migrations run as a separate one-shot task before either service accepts work. In development, source mounts and package watchers support iteration. In CI/deployment, use built artifacts and a separate migration step. API readiness requires database access and validated registry/baseline installation; planner availability is reported separately so AI failure does not block active configuration reads.

Server-only environment variables: database URL, AI provider credentials, host authentication configuration, allowed origins, and limits. Commit `.env.example` with placeholders; keep actual secrets out of source control and browser bundles. Provide seed users/tenants with distinct requester, approver, and publisher permissions in demos.

Codex implementation work should follow the contract boundaries and phase checks below. Keep generated changes reviewable, run relevant checks, and never use production data or deployments for preview development. Code Evolution and autonomous repository mutation are outside the shipped SDK scope.

## 12. Validation and observability

| Layer | Required verification |
|---|---|
| Core | Capability allowlists, strict types, ordered operations, saved-view validation, null/date semantics, deterministic transformations |
| Runtime parity | Same configuration/rows/evaluation time produce equivalent table model and interactions in preview and production wrappers |
| Lifecycle | Every legal transition succeeds; illegal/stale transitions fail; refinement cannot inherit approval |
| Database | Immutability and composite scope constraints; transaction failure keeps old pointer; durable history after restart |
| Concurrency | Two publishers against one generation produce one commit; approve/refine race rejects stale action; rollback/publish race rejects one writer |
| Authorization | Each endpoint tested against permission matrix, guessed IDs, cross-tenant references, and hidden unauthorized fields |
| AI | Curated supported, ambiguous, unsafe, and unsupported requests; forged capabilities and malformed structured outputs rejected |
| End-to-end | Request → preview → refine → approve → publish → refresh → rollback in both demo hosts |
| Failure handling | Planner outage, expired job lease, lost publication response/retry, incompatible registry, failed preview data load |
| Accessibility | Keyboard controls, focus management, labelled preview state, announced errors and approval status |

Use Vitest for pure contracts/services, React Testing Library for adapter interactions, PostgreSQL-backed integration tests for transactions/constraints, and Playwright for full journeys. Test SSR/hydration before advertising Next.js compatibility.

Record request/job correlation IDs, planner latency/failures, validation rejection codes, publication conflicts, activation failures, rollback counts, and configuration fetch latency. Never put raw request text, tokens, or row values in default telemetry. Initial service objectives: configuration-read p95 below 250 ms and publication transaction p95 below 500 ms under a documented pilot load, excluding host authentication/network time. Measure before treating them as release guarantees.

## 13. Implementation sequence and release gates

1. **Core contracts:** Strict registry/configuration schemas, pure transformations, canonical hashing, baseline fixtures, and semantic tests. Gate: manual configuration changes render without recompilation.
2. **Persistence and permissions:** Migrations, scoped repositories, auth adapter, immutable records, state machine, baseline installation, approval/publication/rollback services. Gate: concurrency and isolation checks pass with hand-authored revisions.
3. **Shared React runtime:** Provider, table, active retrieval, synthetic adapter and preview override. Gate: parity and failure fallback checks pass.
4. **Planner pipeline:** Provider abstraction, leased jobs, candidate parsing, validation, refinement. Gate: supported requests generate safe revisions; unsupported requests stay inactive.
5. **Review UI and complete flow:** Assistant, proposal status, approval dialog, history and rollback. Gate: persisted flow survives API/worker restart and browser refresh.
6. **Second host and packaging:** Independent CRM integration, package builds, public exports and integration guide. Gate: neither demo's business logic is embedded in SDK packages; external developer can follow documented setup.

v0.1 ships only when the PRD definition of done and the above security, parity, durability, concurrency, and two-host checks pass. Thresholds for AI quality use the PRD pilot targets against a versioned curated dataset.

## 14. Follow-up design work

Before implementation, choose exact supported runtime/library versions and the first AI provider. During the first integration, document host authentication wiring and field authorization. Before the pilot, establish data retention, backup restore procedure, deployment compatibility checks, and measured service limits.

Deferred extensions include server-side filter compilation, multiple scopes, conditional/OR expressions, forms, external adapters, push updates, and Code Evolution. Each needs its own contract and migration plan; none may bypass immutable approval, scope enforcement, shared runtime semantics, or reversible activation.

A separate developer-only Code Evolution prototype now generates two fixed source files for pure numeric features, compiles them, and runs independent acceptance cases and React rendering in a restricted Docker container. It produces a content-hashed draft for code review and a static preview. It is outside SDK v0.1 and has no application integration, merge, approval, activation, or deployment authority. See [prototype design and sequence](docs/code-evolution-prototype.md) for its exact boundaries and the required future code approval and rollback contracts.
