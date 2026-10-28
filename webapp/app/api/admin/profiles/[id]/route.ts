import { NextResponse } from "next/server";

import { requireApiRoles } from "../../../../../lib/dal";
import { isPhase7FollowupReady } from "../../../../../lib/phase7/readiness";
import { prisma } from "../../../../../lib/prisma";
import { isSession1ReportsReady } from "../../../../../lib/reports/session1-ready";
import { profileUpdateSchema } from "../../../../../lib/validation/management";
import { requireSameOrigin, isUuidParam, errorResponse } from "../../../../../lib/request";
import { isValidTimeZone } from "../../../../../lib/users/timezone";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const crossOrigin = requireSameOrigin(request);
  if (crossOrigin) return crossOrigin;
  const { user, error } = await requireApiRoles(["ADMIN", "SUPERVISOR"]);
  if (error) return error;
  const { id } = await params;
  if (!isUuidParam(id)) return errorResponse(400, "VALIDATION_ERROR", "Invalid identifier.");
  const parsed = profileUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid profile data.", fields: parsed.error.flatten().fieldErrors } }, { status: 400 });
  const target = await prisma.user.findFirst({ where: { id, academyId: user.academyId, role: { in: ["GUARDIAN", "STUDENT", "TEACHER"] } }, select: { id: true, role: true, teacherProfile: { select: { approvalStatus: true } } } });
  if (!target) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Profile not found." } }, { status: 404 });
  // S-02 / D38: only the Admin's approval activates a PENDING teacher.
  if (parsed.data.isActive === true && target.teacherProfile?.approvalStatus === "PENDING") {
    return NextResponse.json({ error: { code: "TEACHER_PENDING_APPROVAL", message: "Approve this teacher first; approval activates the account." } }, { status: 409 });
  }
  // S-03 / D3: only the Admin edits another user's zone (marked ADMIN, D39).
  if (parsed.data.timezone !== undefined) {
    if (user.role !== "ADMIN") {
      return NextResponse.json({ error: { code: "FORBIDDEN", message: "Only an Admin can change a time zone." } }, { status: 403 });
    }
    if (!isValidTimeZone(parsed.data.timezone)) return errorResponse(400, "VALIDATION_ERROR", "A valid time zone is required.");
  }
  // The "no announcements" flag is set by an ADMIN only (owner, 2026-10-26).
  if (parsed.data.announcementsOptOut !== undefined) {
    if (user.role !== "ADMIN") {
      return NextResponse.json({ error: { code: "FORBIDDEN", message: "Only an Admin can change the announcements setting." } }, { status: 403 });
    }
    if (!(await isPhase7FollowupReady())) {
      return NextResponse.json({ error: { code: "MIGRATION_PENDING", message: "Apply migration 20261026180000 first." } }, { status: 409 });
    }
  }
  if (target.role === "STUDENT" && parsed.data.guardianId !== undefined && parsed.data.guardianId) {
    const guardian = await prisma.guardian.findFirst({ where: { id: parsed.data.guardianId, academyId: user.academyId }, select: { id: true } });
    if (!guardian) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Guardian not found." } }, { status: 404 });
  }
  // The report_language column arrives with the Session 1 migration (owner applies).
  // Before it lands the selector self-hides and this write is skipped (self-healing).
  const session1Ready = await isSession1ReportsReady();
  const data = {
    ...(parsed.data.displayName === undefined ? {} : { displayName: parsed.data.displayName }),
    ...(parsed.data.phone === undefined ? {} : { phone: parsed.data.phone || null }),
    ...(parsed.data.email === undefined ? {} : { email: parsed.data.email || null }),
    ...(parsed.data.isActive === undefined ? {} : { isActive: parsed.data.isActive }),
    ...(parsed.data.announcementsOptOut === undefined ? {} : { announcementsOptOut: parsed.data.announcementsOptOut }),
    ...(parsed.data.timezone === undefined ? {} : { timezone: parsed.data.timezone, timezoneSource: "ADMIN" }),
  };
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data, select: { id: true } });
    if (target.role === "STUDENT" && (parsed.data.guardianId !== undefined || (session1Ready && parsed.data.reportLanguage !== undefined))) {
      await tx.student.update({
        where: { userId: id },
        data: {
          ...(parsed.data.guardianId !== undefined ? { guardianId: parsed.data.guardianId } : {}),
          ...(session1Ready && parsed.data.reportLanguage !== undefined ? { reportLanguage: parsed.data.reportLanguage } : {}),
        },
        select: { id: true },
      });
    }
    if (target.role === "GUARDIAN" && parsed.data.relationship !== undefined) await tx.guardian.update({ where: { userId: id }, data: { relationship: parsed.data.relationship } });
  });
  return NextResponse.json({ data: { id, ...data } });
}
