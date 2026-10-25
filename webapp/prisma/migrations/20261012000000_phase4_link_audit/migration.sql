-- Session link audits (Phase 4) — append-by-code audit rows for Zoom link changes.
-- The URL value is NEVER stored: only which link kind changed, by whom, when, and whether
-- it came from a per-session edit (source = 'SESSION') or the series "apply link to
-- upcoming" action (source = 'SERIES'; one row per touched session, or a series-only row
-- when only the recurrence rule was updated).
-- No UPDATE/DELETE trigger (unlike the ledgers): this is an operational audit, not money;
-- application code only ever INSERTs, and demo/test cleanup must remain possible.
-- Schema only; no data backfill. This migration is NOT applied by the coding agent —
-- the owner applies it (npx prisma migrate deploy from webapp/, DIRECT_URL).

-- CreateTable
CREATE TABLE "session_link_audits" (
    "id" UUID NOT NULL,
    "academy_id" UUID NOT NULL,
    "series_id" UUID,
    "session_id" UUID,
    "changed_by_id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "join_url_changed" BOOLEAN NOT NULL DEFAULT false,
    "host_url_changed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_link_audits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "session_link_audits_academy_id_created_at_idx" ON "session_link_audits"("academy_id", "created_at");
CREATE INDEX "session_link_audits_session_id_created_at_idx" ON "session_link_audits"("session_id", "created_at");
CREATE INDEX "session_link_audits_series_id_created_at_idx" ON "session_link_audits"("series_id", "created_at");

-- AddForeignKey
ALTER TABLE "session_link_audits" ADD CONSTRAINT "session_link_audits_academy_id_fkey" FOREIGN KEY ("academy_id") REFERENCES "academies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "session_link_audits" ADD CONSTRAINT "session_link_audits_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "recurrence_series"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "session_link_audits" ADD CONSTRAINT "session_link_audits_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "session_link_audits" ADD CONSTRAINT "session_link_audits_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Raw-SQL invariant: the source domain is fixed, mirroring the CHECK style of phase3_integrity.
ALTER TABLE "session_link_audits" ADD CONSTRAINT "session_link_audits_source_check" CHECK ("source" IN ('SESSION', 'SERIES'));
