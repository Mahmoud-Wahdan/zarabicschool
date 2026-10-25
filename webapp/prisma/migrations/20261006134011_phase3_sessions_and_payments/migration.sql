-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('PAYMOB', 'USD_GATEWAY');

-- CreateEnum
CREATE TYPE "PaymentAttemptStatus" AS ENUM ('CREATED', 'REDIRECTED', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "SubscriptionPackageType" AS ENUM ('MONTHLY_PLAN', 'PAY_PER_SESSION');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'EXHAUSTED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SubscriptionLedgerEntryType" AS ENUM ('INITIAL_PURCHASE', 'SESSION_DEDUCTION', 'ADMIN_ADJUSTMENT', 'REFUND');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'MISSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SessionType" AS ENUM ('PRIVATE', 'GROUP');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PENDING', 'ATTENDED', 'STUDENT_ABSENT');

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'SUPERVISOR';

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "academy_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "package_type" "SubscriptionPackageType" NOT NULL,
    "sessions_purchased" INTEGER NOT NULL,
    "total_amount_minor" BIGINT NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "period_starts_at" TIMESTAMPTZ(6),
    "period_ends_at" TIMESTAMPTZ(6),
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "academy_id" UUID NOT NULL,
    "teacher_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "session_type" "SessionType" NOT NULL,
    "scheduled_start" TIMESTAMPTZ(6) NOT NULL,
    "scheduled_end" TIMESTAMPTZ(6) NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "zoom_join_url" TEXT NOT NULL,
    "zoom_host_url" TEXT,
    "recurrence_group_id" UUID,
    "replacement_for_session_id" UUID,
    "cancellation_reason" TEXT,
    "status" "SessionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_students" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "attendance_status" "AttendanceStatus" NOT NULL DEFAULT 'PENDING',
    "overridden_by" UUID,
    "override_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "session_students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_join_clicks" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "clicked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_join_clicks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "academy_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "subscription_id" UUID,
    "amount_minor" BIGINT NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "exchange_rate" DECIMAL(20,8),
    "package_type" "SubscriptionPackageType" NOT NULL,
    "sessions_purchased" INTEGER NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'PENDING',
    "provider_reference" TEXT,
    "paid_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_attempts" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "provider_reference" TEXT,
    "checkout_url" TEXT,
    "status" "PaymentAttemptStatus" NOT NULL DEFAULT 'CREATED',
    "raw_event_hash" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payment_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_ledger" (
    "id" UUID NOT NULL,
    "academy_id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "invoice_id" UUID,
    "entry_type" "SubscriptionLedgerEntryType" NOT NULL,
    "sessions_delta" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "subscriptions_academy_id_student_id_status_idx" ON "subscriptions"("academy_id", "student_id", "status");

-- CreateIndex
CREATE INDEX "sessions_academy_id_scheduled_start_status_idx" ON "sessions"("academy_id", "scheduled_start", "status");

-- CreateIndex
CREATE INDEX "sessions_teacher_id_scheduled_start_idx" ON "sessions"("teacher_id", "scheduled_start");

-- CreateIndex
CREATE INDEX "sessions_recurrence_group_id_idx" ON "sessions"("recurrence_group_id");

-- CreateIndex
CREATE INDEX "session_students_student_id_attendance_status_idx" ON "session_students"("student_id", "attendance_status");

-- CreateIndex
CREATE UNIQUE INDEX "session_students_session_id_student_id_key" ON "session_students"("session_id", "student_id");

-- CreateIndex
CREATE INDEX "session_join_clicks_session_id_clicked_at_idx" ON "session_join_clicks"("session_id", "clicked_at");

-- CreateIndex
CREATE INDEX "invoices_academy_id_status_created_at_idx" ON "invoices"("academy_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "invoices_provider_provider_reference_idx" ON "invoices"("provider", "provider_reference");

-- CreateIndex
CREATE UNIQUE INDEX "payment_attempts_idempotency_key_key" ON "payment_attempts"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "payment_attempts_raw_event_hash_key" ON "payment_attempts"("raw_event_hash");

-- CreateIndex
CREATE INDEX "payment_attempts_invoice_id_status_idx" ON "payment_attempts"("invoice_id", "status");

-- CreateIndex
CREATE INDEX "payment_attempts_provider_provider_reference_idx" ON "payment_attempts"("provider", "provider_reference");

-- CreateIndex
CREATE INDEX "subscription_ledger_subscription_id_created_at_idx" ON "subscription_ledger"("subscription_id", "created_at");

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_academy_id_fkey" FOREIGN KEY ("academy_id") REFERENCES "academies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_academy_id_fkey" FOREIGN KEY ("academy_id") REFERENCES "academies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "teachers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_replacement_for_session_id_fkey" FOREIGN KEY ("replacement_for_session_id") REFERENCES "sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_students" ADD CONSTRAINT "session_students_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_students" ADD CONSTRAINT "session_students_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_students" ADD CONSTRAINT "session_students_overridden_by_fkey" FOREIGN KEY ("overridden_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_join_clicks" ADD CONSTRAINT "session_join_clicks_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_join_clicks" ADD CONSTRAINT "session_join_clicks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_academy_id_fkey" FOREIGN KEY ("academy_id") REFERENCES "academies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_ledger" ADD CONSTRAINT "subscription_ledger_academy_id_fkey" FOREIGN KEY ("academy_id") REFERENCES "academies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_ledger" ADD CONSTRAINT "subscription_ledger_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_ledger" ADD CONSTRAINT "subscription_ledger_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
