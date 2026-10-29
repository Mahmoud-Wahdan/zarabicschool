import bcrypt from "bcrypt";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getStudentFinanceStatus } from "../../../../lib/billing/student-finance-status";
import { requireApiRoles } from "../../../../lib/dal";
import { isPhase7FollowupReady } from "../../../../lib/phase7/readiness";
import { prisma } from "../../../../lib/prisma";
import {
  guardianCreateSchema,
  studentCreateSchema,
  teacherCreateSchema,
} from "../../../../lib/validation/management";

import { requireSameOrigin } from "../../../../lib/request";
const roleConfig = {
  guardian: { role: "GUARDIAN" as const, schema: guardianCreateSchema },
  student: { role: "STUDENT" as const, schema: studentCreateSchema },
  teacher: { role: "TEACHER" as const, schema: teacherCreateSchema },
};

// B2 (S2): `type` is validated against the three known keys BEFORE any lookup. A
// raw `roleConfig[type]` let `?type=constructor` resolve to Object's constructor —
// `role` became undefined, Prisma dropped the filter, and the list returned every
// user of the academy (Admins/Supervisors included). Unknown → null → 400.
const profileTypeSchema = z.enum(["guardian", "student", "teacher"]);
function profileType(request: Request) {
  const parsed = profileTypeSchema.safeParse(new URL(request.url).searchParams.get("type"));
  return parsed.success ? parsed.data : null;
}

export async function GET(request: Request) {
  const { user, error } = await requireApiRoles(["ADMIN", "SUPERVISOR"]);
  if (error) return error;
  const type = profileType(request);
  if (!type) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Unknown profile type." } }, { status: 400 });
  const config = roleConfig[type];
<<<<<<< HEAD
  const optOutReady = await isPhase7FollowupReady();
=======
>>>>>>> a36b92a5884fce32fbf1247ff19460553cbdf488
  const rows = await prisma.user.findMany({
    where: { academyId: user.academyId, role: config.role },
    orderBy: { displayName: "asc" },
    select: {
      id: true, username: true, displayName: true, phone: true, email: true, isActive: true,
      ...(optOutReady ? { announcementsOptOut: true } : {}),
      guardianProfile: { select: { id: true, relationship: true, students: { select: { id: true } } } },
      studentProfile: { select: { id: true, guardianId: true, isAdult: true, enrollmentDate: true, reportLanguage: true } },
      teacherProfile: { select: { id: true, approvalStatus: true, subjects: { select: { subjectId: true } } } },
    },
  });
  if (type !== "student") return NextResponse.json({ data: rows });
  // S-09 / D29: paid/unpaid + remaining sessions per student from the separate
  // amount-free read model (Admin and Supervisor; never a money field).
  const studentIds = rows.flatMap((row) => (row.studentProfile ? [row.studentProfile.id] : []));
  const finance = await getStudentFinanceStatus(user.academyId, studentIds);
  return NextResponse.json({
    data: rows.map((row) => ({
      ...row,
      financeStatus: row.studentProfile ? finance.get(row.studentProfile.id) ?? null : null,
    })),
  });
}

