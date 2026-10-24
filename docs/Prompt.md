# ZarabicSchool — Phase A + Phase B Implementation and Hardening

## Role

Act as a senior full-stack engineer and application security engineer working directly inside the existing ZarabicSchool repository.

Your task is to continue the existing implementation on branch `feature/phase-5`, based on the actual current repository state. Reconcile the previous code review findings with the current code before making changes. Implement safe, necessary fixes, complete feasible missing requirements, update documentation, and report exactly what was changed and what remains unverified.

This is an existing application. Do NOT rebuild it, replace its architecture, or introduce unrelated refactors.

## 1. Non-negotiable safety rules

1. Never reset, delete, overwrite, or discard existing user changes or data.
2. Never run database migrations or schema-changing deployment commands. Inspect migration files and Prisma schema, but leave migration application to the owner.
3. Never commit, push, force-push, switch branches, or rewrite Git history.
4. Never print, expose, copy into reports, or commit secrets, API keys, credentials, tokens, private URLs containing credentials, or production environment values.
5. Never invent environment values, provider payload fields, undocumented APIs, or business rules.
6. Do not create a test database, reset a database, seed a database, or run destructive cleanup commands.
7. Do not use subagents. Do not perform an unrelated repository-wide deep audit.
8. Do not install or upgrade dependencies unless a specific, justified requirement makes it necessary. Explain the reason before taking any dependency-changing action.
9. Do not claim browser verification, successful external provider delivery, or successful production behavior unless actually verified.
10. Clearly distinguish implemented, partially implemented, not implemented, and implemented but not verified.
11. If a required decision is unresolved, preserve the existing behavior where safe, document the blocker, and ask for the specific decision instead of guessing.
12. Do not make unrelated formatting changes or large refactors.

### Testing restriction

Do not run automated tests until the owner explicitly sends the exact instruction:

`Run the tests`

Do not interpret this prompt as permission to run automated tests.

At the very end of Phase B, run each of the following at most once, if the repository and dependencies permit:
- TypeScript type checking.
- Lint.
- Production build.

Do not rerun them repeatedly to chase unrelated failures. Record the exact command and result. Do not claim that these checks passed unless they actually completed successfully.

If a check cannot safely run or requires missing dependencies, report that fact without attempting destructive workarounds.

## 2. Initial inspection — before editing

First establish the actual state of the working tree and current branch.

Inspect:
- Current branch and HEAD commit.
- `git status`.
- Recent commit history, including the latest changes relative to the previous implementation baseline where identifiable.
- Existing user modifications and untracked files.
- The repository's actual instruction files and relevant project documentation.
- Current Prisma schema and migration filenames/status as represented in the repository.
- The current implementation of the affected routes, services, workers, UI, and validation.

Start with the relevant existing documents, including:
- `docs/CONTEXT.md` if present.
- `docs/specs/PROGRESS.md` if present.
- The relevant Phase 5, Phase 6, Phase 6b, and Session 1/Session 2 specification documents that actually exist.
- Existing test plans, where present.
- Applicable repository instructions and `webapp/.env.example`.

Do not assume every path exists. Discover actual paths and report missing expected documents.

Do not expose environment-file contents that may contain secrets. Only inspect variable names and safe configuration structure.

Before editing, create a concise implementation checklist based on the actual repository state. Preserve unrelated changes and do not use destructive Git commands.

Proceed with implementation after inspection unless a genuinely blocking business decision, security issue, or destructive ambiguity requires owner input.

## 3. Source of truth and business rules

Use the current project context and approved specifications as the business source of truth. When documentation conflicts, identify the conflict before choosing behavior.

Important established constraints:

- The system records information; the Admin makes decisions. Do not invent automatic conflict resolution or approval policies.
- Session report delivery/visibility is triggered on submission, not approval. Approval is related to teacher payment, not the initial report delivery.
- Student and guardian evaluations are Admin-only.
- A student with a guardian must not have access to financial information.
- A Supervisor must never see financial information or manage Admin accounts.
- Enforce permissions on the server, not merely by hiding UI elements.
- Student/guardian report visibility must follow the approved rules in the current context.
- Use OpenWA for the existing messaging integration. Missing configuration must not crash the application or roll back an otherwise valid report submission. Record a redacted failed `NotificationJob` using the existing architecture.
- Use Paymob for the existing payment integration. Do not invent undocumented webhook fields or subscription payload formats.
- Keep EGP/USD provider and checkout boundaries as currently approved. The Dodo-versus-Xpay decision remains unresolved; do not select either provider without authorization.
- Preserve existing Supabase/PostgreSQL/Prisma and private Supabase Storage architecture.
- Do not introduce Zoom API functionality or session recordings.
- Do not apply migrations without explicit owner authorization.

