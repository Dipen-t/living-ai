# Column heading changes

Registry `v6-column-labels` adds `set_column_label` for displayable fields on Customers and Orders. The exact v5 workflow registry remains an explicitly trusted predecessor alongside v1–v4; existing configuration hashes and immutable records remain unchanged.

Example operation:

```json
{"capabilityId":"customers-column-labels","kind":"set_column_label","fieldId":"revenue","label":"Amount"}
```

The column configuration stores an optional plain-text `label` (1–120 characters after trimming). The framework-independent table model resolves the override, so preview and production share the same heading. Underlying field IDs, values, filters, sorting, and number formats are preserved. Saved-view snapshots support labels. Unregistered renaming, unknown fields, empty labels, and oversized labels are rejected. Publication and rollback use the existing immutable configuration lifecycle.

Gemini and local rules support column renaming. Local rules accept the exact uppercase request `RENAME THE REVENUE COLUMN TO AMOUNT`, distinguish column and button targets, and recognize current column labels as well as original names and stable IDs.

Verification: 63 unit tests and 32 PostgreSQL integration tests passed, as did the full build and type check. The exact reported request was submitted through the live Gemini demo and produced a preview with the heading `Amount`, preserving the existing customer filter and comma formatting. That draft remains unapproved and unpublished.
