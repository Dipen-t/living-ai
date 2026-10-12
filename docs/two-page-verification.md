# Two-page workflow verification

Verified locally on 12 October 2026 using the existing dedicated EvolveKit database and sample records.

## Customer journey

1. Reviewed the saved international revenue formatting preview as Maya.
2. Acknowledged the preview and sent the immutable draft for approval.
3. Switched to Arun, acknowledged the same preview, and approved it.
4. Applied the approved change. The active customer table displayed `184,000`, matching the preview.
5. Restored the immediately preceding approved version. The active table returned to its prior four-customer date filter and Indian grouping (`1,84,000`). The published formatting version remained in history and its draft became “Replaced by an earlier version”.

The live Customers page is left at its previous configuration after this verification.

## Orders extension

The new Orders page uses the same editor, AI pipeline, React runtime, approval state machine, and database tables. Its registered fields are Order, Customer, Status, Order date, and Amount (₹). The supplied sample data contains six orders.

Live Gemini request: “Show orders with status Pending and format amount with international commas”. It created an immutable, validated draft showing ORD-1001, ORD-1003, and ORD-1006, with amounts `184,000`, `67,000`, and `112,000`. Orders remains at its original active configuration; the generated draft is ready for the user to review.

Screenshot: [Orders preview](../artifacts/evolvekit-orders-preview.jpg).

## Automated verification

- 52 unit tests passed.
- 30 PostgreSQL integration tests passed in a separate disposable schema.
- All workspace type checks and the production build passed.
- New integration coverage runs Orders planning, approval, publication, and rollback while asserting the entire Customers active envelope stays unchanged. Customer capabilities are rejected on Orders.
- Registry upgrade coverage verifies that new-page initialization preserves old customer drafts, hashes, versions, approvals, and generations. Unit coverage rejects page deletion and existing contract changes.

The API still uses local demo identities and sample records; this milestone verifies the reusable integration architecture, not production authentication or a real Orders data adapter.
