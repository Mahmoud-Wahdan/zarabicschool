CREATE TYPE "TeacherFlagType" AS ENUM ('LATE_REPORT');

CREATE TABLE "teacher_flags" (
  "id" UUID NOT NULL,
  "academy_id" UUID NOT NULL,
  "teacher_id" UUID NOT NULL,
  "session_id" UUID NOT NULL,
  "flag_type" "TeacherFlagType" NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "teacher_flags_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "teacher_flags_session_flag_type_key"
  ON "teacher_flags" ("session_id", "flag_type");
CREATE INDEX "teacher_flags_teacher_created_idx"
  ON "teacher_flags" ("teacher_id", "created_at");

ALTER TABLE "teacher_flags"
  ADD CONSTRAINT "teacher_flags_academy_fkey"
    FOREIGN KEY ("academy_id") REFERENCES "academies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "teacher_flags_teacher_fkey"
    FOREIGN KEY ("teacher_id") REFERENCES "teachers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "teacher_flags_session_fkey"
    FOREIGN KEY ("session_id") REFERENCES "sessions" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