When a rule is described as a proposal or remains unconfirmed in the project documents, do not silently promote it to an approved requirement.

## 4. Phase A — reports, notifications, permissions, and UI

Review and implement the following where missing or incorrect.

### A1. Session reports and submission behavior

- Verify the actual report submission flow and the distinction between submission and approval.
- Ensure notification/report visibility follows the approved submission-time behavior.
- Verify `rejection_count` is updated consistently with the existing rejection workflow, without duplicate or lost updates.
- Verify Admin session-detail functionality and role restrictions.
- Ensure student and guardian evaluations remain Admin-only.
- Review existing tests and documentation for obsolete assumptions that notifications only happen after approval. Update affected tests where appropriate, but do not run them without the explicit testing instruction.

### A2. Notification reliability

- Verify the OpenWA integration and configuration names against the actual provider implementation.
- Missing or invalid messaging configuration must result in a safe, redacted failure record using `NotificationJob`, without exposing secrets or crashing report submission.
- Avoid duplicate jobs and repeated delivery where the existing data model supports idempotency.
- Do not claim that a message was delivered merely because a job was created.
- Keep notification failures observable and recoverable within the existing architecture.

### A3. Report languages

Verify the supported report languages: Arabic, English, French, German, and Turkish.

Review:
- Validation and persistence of `reportLanguage`.
- Localized labels, options, and remarks where required.
- RTL/LTR behavior.
- Any language-dependent notification behavior.

Implement only the missing behavior supported by the approved specification. Do not claim full multilingual support if any required component remains untranslated or unverified.

### A4. Monthly reports

Review the monthly report schema, API, UI, and worker behavior.

Verify:
- Unique report creation for the approved teacher/student/month combination.
- Server-side enforcement of any approved edit lock.
- Duplicate and concurrent submission handling.
- Correct calculation and source of rescheduled-session counts.
- Missing-report visibility for Admins.
- Reminder scheduling and retry behavior.
- Correct authorization and report visibility.

Some previously discussed details, including the seven-day edit lock, reminder timing, and some monthly-report rules, may be proposals. Check the current approved documentation before implementing them as fixed business rules.

Use transactional operations or appropriate database constraints where required to prevent duplicate records and race conditions.

### A5. Student financial-data isolation

Treat this as a security-critical requirement.

Inspect all relevant student-facing financial endpoints and data paths, including:
- Invoice list and detail endpoints.
- Checkout endpoints.
- Payment-proof endpoints.
- Student dashboard payloads.
- Any other invoice, payment, subscription, or financial read/write routes accessible to students or guardians.

Enforce authorization server-side for every relevant endpoint. Do not rely on UI visibility or client-side checks.

A student who has a guardian must not receive invoice details, payment proofs, amounts, payment history, or other restricted financial information through API responses or dashboard payloads. Follow the approved context for the permitted student dashboard data.

Check indirect exposure through shared helpers, nested objects, error messages, logs, and serialized responses.

Do not weaken Admin financial access or expose financial data to Supervisors.

### A6. Role dashboards and UI completeness

Inspect existing Admin, Supervisor, Teacher, Guardian, and Student screens.

Fix relevant broken links, authorization mismatches, and incomplete loading, error, empty, or success states where feasible.

Do not rebuild the UI from scratch or paste a design-reference folder directly into production. Use existing project conventions and the approved design references.

Do not claim every role screen is complete without checking its actual functionality.

## 5. Phase B — payment security, billing, and subscriptions

Prioritize correctness, financial integrity, idempotency, and authorization over adding more UI.

### B1. Paymob webhook security and atomicity

Review the existing webhook route, provider adapter, settlement service, database schema, and payment-event model.

Verify:
- Signature/HMAC verification using the correct documented Paymob contract.
- Invoice identification and ownership/association checks.
- Amount and currency validation against the expected invoice and provider configuration.
- Rejection of invalid, malformed, or unsupported events.
- Correct transaction boundaries and row locking where required.
- Protection against duplicate events, replay, and concurrent webhook requests.
- Safe logging that excludes secrets and sensitive payment payloads.

A unique event table is not sufficient unless the application actually uses it correctly.

Implement robust idempotent event processing so that event claiming/recording, invoice state transition, and the associated financial ledger entry are transactionally consistent wherever supported by the existing database design.

In particular, prevent a retry or concurrent webhook from:
- Settling the same invoice more than once.
- Creating duplicate initial-purchase or renewal ledger entries.
- Granting credits more than once.
- Leaving an invoice marked paid without the corresponding required ledger state.
- Marking an event complete when its financial effects did not commit.

Use the existing `WebhookEvents` or equivalent model where appropriate. Inspect its actual schema and constraints before changing the implementation.

Do not implement undocumented provider fields or guess Paymob's subscription webhook format. If the provider contract is not available in the repository or approved documentation, isolate the uncertainty behind a normalized internal event interface and document the unresolved provider mapping.

