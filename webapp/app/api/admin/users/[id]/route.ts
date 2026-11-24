import { NextResponse } from "next/server";
import type { Prisma } from "../../../../../generated/prisma/client";

import { requireApiRoles } from "../../../../../lib/dal";
import { prisma } from "../../../../../lib/prisma";
import { accountUserUpdateSchema } from "../../../../../lib/validation/management";
import { errorResponse, isUuidParam, requireSameOrigin } from "../../../../../lib/request";
import { resolveAdultStatus } from "../../../../../lib/validation/birth-date";
import { recordAccountSecurityEvent } from "../../../../../lib/notifications/security-notices";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const crossOrigin = requireSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  const { user, error } = await requireApiRoles(["ADMIN", "SUPERVISOR"]);
  if (error) return error;

  const { id } = await params;
  if (!isUuidParam(id)) return errorResponse(400, "VALIDATION_ERROR", "Invalid identifier.");

  const parsed = accountUserUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid account data.",
          fields: parsed.error.flatten().fieldErrors,
        },
      },
      { status: 400 },
    );
  }

  const target = await prisma.user.findFirst({
    where: {
      id,
      academyId: user.academyId,
      ...(user.role === "SUPERVISOR" ? { role: { not: "ADMIN" as const } } : {}),
    },
    select: {
      id: true,
      username: true,
      displayName: true,
      email: true,
      phone: true,
      role: true,
      isActive: true,
      timezone: true,
      dateOfBirth: true,
      preferredLanguage: true,
      announcementsOptOut: true,
      teacherProfile: { select: { approvalStatus: true } },
      studentProfile: { select: { isAdult: true, guardianId: true } },
    },
  });

  if (!target) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "User not found." } }, { status: 404 });
  }

  if (parsed.data.announcementsOptOut !== undefined && user.role !== "ADMIN") {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Only an Admin can change the announcements setting." } },
      { status: 403 },
    );
  }

  if (parsed.data.isActive === false && target.id === user.id) {
    return NextResponse.json(
      { error: { code: "SELF_DEACTIVATION_PROHIBITED", message: "You cannot deactivate your own account." } },
      { status: 400 },
    );
  }

  if (target.role === "ADMIN" && parsed.data.isActive === false) {
    const activeAdmins = await prisma.user.count({
      where: { academyId: user.academyId, role: "ADMIN", isActive: true },
    });
    if (activeAdmins <= 1) {
      return NextResponse.json(
        { error: { code: "LAST_ADMIN_PROTECTED", message: "Cannot deactivate the last active administrator." } },
        { status: 400 },
      );
    }
  }

  if (parsed.data.isActive === true && target.teacherProfile?.approvalStatus === "PENDING") {
    return NextResponse.json(
      { error: { code: "TEACHER_PENDING_APPROVAL", message: "Approve this teacher first; approval activates the account." } },
      { status: 409 },
    );
  }

  if (target.role === "STUDENT" && parsed.data.dateOfBirth !== undefined) {
    const isAdult = resolveAdultStatus(parsed.data.dateOfBirth, target.studentProfile?.isAdult);
    if (!isAdult && !target.studentProfile?.guardianId) {
      return NextResponse.json(
        { error: { code: "GUARDIAN_REQUIRED", message: "A minor student needs a guardian. Choose another guardian instead of removing it." } },
        { status: 409 },
      );
    }
  }

  const deactivating = parsed.data.isActive === false && target.isActive === true;
  const activating = parsed.data.isActive === true && target.isActive === false;

  const updateData: Prisma.UserUpdateInput = {
    ...(parsed.data.username ? { username: parsed.data.username.toLowerCase() } : {}),
    ...(parsed.data.displayName !== undefined ? { displayName: parsed.data.displayName } : {}),
    ...(parsed.data.email !== undefined ? { email: parsed.data.email || null } : {}),
    ...(parsed.data.phone !== undefined ? { phone: parsed.data.phone || null } : {}),
    ...(parsed.data.dateOfBirth !== undefined
      ? { dateOfBirth: parsed.data.dateOfBirth ? new Date(parsed.data.dateOfBirth + "T00:00:00Z") : null }
      : {}),
    ...(parsed.data.preferredLanguage !== undefined ? { preferredLanguage: parsed.data.preferredLanguage } : {}),
    ...(parsed.data.timezone !== undefined ? { timezone: parsed.data.timezone, timezoneSource: "ADMIN" } : {}),
    ...(parsed.data.isActive !== undefined ? { isActive: parsed.data.isActive } : {}),
    ...(parsed.data.announcementsOptOut !== undefined ? { announcementsOptOut: parsed.data.announcementsOptOut } : {}),
    ...(deactivating ? { sessionVersion: { increment: 1 } } : {}),
  };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: target.id },
        data: updateData,
        select: { id: true },
      });

      if (target.role === "STUDENT" && parsed.data.dateOfBirth !== undefined) {
        const isAdult = resolveAdultStatus(parsed.data.dateOfBirth, target.studentProfile?.isAdult);
        await tx.student.update({
          where: { userId: target.id },
          data: { isAdult },
          select: { id: true },
        });
      }

      if (deactivating) {
        await recordAccountSecurityEvent(tx, {
          academyId: user.academyId,
          actorUserId: user.id,
          targetUserId: target.id,
          action: "ACCOUNT_DEACTIVATED",
        });
      } else if (activating) {
        await recordAccountSecurityEvent(tx, {
          academyId: user.academyId,
          actorUserId: user.id,
          targetUserId: target.id,
          action: "ACCOUNT_ACTIVATED",
        });
      } else {
        await recordAccountSecurityEvent(tx, {
          academyId: user.academyId,
          actorUserId: user.id,
          targetUserId: target.id,
          action: "ACCOUNT_UPDATED",
        });
      }
    });

    return NextResponse.json({
      data: {
        id: target.id,
        username: parsed.data.username ? parsed.data.username.toLowerCase() : target.username,
        displayName: parsed.data.displayName ?? target.displayName,
        email: parsed.data.email !== undefined ? parsed.data.email || null : target.email,
        phone: parsed.data.phone !== undefined ? parsed.data.phone || null : target.phone,
        role: target.role,
        isActive: parsed.data.isActive ?? target.isActive,
        timezone: parsed.data.timezone ?? target.timezone,
        dateOfBirth: parsed.data.dateOfBirth !== undefined
          ? (parsed.data.dateOfBirth ? new Date(parsed.data.dateOfBirth + "T00:00:00Z") : null)
          : target.dateOfBirth,
        preferredLanguage: parsed.data.preferredLanguage ?? target.preferredLanguage,
        announcementsOptOut: parsed.data.announcementsOptOut ?? target.announcementsOptOut,
      },
    });
  } catch (cause) {
    if (cause && typeof cause === "object" && "code" in cause && cause.code === "P2002") {
      return NextResponse.json(
        { error: { code: "CONFLICT", message: "Username or email is already in use." } },
        { status: 409 },
      );
    }
    throw cause;
  }
}
