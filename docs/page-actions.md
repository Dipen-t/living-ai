# Registered page buttons

EvolveKit can move and rename a registered button without changing its behavior. The initial integration registers Customers’ `add-customer` button, labelled “Add Customer”, bound by the app to `open-customer-form`.

The framework-independent action contract declares `id`, `label`, `handlerId`, `defaultPosition`, and `allowedPositions`. The supported positions are `page_header`, `above_table`, and `below_table`. The handler ID identifies an app-owned callback; configuration cannot contain executable code, URLs, CSS, or a replacement handler.

A runtime operation looks like:

```json
{
  "capabilityId": "customer-action-layout",
  "kind": "set_action",
  "actionId": "add-customer",
  "label": "New Customer",
  "position": "above_table"
}
```

At least one of label or position is required. The capability must allow the action ID, and the action must allow the requested position. Actions are page-level settings, independent of saved table views. The optional `configuration.actions` array stores overrides, so old configurations and their hashes remain unchanged. `resolveActions` combines these overrides with registered defaults.

Registry `v4-page-actions` explicitly trusts v1, v2-number-format, and v3-orders. Additive upgrades can introduce actions but cannot replace an existing action’s handler, label, or allowed/default positions. Existing fields, baselines, adapters, and operations remain protected. Old jobs validate against their pinned registry; action definitions are included in new pinned planner inputs.

The React table renders all three button slots from the same resolved configuration in both preview and production. Handlers are supplied by the integrating application. Unbound handlers produce disabled buttons. Gemini and no-cost local rules both support “Move the Add Customer button above the table and rename it New Customer”. Manual options include button text and position.

## Demo behavior

The button opens an accessible customer form. In preview, form submission adds a temporary row only to the preview. Refreshing the draft clears temporary rows. The active workspace and browser storage are untouched. Outside preview, demo customer additions are saved in browser local storage, not the shared server database. The form explains this distinction. Production authentication and a real customer write adapter remain future integration work.

## Verification on 12 October 2026

- Live Gemini created the exact movement/renaming request as a validated, unapproved draft.
- The moved “New Customer” button opened the form. Adding a test customer changed the preview from four of eight to five of nine customers, while the active table stayed at four of eight with its original “Add Customer” button. Refresh removed the temporary row and retained the saved layout draft.
- Contract tests reject unknown actions, unregistered positions, handler changes, duplicate overrides, and empty operations.
- Renderer tests verify identical preview/production slots and above/below-table ordering.
- Integration tests verify immutable proposal planning, approval, publication, and rollback without affecting Orders.
- 57 unit tests and 31 isolated PostgreSQL integration tests pass. Workspace type checks and production build pass.

The live layout draft is left ready for review; no layout publication was performed in the live demo.
