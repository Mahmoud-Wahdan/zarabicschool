-- Session 3, slice B: session evaluations (owner decision 2026-10-24).
-- Student AND Guardian each rate the session/teacher (1..5 + optional comment),
-- ONE per (session, author) — incl. group sessions and multi-child guardians —
-- editable for 24h then locked (server-enforced). The teacher never sees this
-- table; Admin AND Supervisor read it and relay manually. No notifications.

CREATE TYPE "EvaluationAuthorType" AS ENUM ('STUDENT', 'GUARDIAN');

CREATE TABLE "session_evaluations" (
  "id" UUID NOT NULL,
  "academy_id" UUID NOT NULL,
  "session_id" UUID NOT NULL,
  "author_user_id" UUID NOT NULL,
  "student_id" UUID NOT NULL,
  "author_type" "EvaluationAuthorType" NOT NULL,
  "rating" INTEGER NOT NULL,
  "comment" VARCHAR(2000),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "session_evaluations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "session_evaluations_rating_check" CHECK ("rating" BETWEEN 1 AND 5),
  -- One evaluation per (session, author): the owner-confirmed rule. A guardian with
  -- several children in the same session still has exactly one evaluation.
  CONSTRAINT "session_evaluations_session_author_unique" UNIQUE ("session_id", "author_user_id")
);

CREATE INDEX "session_evaluations_academy_id_created_at_idx" ON "session_evaluations"("academy_id", "created_at" DESC);
CREATE INDEX "session_evaluations_session_id_idx" ON "session_evaluations"("session_id");

ALTER TABLE "session_evaluations"
  ADD CONSTRAINT "session_evaluations_academy_id_fkey"
  FOREIGN KEY ("academy_id") REFERENCES "academies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "session_evaluations"
  ADD CONSTRAINT "session_evaluations_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "session_evaluations"
  ADD CONSTRAINT "session_evaluations_author_user_id_fkey"
  FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "session_evaluations"
  ADD CONSTRAINT "session_evaluations_student_id_fkey"
  FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
