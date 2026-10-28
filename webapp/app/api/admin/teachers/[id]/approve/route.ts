import bcrypt from "bcrypt";
import { NextResponse } from "next/server";
import { z } from "zod";

import { generateTemporaryPassword } from "../../../../../../lib/credentials";
import { requireApiRole } from "../../../../../../lib/dal";
import { getMessagingProvider } from "../../../../../../lib/messaging/provider";
import { prisma } from "../../../../../../lib/prisma";
import { errorResponse, isUuidParam, requireSameOrigin } from "../../../../../../lib/request";
import { teacherInitialRateSchema } from "../../../../../../lib/validation/management";

export const runtime = "nodejs";

const approveSchema = z.object({ rate: teacherInitialRateSchema });

/**
 * POST /api/admin/teachers/[id]/approve — Admin only (S-02, D9/D38): a PENDING
 * teacher (added by a Supervisor) gets the rate, becomes APPROVED and active, and
 * receives fresh credentials (a new temporary password, change on first login).
 * The password is never stored in plain text, logged, or returned.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const { user, error } = await requireApiRole("ADMIN");
  if (error) return error;
  const { id } = await params;
  if (!isUuidParam(id)) return errorResponse(400, "VALIDATION_ERROR", "Invalid teacher identifier.");
  const parsed = approveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse(400, "VALIDATION_ERROR", "A valid rate is required to approve a teacher.");
  const teacher = await prisma.teacher.findFirst({
    where: { id, academyId: user.academyId },
    select: { id: true, approvalStatus: true, user: { select: { id: true, username: true, phone: true } } },
  });
  if (!teacher) return errorResponse(404, "NOT_FOUND", "Teacher was not found.");
  if (teacher.approvalStatus !== "PENDING") return errorResponse(409, "NOT_PENDING", "This teacher is already approved.");

  const tempPassword = generateTemporaryPassword();
  const passwordHash = await bcrypt.hash(tempPassword, 12);
  const rate = parsed.data.rate;
  const now = new Date();
  const approved = await prisma.$transaction(async (tx) => {
    const moved = await tx.teacher.updateMany({
      where: { id: teacher.id, approvalStatus: "PENDING" },
      data: { approvalStatus: "APPROVED", approvedById: user.id, approvedAt: now },
    });
    if (moved.count === 0) return false;
    await tx.teacherRate.create({
      data: { academyId: user.academyId, teacherId: teacher.id, hourlyRateMinor: rate.hourlyRateMinor, currency: rate.currency, effectiveFrom: new Date(rate.effectiveFrom), createdById: user.id },
    });
    await tx.user.update({
      where: { id: teacher.user.id },
      data: { isActive: true, passwordHash, mustChangePassword: true, passwordSetById: user.id, passwordSetAt: now },
    });
    return true;
  });
  if (!approved) return errorResponse(409, "NOT_PENDING", "This teacher is already approved.");

  // Credentials delivery (same pattern as the application approval): a failure is
  // recorded without the password and never rolls back the approval.
  try {
    const academyName = (await prisma.academy.findUnique({ where: { id: user.academyId }, select: { name: true } }))?.name;
    const result = await getMessagingProvider().sendCredentials(
      { userId: teacher.user.id, phone: teacher.user.phone },
      { username: teacher.user.username, tempPassword, academyName },
    );
    if (!result.ok) {
      await prisma.notificationJob.createMany({
        data: [{ academyId: user.academyId, recipientUserId: teacher.user.id, kind: "CREDENTIALS", dedupKey: `CREDENTIALS:${teacher.user.id}:teacher-approval`, scheduledFor: now, status: "FAILED", lastError: result.error ?? "Messaging provider failed." }],
        skipDuplicates: true,
      });
    }
  } catch {
    // Delivery failure must not undo the approval nor reveal the password.
  }
  return NextResponse.json({ data: { teacherId: teacher.id, approvalStatus: "APPROVED" } });
}
