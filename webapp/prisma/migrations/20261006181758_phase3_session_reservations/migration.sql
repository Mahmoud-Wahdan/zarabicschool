-- CreateEnum
CREATE TYPE "SessionReservationStatus" AS ENUM ('RESERVED', 'RELEASED');

-- CreateTable
CREATE TABLE "session_reservations" (
    "id" UUID NOT NULL,
    "academy_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "status" "SessionReservationStatus" NOT NULL DEFAULT 'RESERVED',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_at" TIMESTAMPTZ(6),

    CONSTRAINT "session_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "session_reservations_subscription_id_status_idx" ON "session_reservations"("subscription_id", "status");

-- CreateIndex
CREATE INDEX "session_reservations_academy_id_status_idx" ON "session_reservations"("academy_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "session_reservations_session_id_student_id_key" ON "session_reservations"("session_id", "student_id");

-- AddForeignKey
ALTER TABLE "session_reservations" ADD CONSTRAINT "session_reservations_academy_id_fkey" FOREIGN KEY ("academy_id") REFERENCES "academies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_reservations" ADD CONSTRAINT "session_reservations_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_reservations" ADD CONSTRAINT "session_reservations_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_reservations" ADD CONSTRAINT "session_reservations_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
