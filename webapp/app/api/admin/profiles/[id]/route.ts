import { NextResponse } from "next/server";

import { requireApiRoles } from "../../../../../lib/dal";
import { isPhase7FollowupReady } from "../../../../../lib/phase7/readiness";
import { runSerializable } from "../../../../../lib/credits/reservation";
import { isSession1ReportsReady } from "../../../../../lib/reports/session1-ready";
import { profileUpdateSchema } from "../../../../../lib/validation/management";
import { requireSameOrigin, isUuidParam, errorResponse } from "../../../../../lib/request";
import { isValidTimeZone } from "../../../../../lib/users/timezone";
import { resolveAdultStatus } from "../../../../../lib/validation/birth-date";
import { accountFieldsChanged, recordAccountUpdate, sendPhoneChangeNotice } from "../../../../../lib/notifications/security-notices";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const crossOrigin = requireSameOrigin(request);
  if (crossOrigin) return crossOrigin;
  const { user, error } = await requireApiRoles(["ADMIN", "SUPERVISOR"]);
  if (error) return error;
  const { id } = await params;
  if (!isUuidParam(id)) return errorResponse(400, "VALIDATION_ERROR", "Invalid identifier.");
  const parsed = profileUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid profile data.", fields: parsed.error.flatten().fieldErrors } }, { status: 400 });
  const selectingOptOut = parsed.data.announcementsOptOut !== undefined && user.role === "ADMIN" && await isPhase7FollowupReady();
  // The report_language column arrives with the Session 1 migration (owner applies).
  // Before it lands the selector self-hides and this write is skipped (self-healing).
  const session1Ready = await isSession1ReportsReady();

  try {
    const result = await runSerializable(async tx => {
      const target = await tx.user.findFirst({
        where: { id, academyId: user.academyId, role: { in: ["GUARDIAN", "STUDENT", "TEACHER"] } },
        select: {
          id: true, role: true, isActive: true, displayName: true, phone: true, email: true,
          preferredLanguage: true, timezone: true, timezoneSource: true,
          ...(selectingOptOut ? { announcementsOptOut: true } : {}),
          teacherProfile: { select: { approvalStatus: true } },
        },
      });
      if (!target) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Profile not found." } }, { status: 404 });
      if (parsed.data.announcementsOptOut !== undefined) {
        if (user.role !== "ADMIN") return errorResponse(403, "FORBIDDEN", "Only an Admin can change the announcements setting.");
        if (!selectingOptOut) return errorResponse(409, "MIGRATION_PENDING", "Apply migration 20261026180000 first.");
      }
      // S-02 / D38: only the Admin's approval activates a PENDING teacher.
      if (parsed.data.isActive === true && target.teacherProfile?.approvalStatus === "PENDING") {
        return NextResponse.json({ error: { code: "TEACHER_PENDING_APPROVAL", message: "Approve this teacher first; approval activates the account." } }, { status: 409 });
      }
      // S-03 / D3: manager edits another user's zone (marked ADMIN, meaning academy-managed override, not actor identity).
      if (parsed.data.timezone !== undefined) {
        if (!isValidTimeZone(parsed.data.timezone)) return errorResponse(400, "VALIDATION_ERROR", "A valid time zone is required.");
      }
      if (target.role === "STUDENT" && parsed.data.guardianId !== undefined && parsed.data.guardianId) {
        const guardian = await tx.guardian.findFirst({ where: { id: parsed.data.guardianId, academyId: user.academyId }, select: { id: true } });
        if (!guardian) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Guardian not found." } }, { status: 404 });
      }
      const deactivating = parsed.data.isActive === false && target.isActive === true;
      const activating = parsed.data.isActive === true && target.isActive === false;

      const data = {
        ...(parsed.data.displayName === undefined ? {} : { displayName: parsed.data.displayName }),
        ...(parsed.data.phone === undefined ? {} : { phone: parsed.data.phone || null }),
        ...(parsed.data.email === undefined ? {} : { email: parsed.data.email || null }),
        ...(parsed.data.isActive === undefined ? {} : { isActive: parsed.data.isActive }),
        ...(parsed.data.announcementsOptOut === undefined ? {} : { announcementsOptOut: parsed.data.announcementsOptOut }),
        ...(parsed.data.timezone === undefined ? {} : { timezone: parsed.data.timezone, timezoneSource: "ADMIN" }),
      };
      const updatesStudentProfile = target.role === "STUDENT"
        && (parsed.data.guardianId !== undefined || (session1Ready && parsed.data.reportLanguage !== undefined));
      const studentInvariant = updatesStudentProfile
        ? await tx.student.findUniqueOrThrow({
            where: { userId: id },
            select: { isAdult: true, user: { select: { dateOfBirth: true } } },
          })
        : null;
      const isAdult = studentInvariant
        ? resolveAdultStatus(studentInvariant.user.dateOfBirth, studentInvariant.isAdult)
        : null;
      // D10 (review 2026-10-29, B3): a minor always keeps a guardian; switching to
      // another guardian of the academy is fine, removing it is not. Recalculate
      // from DOB and persist the invariant in this transaction.
      if (parsed.data.guardianId === null && isAdult === false) throw new GuardianRequired();
      const accountChanged = accountFieldsChanged(target, data);
      if (accountChanged) {
        await tx.user.update({
          where: { id }, data: { ...data, ...(deactivating ? { sessionVersion: { increment: 1 } } : {}) }, select: { id: true },
        });
      }
      if (studentInvariant && isAdult !== null) {
        await tx.student.update({
          where: { userId: id },
          data: {
            isAdult,
            ...(parsed.data.guardianId !== undefined ? { guardianId: parsed.data.guardianId } : {}),
            ...(session1Ready && parsed.data.reportLanguage !== undefined ? { reportLanguage: parsed.data.reportLanguage } : {}),
          },
          select: { id: true },
        });
      }
      if (target.role === "GUARDIAN" && parsed.data.relationship !== undefined) await tx.guardian.update({ where: { userId: id }, data: { relationship: parsed.data.relationship } });

      const action = deactivating ? "ACCOUNT_DEACTIVATED" : activating ? "ACCOUNT_ACTIVATED" : "ACCOUNT_UPDATED";
      const phoneNotice = accountChanged ? await recordAccountUpdate(tx, user, target, data, action) : null;
      const responseData = { id, ...data };
      return { responseData, phoneNotice };
    });
    if (result instanceof Response) return result;
    const whatsappDelivery = result.phoneNotice ? (await sendPhoneChangeNotice(result.phoneNotice)).status : undefined;
    return NextResponse.json({ data: result.responseData, whatsappDelivery });
  } catch (cause) {
    if (cause instanceof GuardianRequired) {
      return NextResponse.json({ error: { code: "GUARDIAN_REQUIRED", message: "A minor student needs a guardian. Choose another guardian instead of removing it." } }, { status: 409 });
    }
    if (cause && typeof cause === "object" && "code" in cause && cause.code === "P2034") {
      return errorResponse(409, "CONFLICT", "The profile changed. Refresh and try again.");
    }
    throw cause;
  }
}

class GuardianRequired extends Error {
  constructor() {
    super("A minor student needs a guardian.");
    this.name = "GuardianRequired";
  }
}