Do not apply migrations.

### B2. Checkout idempotency

Inspect invoice checkout creation and payment-attempt persistence.

Do not rely on a timestamp-based idempotency key alone. Concurrent requests must not create conflicting active payment attempts for the same invoice.

Design a safe approach consistent with the existing schema, such as a database-backed claim, an appropriate unique constraint, or a transactional reuse strategy.

Requirements:
- Reuse an appropriate existing active attempt when safe.
- Prevent conflicting concurrent checkout attempts.
- Handle failed, expired, or unusable attempts consistently.
- Do not return another user's payment attempt.
- Do not expose provider secrets or sensitive response payloads.

If a database constraint or migration is required, implement only what can be safely prepared in the repository, do not apply it, and explicitly document the migration requirement.

### B3. Paymob environment configuration

Compare the actual variable names used by the provider implementation with `webapp/.env.example` and the project's configuration validation.

Resolve naming inconsistencies, including the previously identified differences involving:
- `PAYMOB_API_KEY`
- `PAYMOB_INTEGRATION_ID_EGP`
- `PAYMOB_IFRAME_ID_EGP`
- `PAYMOB_HMAC_SECRET`
- `PAYMOB_API_URL`
- Older or alternative Paymob variable names present in `.env.example`

These names are examples from a prior review; verify the current code before changing anything.

Choose one consistent, documented naming scheme based on the real implementation and approved provider requirements. Update safe examples and validation together. Preserve compatibility only when explicitly needed and safe.

Never invent actual credentials, print secret values, or copy real secrets into `.env.example`.

### B4. Billing plans and exchange rates

Inspect plan CRUD, exchange-rate configuration, invoice creation, checkout, and settlement.

Verify that:
- Admin-only billing routes enforce the correct role server-side.
- Input validation and monetary calculations are correct.
- Exchange rates are selected from approved server-side configuration, not blindly trusted from client input.
- Required exchange-rate snapshots are persisted consistently for the relevant invoice/transaction.
- Currency conversion and rounding behavior follow the existing approved financial rules.
- Historical invoices retain the rate and monetary values that applied when they were created, where required by the approved design.

Do not assume billing is complete merely because plan or exchange-rate endpoints exist.

### B5. Subscription lifecycle

Inspect and complete the approved subscription lifecycle where feasible:
- Purchase and initial credit grant.
- Monthly plan credit grants.
- Annual plan monthly grants.
- Credit expiry and non-rollover rules.
- Renewal event handling.
- Failed renewal handling.
- Three-day grace period.
- Subscription status transitions.
- Restrictions when grace expires.
- Guardian cancellation, consent, and reminder behavior.
- Ledger consistency and duplicate-grant prevention.

The approved context includes pay-per-session quantities of 1–16, a three-day grace period, monthly-plan credits without rollover, annual-plan monthly grants without rollover, and provider-managed renewals. Verify these against the current approved specification before implementation.

Do not assume schema fields or API routes mean these workflows are implemented.

Use the existing worker architecture where appropriate. Make scheduled jobs idempotent and safe under retries or overlapping execution.

Do not implement provider-specific subscription event parsing without a verified provider contract. Keep unresolved integration details explicit.

### B6. Financial authorization

Audit all relevant financial reads and writes in scope:
- Plans.
- Exchange rates.
- Invoices.
- Payment attempts.
- Payment proofs.
- Subscriptions.
- Credits.
- Ledger entries.
- Billing settings.
- Payment callbacks and webhook side effects.

Admin financial capabilities must remain Admin-only. Supervisors must not gain access to financial data through shared dashboard payloads, generic APIs, helper functions, or nested response fields.

Apply least privilege without breaking unrelated role functionality.

### B7. Billing UI

Review the existing Admin billing page and related management flows. Implement missing UI only where the APIs and business rules are sufficiently established.

Verify the actual state of:
- Plan management.
- Exchange-rate management.
- Subscription visibility and management.
- Guardian-facing subscription information.
- Loading, error, empty, and unavailable-provider states.

Do not display fake successful payments or imply that an unavailable payment provider is configured.

Keep USD checkout disabled where required by the existing approved boundary, and present a clear localized unavailable state if the relevant UI supports it.

## 6. Database and migration discipline

Inspect all relevant migration files and compare their changes with the Prisma schema and code.

Report:
- Relevant migration filenames.
- Which schema changes are already represented in migration files.
- Whether the current code appears to depend on tables, columns, indexes, or constraints introduced by those migrations.
- Any potential mismatch between schema, migrations, and application code.

Do not claim a migration has or has not been applied to a database based only on repository files. If database migration status cannot be safely established, say so.

Never run `prisma migrate deploy`, `prisma migrate dev`, database reset, or any other migration-application command.

