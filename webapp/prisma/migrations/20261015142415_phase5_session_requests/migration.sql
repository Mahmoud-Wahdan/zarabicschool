-- CreateEnum
CREATE TYPE "SessionRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "session_requests" (
    "id" UUID NOT NULL,
    "academy_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "requested_by" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "SessionRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "replacement_session_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "session_requests_academy_id_status_created_at_idx" ON "session_requests"("academy_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "session_requests_session_id_idx" ON "session_requests"("session_id");

-- AddForeignKey
ALTER TABLE "session_requests" ADD CONSTRAINT "session_requests_academy_id_fkey" FOREIGN KEY ("academy_id") REFERENCES "academies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_requests" ADD CONSTRAINT "session_requests_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_requests" ADD CONSTRAINT "session_requests_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_requests" ADD CONSTRAINT "session_requests_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_requests" ADD CONSTRAINT "session_requests_replacement_session_id_fkey" FOREIGN KEY ("replacement_session_id") REFERENCES "sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One OPEN (PENDING) outage/absence request per (session, requester). Prisma cannot
-- express the partial predicate, so this invariant is raw SQL (database-schema.md §20,
-- Phase 5 Batch C). Rejected/approved requests never block a new one.
CREATE UNIQUE INDEX "session_requests_one_open_per_requester"
  ON "session_requests" ("session_id", "requested_by")
  WHERE status = 'PENDING';
