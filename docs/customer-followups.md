# Customer follow-up workflow

The first workflow expansion adds customer-linked tasks with an owner, due date, and pending/completed status. This is a registered, bundled capability assembled from a request, not arbitrary code or database schema generation by the model.

## Activation contract

Registry `v5-customer-followups` extends Customers with feature `customer-followups`, contract version 1, and capability `customer-followups-workflow`. It explicitly trusts the exact v1–v4 predecessor contracts. Orders remains independent.

```json
{
  "kind": "set_feature",
  "capabilityId": "customer-followups-workflow",
  "featureId": "customer-followups",
  "enabled": true
}
```

The immutable configuration stores `enabledFeatures`. Old configurations omit that property and retain their hashes. Feature IDs must be registered and capability-allowlisted; existing feature contracts cannot be changed by an additive upgrade. New planner jobs pin feature definitions along with fields, buttons, and operations.

Request → proposal → interactive preview → acknowledged submission → approval → publication uses the existing versioning and state machine. Publication reveals the task panel and the My follow-ups navigation entry. Rollback or a disabling proposal hides the workflow and blocks task API access; existing records remain available when the workflow is approved and activated again.

Gemini supports the full request: “Add customer follow-ups so my team can assign an owner, set a due date, and mark them complete.” The local development planner supports “Add customer follow-ups” and “Disable customer follow-ups”. Manual options also provide a workflow toggle.

## Shared UI and preview

`FollowUpsPanel` and its form are shared between preview, the active customer page, and My follow-ups. Users can create tasks, view their own or everyone’s tasks, filter pending/overdue/completed work, assign owners, complete tasks, and reopen them.

Preview uses temporary in-memory tasks and the same form and list rendering. It never calls the task mutation API. Preview records are not published with configuration and are cleared when the preview component is remounted or the user chooses Clear preview tasks. The active workflow uses authenticated server requests and PostgreSQL. Due dates are date-only values; overdue means a pending task whose due date precedes today in the browser’s local calendar.

## Data and permissions

Migration `202610120005_customer_followups` adds `FollowUpCustomer` and `FollowUp`. Customer references use a composite application/tenant/customer foreign key. Tasks store title, owner, due date, status, creator, completion actor/time, and a monotonically incrementing lock version. Database checks protect status, completion metadata, and nonnegative versions.

The demo seeds its eight existing sample customers into the shared database. Browser-only demo customer additions from the previous milestone are not shared customer records and cannot be linked to follow-ups yet. The two task owners are Maya and Arun. Production membership, authentication, and a real customer adapter are future integrations.

Both demo users can read and create tasks and assign owners. Only a task’s creator or Arun, the demo manager, can reassign it. Only its current owner or Arun can complete or reopen it. The server enforces these rules even if the UI is bypassed. Every lookup is scoped to the authenticated application and tenant; callers cannot supply another tenant or an arbitrary owner.

Task creation is idempotent per actor/key and rejects reused keys with different content. Updates require the expected task version and return a conflict on stale edits. Each transaction takes a shared lock on the customer page’s activation row, serializing task access with publication/rollback. Mutations and audit records commit together. Audit metadata records customer/owner/version at creation and owner/status transitions on updates.

## HTTP API

- `GET /v1/followups/context`: scoped customer choices, allowed owners, and current demo identity.
- `GET /v1/followups`: scoped tasks ordered by due date and creation time; currently bounded to 500 records.
- `POST /v1/followups`: customer ID, title, owner ID, due date, and an Idempotency-Key UUID.
- `POST /v1/followups/:id`: expectedVersion plus ownerId and/or status.

All routes require authentication and an active approved workflow. Existing origin checks cover mutations. Invalid dates, unknown customers, ownership violations, cross-tenant task access, and stale versions are rejected.

## Verification — 12 October 2026

- 59 unit tests and 32 isolated PostgreSQL integration tests passed.
- Type checks and the production build passed.
- Integration coverage creates a real task after approval/publication, retries creation idempotently, rejects invalid dates and customers, verifies reassignment and completion permissions, checks tenant isolation and stale edits, reconnects the API, and confirms rollback blocks reads/writes without deleting records. Reactivation restores access to the same task.
- The full Gemini request produced a saved, unapproved live preview. Its form, overdue view, completion, reopening, assignment, and owner permissions were exercised with temporary preview data.

The live workflow is left ready for review; it has not been approved or activated in the user’s demo workspace.