export async function POST(request: Request) {
  const crossOrigin = requireSameOrigin(request);
  if (crossOrigin) return crossOrigin;
  const { user, error } = await requireApiRoles(["ADMIN", "SUPERVISOR"]);
  if (error) return error;
  const type = profileType(request);
  if (!type) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Unknown profile type." } }, { status: 400 });
  const config = roleConfig[type];
  const parsed = config.schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid profile data.", fields: parsed.error.flatten().fieldErrors } }, { status: 400 });
  const input = parsed.data;
  // D10: a minor student needs a guardian (server-enforced, both roles).
  if (type === "student" && "isAdult" in input && !input.isAdult && !("guardianId" in input && input.guardianId)) {
    return NextResponse.json({ error: { code: "GUARDIAN_REQUIRED", message: "A minor student needs a guardian." } }, { status: 400 });
  }
  // D9 / D38: the Admin adds a teacher with a rate (approved); a Supervisor adds one
  // without a rate → PENDING and inactive (cannot log in) until the Admin approves.
  const teacherRate = type === "teacher" && "rate" in input ? input.rate : undefined;
  if (type === "teacher" && user.role === "ADMIN" && !teacherRate) {
    return NextResponse.json({ error: { code: "RATE_REQUIRED", message: "A teacher added by the Admin needs a rate." } }, { status: 400 });
  }
  if (type === "teacher" && user.role !== "ADMIN" && teacherRate) {
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "Only the Admin sets a teacher's rate." } }, { status: 403 });
  }
  const pendingTeacher = type === "teacher" && user.role !== "ADMIN";
  try {
    const created = await prisma.$transaction(async (tx) => {
      const guardianInput = type === "guardian" ? guardianCreateSchema.parse(input) : null;
      const studentInput = type === "student" ? studentCreateSchema.parse(input) : null;
      if (type === "student" && "guardianId" in input && input.guardianId) {
        const guardian = await tx.guardian.findFirst({ where: { id: input.guardianId, academyId: user.academyId, user: { isActive: true } }, select: { id: true } });
        if (!guardian) throw new Error("GUARDIAN_NOT_FOUND");
      }
      const account = await tx.user.create({
        data: {
          academyId: user.academyId, username: input.username.toLowerCase(), displayName: input.displayName,
          passwordHash: await bcrypt.hash(input.password, 12), role: config.role,
          phone: input.phone || null, email: input.email || null, mustChangePassword: true,
<<<<<<< HEAD
          ...(pendingTeacher ? { isActive: false } : {}),
=======
>>>>>>> a36b92a5884fce32fbf1247ff19460553cbdf488
          passwordSetById: user.id, passwordSetAt: new Date(), // B4 audit: Admin-set initial password
          ...(guardianInput ? { guardianProfile: { create: { academyId: user.academyId, relationship: guardianInput.relationship } } } : {}),
          ...(studentInput ? { studentProfile: { create: { academyId: user.academyId, guardianId: studentInput.guardianId ?? null, isAdult: studentInput.isAdult, enrollmentDate: studentInput.enrollmentDate ? new Date(studentInput.enrollmentDate) : null, ...(studentInput.reportLanguage ? { reportLanguage: studentInput.reportLanguage } : {}) } } } : {}),
          ...(type === "teacher"
            ? { teacherProfile: { create: pendingTeacher
                ? { academyId: user.academyId, approvalStatus: "PENDING" }
                : { academyId: user.academyId, approvalStatus: "APPROVED", approvedById: user.id, approvedAt: new Date() } } }
            : {}),
        },
        select: { id: true, username: true, displayName: true, role: true, isActive: true, teacherProfile: { select: { id: true } } },
      });
      if (account.teacherProfile && teacherRate) {
        await tx.teacherRate.create({
          data: { academyId: user.academyId, teacherId: account.teacherProfile.id, hourlyRateMinor: teacherRate.hourlyRateMinor, currency: teacherRate.currency, effectiveFrom: new Date(teacherRate.effectiveFrom), createdById: user.id },
        });
      }
      if (account.teacherProfile && pendingTeacher) {
        const admins = await tx.user.findMany({ where: { academyId: user.academyId, role: "ADMIN", isActive: true }, select: { id: true } });
        await tx.notificationJob.createMany({
          data: admins.map((admin) => ({
            academyId: user.academyId, sessionId: null, recipientUserId: admin.id, kind: "TEACHER_PENDING_APPROVAL",
            dedupKey: `TEACHER_PENDING_APPROVAL:${account.teacherProfile!.id}:${admin.id}`, scheduledFor: new Date(),
            payload: { teacherId: account.teacherProfile!.id },
          })),
          skipDuplicates: true,
        });
      }
      const { teacherProfile: _profile, ...publicAccount } = account;
      void _profile;
      return publicAccount;
    });
    return NextResponse.json({ data: created }, { status: 201 });
  } catch (cause) {
    if (cause instanceof Error && cause.message === "GUARDIAN_NOT_FOUND") return NextResponse.json({ error: { code: "NOT_FOUND", message: "Guardian not found in this academy." } }, { status: 404 });
    if (cause && typeof cause === "object" && "code" in cause && cause.code === "P2002") return NextResponse.json({ error: { code: "CONFLICT", message: "Username already exists in this academy." } }, { status: 409 });
    throw cause;
  }
}