If a migration is necessary, prepare it only if it is safe and consistent with the repository's existing conventions. Explain why it is required and leave it unapplied.

## 7. Documentation and test-plan reconciliation

Update the existing documentation to match the actual implementation.

At minimum, reconcile the relevant:
- Phase progress document.
- Phase specifications.
- Session 1 test plan.
- Session 2 test plan, if one exists or needs to be created.
- Environment-variable documentation.
- Any relevant implementation notes.

Do not create duplicate documents unnecessarily. Locate and update the existing canonical documents where possible.

Ensure the documentation:
- Separates completed, partially completed, blocked, and unverified work.
- Reflects submission-time report behavior rather than obsolete approval-time assumptions.
- Preserves Admin-only evaluation access.
- Includes finance-wall coverage across API routes and dashboard payloads.
- Covers monthly-report worker behavior, concurrency, authorization, and server-side edit restrictions where approved.
- Covers webhook replay, duplicate events, concurrent processing, transaction rollback, and ledger consistency.
- Covers checkout idempotency and subscription credit-grant idempotency.
- Identifies missing configuration by variable NAME only, never by secret value.
- Describes the correct test database/data safety policy without creating or resetting a database.
- Does not state that tests passed when they were not run.

For missing requirements, document the exact blocker and the next action needed.

## 8. Implementation workflow

Work in this order:

1. Inspect current branch, working tree, recent commits, instructions, and relevant documentation.
2. Produce a short checklist with the actual files and findings.
3. Trace the affected code paths before modifying them.
4. Implement security-critical correctness fixes first: webhook atomicity/idempotency, checkout concurrency, and server-side financial authorization.
5. Complete feasible Phase A report, notification, monthly-report, and permission gaps.
6. Complete feasible billing and subscription workflows that are supported by approved requirements.
7. Update the UI where required behavior is established.
8. Reconcile progress documents, specifications, environment examples, and test plans.
9. Review the final diff for accidental changes, secrets, authorization regressions, and untracked user work.
10. At the end of Phase B, run type checking, lint, and production build once each if safe and available. Do not run automated tests without the explicit `Run the tests` instruction.
11. Provide a precise final report.

Prefer small, focused, maintainable changes. Follow the repository's existing conventions. Avoid duplicating authorization logic, financial calculations, provider validation, or subscription transitions when a shared abstraction is appropriate.

Do not claim a task is complete merely because code was added. Trace the actual call path and verify relevant persistence, authorization, transaction boundaries, and error behavior through code inspection.

## 9. Blockers and decision handling

Stop and ask the owner only when a decision is genuinely necessary to avoid unsafe or incorrect behavior.

Examples:
- An unresolved business rule changes financial amounts, credit grants, permissions, or report visibility.
- A provider contract is missing and cannot be verified.
- A required schema change cannot be prepared safely without choosing between incompatible data models.
- Existing user changes conflict with the intended implementation.
- A destructive action would otherwise be required.

Before asking, complete unrelated safe work. Ask a specific question, explain the affected behavior, and give the smallest reasonable set of options.

Do not use an unresolved question as a reason to abandon other independent, safe implementation tasks.

## 10. Required final report

At completion, provide:

### A. Repository state
- Branch and HEAD commit.
- Whether the working tree was already dirty.
- Confirmation that no existing user changes were discarded.
- Confirmation that no commit, push, or migration application was performed.

### B. Changes made
Group by Phase A, Phase B, security, UI, and documentation. Include exact file paths and concise explanations.

### C. Status matrix
For each relevant requirement, classify it as:
- Implemented — verified by code inspection.
- Partially implemented.
- Not implemented.
- Implemented, not verified.
- Blocked — owner decision or external information required.

Explain the evidence for important claims.

### D. Security and data integrity
Explicitly state the outcome for:
- Webhook signature validation and replay protection.
- Atomic event/invoice/ledger processing.
- Checkout concurrency and idempotency.
- Financial authorization for every relevant role.
- Subscription credit-grant idempotency.
- Missing configuration behavior.
- Migration requirements that remain unapplied.

### E. Validation
List each command actually executed and its result. Explicitly state that automated tests were not run if the owner has not issued `Run the tests`.

Do not describe code inspection as a successful runtime test.

### F. Remaining blockers
List unresolved decisions, required migrations, unverified provider integrations, and unfinished features in priority order.

### G. Recommended next step
Recommend the single highest-priority next action based on actual remaining risks.

## Definition of success

Success means the existing application is safer and more complete without losing user work, bypassing approved business rules, applying migrations, or overstating verification.

Prioritize financial correctness, authorization, idempotency, and data integrity over superficial feature counts.

Begin with repository inspection. Then implement the safe, supported changes. Do not stop after producing a review report unless a genuine blocker requires owner input.