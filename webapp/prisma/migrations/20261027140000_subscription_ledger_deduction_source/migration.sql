-- Phase 9 S-01 / SQL S-1c (owner OK, 2026-10-27): S-1b relaxed the deduction CHECK
-- to "-1 and a session", so the database accepted a SESSION_DEDUCTION with no
-- source (test ATT-12). This restores the source rule in the database: a
-- deduction must come from a report (report_id) OR be referenced by a manual
-- attendance resolution. Checked at COMMIT (deferred), because the resolution row
-- is written after its ledger row in the same transaction. FINANCIAL table:
-- applied by the owner, never by the agent. The CHECK, the unique
-- (session_id, subscription_id) deduction index and the append-only trigger are
-- unchanged; UPDATE/DELETE stay blocked by subscription_ledger_append_only.
CREATE FUNCTION require_deduction_source() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.entry_type = 'SESSION_DEDUCTION'
     AND NEW.report_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM attendance_resolutions r
                     WHERE r.subscription_ledger_id = NEW.id) THEN
    RAISE EXCEPTION 'SESSION_DEDUCTION % has no source', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER subscription_ledger_deduction_source
  AFTER INSERT ON subscription_ledger
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION require_deduction_source();
