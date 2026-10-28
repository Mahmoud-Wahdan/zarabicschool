/**
 * The ONE list of payment_audit event types (A2, 2026-10-28). It must match the
 * database CHECK `payment_audit_event_type_check` (latest: SQL S-6); the audit
 * writer's type, the Admin filter and the i18n test all derive from it. Not
 * server-only, so pages and tests can read it.
 */
export const PAYMENT_AUDIT_EVENT_TYPES = [
  "CREATED", "PAID", "FAILED", "CANCELLED", "REJECTED", "REFUNDED",
  "LINK_SENT", "REFUND_REQUESTED", "REFUND_FAILED", "VOIDED", "PROVIDER_REFUND_SEEN",
] as const;

export type PaymentAuditEventType = (typeof PAYMENT_AUDIT_EVENT_TYPES)[number];
