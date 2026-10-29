-- Phase 9 S-07 / SQL S-9 (D41, OQ-11 / M-6) — complaints, not financial. The owner
-- approved it as shown on 2026-10-29 (docs/specs/slices/S-07-roster-changes.md).
-- The session's roster student ids at the time the complaint is filed. NULL = filed
-- before this column existed (older complaints keep showing the current roster).
ALTER TABLE "complaints" ADD COLUMN "roster_student_ids" UUID[];
