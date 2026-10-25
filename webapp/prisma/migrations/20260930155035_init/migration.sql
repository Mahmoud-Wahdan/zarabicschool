-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'TEACHER', 'STUDENT', 'GUARDIAN');

-- CreateEnum
CREATE TYPE "ApplicationType" AS ENUM ('GUARDIAN', 'STUDENT', 'TEACHER');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('NEW', 'REVIEWED', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "academies" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "academies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "academy_id" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT,
    "password_hash" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "phone" TEXT,
    "role" "UserRole" NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Cairo',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "must_change_password" BOOLEAN NOT NULL DEFAULT true,
    "password_changed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subjects" (
    "id" UUID NOT NULL,
    "academy_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "subjects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "applications" (
    "id" UUID NOT NULL,
    "academy_id" UUID NOT NULL,
    "application_type" "ApplicationType" NOT NULL,
    "details" JSONB NOT NULL,
    "contact_phone" TEXT NOT NULL,
    "contact_email" TEXT,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'NEW',
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "approved_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "applications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "academies_name_key" ON "academies"("name");

-- CreateIndex
CREATE INDEX "users_academy_id_idx" ON "users"("academy_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_academy_id_username_key" ON "users"("academy_id", "username");

-- CreateIndex
CREATE UNIQUE INDEX "subjects_academy_id_name_key" ON "subjects"("academy_id", "name");

-- CreateIndex
CREATE INDEX "applications_academy_id_status_created_at_idx" ON "applications"("academy_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "applications_contact_phone_application_type_created_at_idx" ON "applications"("contact_phone", "application_type", "created_at");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_academy_id_fkey" FOREIGN KEY ("academy_id") REFERENCES "academies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_academy_id_fkey" FOREIGN KEY ("academy_id") REFERENCES "academies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_academy_id_fkey" FOREIGN KEY ("academy_id") REFERENCES "academies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_approved_user_id_fkey" FOREIGN KEY ("approved_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
