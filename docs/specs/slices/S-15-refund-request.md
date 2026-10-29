# S-15 — Payer refund request (D74, owner 2026-10-29)

> Branch `phase9-rest`. Status: **done.** SQL S-8 approved as shown (owner, 2026-10-29) and applied (`20261029100000_refund_requests`, 43 migrations, live DB = schema).

## Owner rules (2026-10-29)

- **Who asks:** the payer, i.e. a guardian for their children's invoices, or an adult student who pays for themself. A student with a guardian never sees it (finance wall).
- **What they send:** only "I want a refund" for one paid invoice. No reason required and no session count; example: the student is sick and can't attend. The Admin decides the amount.
- **Limit:** one open request per invoice. After a rejection the payer may ask again. Only PAID Paymob invoices.
- **Admin answer:**
  - **Approve:** the Admin opens the existing refund form (S-13c: sessions, rounding down, all caps) with the request linked. The request becomes APPROVED when that refund is sent.
  - **Reject:** the Admin writes a reason.
- **Payer is told:** in-app (inbox) and WhatsApp in the payer's language: approved with the amount, or rejected with the Admin's reason.
- **Inbox:** a waiting request appears in the Admin's inbox (Admin only, never the Supervisor: it is money).

## SQL S-8 (proposed; new table only, no change to any existing financial table)

```sql
CREATE TABLE "refund_requests" (
  "id" UUID NOT NULL,
  "academy_id" UUID NOT NULL,
  "invoice_id" UUID NOT NULL,
  "requested_by" UUID NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  "decided_by" UUID,
  "decided_at" TIMESTAMPTZ(6),
  "rejection_reason" TEXT,
  "invoice_refund_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "refund_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "refund_requests_status_check" CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED')),
  -- A decision has its decider and time; a rejection has a reason; an approval points to the refund made.
  CONSTRAINT "refund_requests_decision_check" CHECK (
    ("status" = 'PENDING'  AND "decided_by" IS NULL AND "decided_at" IS NULL AND "rejection_reason" IS NULL AND "invoice_refund_id" IS NULL) OR
    ("status" = 'REJECTED' AND "decided_by" IS NOT NULL AND "decided_at" IS NOT NULL AND char_length(btrim("rejection_reason")) BETWEEN 2 AND 1000 AND "invoice_refund_id" IS NULL) OR
    ("status" = 'APPROVED' AND "decided_by" IS NOT NULL AND "decided_at" IS NOT NULL AND "rejection_reason" IS NULL AND "invoice_refund_id" IS NOT NULL)
  )
);
-- One open request per invoice; after a rejection a new one is allowed.
CREATE UNIQUE INDEX "refund_requests_one_open_per_invoice" ON "refund_requests"("invoice_id") WHERE "status" = 'PENDING';
CREATE UNIQUE INDEX "refund_requests_invoice_refund_id_key" ON "refund_requests"("invoice_refund_id");
CREATE INDEX "refund_requests_academy_status_idx" ON "refund_requests"("academy_id", "status");
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_academy_id_fkey" FOREIGN KEY ("academy_id") REFERENCES "academies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_invoice_refund_id_fkey" FOREIGN KEY ("invoice_refund_id") REFERENCES "invoice_refunds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

No ledger, payment_audit, subscription or attendance table is changed. The money itself still moves only through the existing S-13c refund (its own audit and ledger rows).

## API and screens (after the OK)

- `POST /api/invoices/:id/refund-request`
  - **Who:** the payer only (same-origin).
  - **When refused:**
    - 409 if a request is already open;
    - 409 if the invoice is not PAID/Paymob;
    - 403 for a student with a guardian, for staff, and for another family.
- `GET /api/refund-requests`: the Admin's list, with filter by status.
- `POST /api/refund-requests/:id/reject`: Admin only, with a reason.
- **Approval:** the existing `POST /api/invoices/:id/refunds` gets an optional `refundRequestId`. When the refund is sent (SUCCEEDED, or 202 pending at Paymob), the request becomes APPROVED, linked to it, in the same transaction.
- **Notices:** job kinds `REFUND_REQUEST_RECEIVED` (Admin, in-app), `REFUND_REQUEST_APPROVED` and `REFUND_REQUEST_REJECTED` (payer, in-app + WhatsApp, ar/en).
- **Payer screen:** a "Request a refund" button on each paid invoice, a "Request sent" state, and the decision with the reason.
- **Admin screen:** a list on the invoices page, opening the refund form pre-linked, and a Reject button with a reason.

## Tests planned

- **RR-01..10:** payer-only access, one open request per invoice, ask again after a rejection, invoice must be PAID/Paymob, finance wall, Supervisor 403.
- Rejection reason required; approval only through a sent refund; notices in ar/en; no Supervisor money item.
- OWASP lists updated; i18n key tests.

## Built (2026-10-29)
- `lib/billing/refund-requests.ts` (create, reject, list; `lockOpenRequest` / `linkApprovedRequest` used inside `requestRefund`): a refund with `refundRequestId` must match an OPEN request of the same invoice (409 REQUEST_NOT_OPEN, nothing sent to Paymob); on SUCCEEDED or a Paymob-pending answer the request becomes APPROVED with the refund linked, in the same transaction; on FAILED it stays open.
- Routes: `POST /api/invoices/:id/refund-request` (payer), `GET /api/refund-requests` (Admin, `?status=`), `POST /api/refund-requests/:id/reject` (Admin, reason 2–1000).
- Notices: REFUND_REQUEST_RECEIVED (each active Admin, in-app, recorded SENT); REFUND_REQUEST_APPROVED (amount + same card) and REFUND_REQUEST_REJECTED (the Admin's reason, max 300 characters in the text) to the payer, in-app + WhatsApp in their language, with the platform invoices link. Inbox titles ar/en; links: Admin → /admin/invoices, payer → their invoices page.
- Screens: `refund-request-button.tsx` on every PAID Paymob invoice of the guardian and adult-student invoices pages (confirm step; sent / approved / rejected-with-reason states; ask again after a rejection); `refund-requests-admin.tsx` on /admin/invoices (waiting requests; "Refund sessions" opens the S-13c form linked to the request; "Reject" with a reason). Impeccable detector: clean.
- Tests: `__tests__/api/refund-requests.test.ts` RR-01..10, `__tests__/lib/refund-request-ui.test.tsx` RRU-01..04; affected suites (refunds, i18n, OWASP, same-origin, uuid, inbox) green.
