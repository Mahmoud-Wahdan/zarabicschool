import "server-only";

import bcrypt from "bcrypt";
import type { Prisma } from "../generated/prisma/client";

import { generateTemporaryPassword, generateUsername } from "./credentials";
import { prisma } from "./prisma";
import { normalizeUsername, usernameSchema } from "./validation/auth";
import { calculateAge, normalizeEgyptPhone } from "./validation/application";

const bcryptRounds = 12;
const maxUsernameAttempts = 5;

export class ProvisioningError extends Error {
  status: number;
  code: string;
  fieldErrors?: Record<string, string[]>;

  constructor(status: number, code: string, message: string, fieldErrors?: Record<string, string[]>) {
    super(message);
    this.name = "ProvisioningError";
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

export type ApproveInput = {
  applicationId: string;
  adminId: string;
  academyId: string;
  relationship?: "father" | "mother";
  existingGuardianId?: string;
  createGuardian?: {
    full_name: string;
    phone_whatsapp: string;
    relationship: "father" | "mother";
  };
  accounts?: { key: string; username: string }[];
  teachers?: Record<string, Record<string, string>>;
  randomDigits?: () => number;
};

export type ProvisionedAccount = {
  key: string;
  userId: string;
  role: "GUARDIAN" | "STUDENT" | "TEACHER";
  username: string;
  displayName: string;
  tempPassword: string;
  deliveryPhone: string | null;
};

type ApplicationDetails = {
  full_name?: string;
  phone_whatsapp?: string;
  timezone?: string;
  preferred_language?: string;
  children?: { name: string; age: number; subjects: string[] }[];
  date_of_birth?: string;
  subjects?: string[];
  guardian_name?: string;
  guardian_phone?: string;
  guardian_relationship?: "father" | "mother";
};

type ApplicationTypeValue = "GUARDIAN" | "STUDENT" | "TEACHER";

function normalizeRelationship(relationship: "father" | "mother"): "FATHER" | "MOTHER" {
  return relationship === "father" ? "FATHER" : "MOTHER";
}

function expectedAccountKeys(
  applicationType: ApplicationTypeValue,
  hasCreateGuardian: boolean,
  childCount: number
): string[] {
  if (applicationType === "GUARDIAN") {
    return ["guardian", ...Array.from({ length: childCount }, (_, index) => `child-${index}`)];
  }
  if (applicationType === "STUDENT") {
    return hasCreateGuardian ? ["guardian", "student"] : ["student"];
  }
  return ["teacher"];
}

async function resolveSubjectEntries(
  academyId: string,
  entries: string[]
): Promise<Map<string, string>> {
  const subjects = await prisma.subject.findMany({
    where: { academyId, isActive: true },
    select: { id: true, slug: true },
  });
  const bySlug = new Map(subjects.map((subject) => [subject.slug, subject.id]));
  const byId = new Set(subjects.map((subject) => subject.id));

  const resolved = new Map<string, string>();
  const unknown: string[] = [];
  for (const entry of entries) {
    const id = bySlug.get(entry) ?? (byId.has(entry) ? entry : undefined);
    if (!id) {
      unknown.push(entry);
    } else {
      resolved.set(entry, id);
    }
  }
  if (unknown.length > 0) {
    throw new ProvisioningError(
      400,
      "VALIDATION_ERROR",
      "One or more selected subjects are not available.",
      { subjects: [`Unknown subjects: ${unknown.join(", ")}`] }
    );
  }
  return resolved;
}

async function resolveSubjectIds(academyId: string, entries: string[]): Promise<string[]> {
  const resolved = await resolveSubjectEntries(academyId, entries);
  return [...new Set(resolved.values())];
}

type StudentSubjectPlan = {
  subjectIds: string[];
  teacherBySubject: Map<string, string>;
};

async function buildStudentSubjectPlans(
  input: ApproveInput,
  appType: ApplicationTypeValue,
  details: ApplicationDetails
): Promise<Map<string, StudentSubjectPlan>> {
  const plans = new Map<string, StudentSubjectPlan>();
  if (appType !== "GUARDIAN" && appType !== "STUDENT") return plans;

  const childrenSubjects =
    appType === "GUARDIAN"
      ? (details.children ?? []).map((child, index) => ({ key: `child-${index}`, entries: child.subjects ?? [] }))
      : [{ key: "student", entries: details.subjects ?? [] }];

  for (const { key, entries } of childrenSubjects) {
    const entryToSubject = await resolveSubjectEntries(input.academyId, entries);
    const subjectIds = [...new Set(entryToSubject.values())];
    const teacherBySubject = new Map<string, string>();

    const selections = input.teachers?.[key] ?? {};
    for (const [entry, teacherId] of Object.entries(selections)) {
      const subjectId = entryToSubject.get(entry);
      if (!subjectId) {
        throw new ProvisioningError(400, "VALIDATION_ERROR", "Please correct the highlighted fields.", {
          [`teachers.${key}.${entry}`]: ["This subject is not part of the application."],
        });
      }
      if (teacherBySubject.has(subjectId) && teacherBySubject.get(subjectId) !== teacherId) {
        throw new ProvisioningError(400, "VALIDATION_ERROR", "Please correct the highlighted fields.", {
          [`teachers.${key}.${entry}`]: ["Only one teacher per subject can be selected."],
        });
      }
      const teacher = await prisma.teacher.findFirst({
        where: { id: teacherId, academyId: input.academyId, user: { isActive: true } },
        select: { id: true },
      });
      if (!teacher) {
        throw new ProvisioningError(400, "VALIDATION_ERROR", "Please correct the highlighted fields.", {
          [`teachers.${key}.${entry}`]: ["The selected teacher was not found or is not active."],
        });
      }
      const teacherSubject = await prisma.teacherSubject.findFirst({
        where: { academyId: input.academyId, teacherId, subjectId },
        select: { id: true },
      });
      if (!teacherSubject) {
        throw new ProvisioningError(400, "VALIDATION_ERROR", "Please correct the highlighted fields.", {
          [`teachers.${key}.${entry}`]: ["The selected teacher does not teach this subject."],
        });
      }
      teacherBySubject.set(subjectId, teacherId);
    }

    plans.set(key, { subjectIds, teacherBySubject });
  }
  return plans;
}

async function createStudentSubjectsAndAssignments(
  tx: Prisma.TransactionClient,
  input: ApproveInput,
  plans: Map<string, StudentSubjectPlan>,
  accountKey: string,
  studentProfileId: string
): Promise<void> {
  const plan = plans.get(accountKey);
  if (!plan) return;
  if (plan.subjectIds.length > 0) {
    await tx.studentSubject.createMany({
      data: plan.subjectIds.map((subjectId) => ({
        academyId: input.academyId,
        studentId: studentProfileId,
        subjectId,
      })),
      skipDuplicates: true,
    });
  }
  for (const [subjectId, teacherId] of plan.teacherBySubject) {
    await tx.studentTeacherAssignment.create({
      data: {
        academyId: input.academyId,
        studentId: studentProfileId,
        teacherId,
        subjectId,
        status: "ACTIVE",
        createdById: input.adminId,
      },
      select: { id: true },
    });
  }
}

async function resolveUsername(
  tx: Prisma.TransactionClient,
  academyId: string,
  key: string,
  displayName: string,
  overrides: Map<string, string>,
  randomDigits?: () => number
): Promise<string> {
  const override = overrides.get(key);
  if (override !== undefined) {
    const parsed = usernameSchema.safeParse(override);
    if (!parsed.success) {
      throw new ProvisioningError(400, "VALIDATION_ERROR", "Please correct the highlighted fields.", {
        [`accounts.${key}.username`]: [
          "Username must be 3-30 characters using letters, numbers, dots, dashes and underscores.",
        ],
      });
    }
    const normalized = normalizeUsername(parsed.data);
    const taken = await tx.user.findUnique({
      where: { academyId_username: { academyId, username: normalized } },
      select: { id: true },
    });
    if (taken) {
      throw new ProvisioningError(400, "USERNAME_TAKEN", "The chosen username is already in use.", {
        [`accounts.${key}.username`]: ["The chosen username is already in use."],
      });
    }
    return normalized;
  }

  for (let attempt = 0; attempt < maxUsernameAttempts; attempt += 1) {
    const candidate = generateUsername(displayName, randomDigits);
    if (!candidate) {
      throw new ProvisioningError(
        400,
        "USERNAME_REQUIRED",
        "This name has no Latin characters, so an Admin-supplied username is required.",
        { [`accounts.${key}.username`]: ["An Admin-supplied username is required for Arabic-only names."] }
      );
    }
    const taken = await tx.user.findUnique({
      where: { academyId_username: { academyId, username: candidate } },
      select: { id: true },
    });
    if (!taken) {
      return candidate;
    }
  }
  throw new ProvisioningError(
    500,
    "USERNAME_GENERATION_FAILED",
    "Could not generate a unique username after 5 attempts. Please supply usernames manually."
  );
}

export async function approveApplication(input: ApproveInput): Promise<ProvisionedAccount[]> {
  const application = await prisma.application.findUnique({
    where: { id: input.applicationId },
    select: { id: true, academyId: true, applicationType: true, details: true },
  });
  if (!application || application.academyId !== input.academyId) {
    throw new ProvisioningError(404, "APPLICATION_NOT_FOUND", "Application not found.");
  }

  const appType = application.applicationType as ApplicationTypeValue;
  const precheckDetails = application.details as ApplicationDetails;

  if (appType === "GUARDIAN" && !input.relationship) {
    throw new ProvisioningError(400, "VALIDATION_ERROR", "Please correct the highlighted fields.", {
      relationship: ["Guardian relationship (father or mother) is required."],
    });
  }

  let studentAge: number | null = null;
  if (appType === "STUDENT") {
    if (!precheckDetails.date_of_birth) {
      throw new ProvisioningError(400, "VALIDATION_ERROR", "The application has no date of birth.", {
        date_of_birth: ["Date of birth is missing."],
      });
    }
    studentAge = calculateAge(precheckDetails.date_of_birth);
    if (studentAge < 18 && !input.existingGuardianId && !input.createGuardian) {
      throw new ProvisioningError(
        400,
        "GUARDIAN_REQUIRED",
        "A guardian is required for students under 18.",
        { guardian: ["A guardian is required for students under 18."] }
      );
    }
  }

  let teacherSubjectIds: string[] = [];
  if (appType === "TEACHER") {
    teacherSubjectIds = await resolveSubjectIds(input.academyId, precheckDetails.subjects ?? []);
  }

  const studentPlans = await buildStudentSubjectPlans(input, appType, precheckDetails);

  const accountKeys = expectedAccountKeys(
    appType,
    input.createGuardian !== undefined,
    precheckDetails.children?.length ?? 0
  );
  const credentials = new Map<string, { tempPassword: string; passwordHash: string }>();
  for (const key of accountKeys) {
    const tempPassword = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(tempPassword, bcryptRounds);
    credentials.set(key, { tempPassword, passwordHash });
  }

  // Invariant: the conditional claim and ALL creates/links run inside this single
  // transaction. If any later statement fails, the rollback reverts the claim too,
  // so the application returns to NEW/REVIEWED and a retry is possible.
  return prisma.$transaction(async (tx) => {
    const claim = await tx.application.updateMany({
      where: { id: input.applicationId, status: { in: ["NEW", "REVIEWED"] } },
      data: {
        status: "APPROVED",
        approvedById: input.adminId,
        approvedAt: new Date(),
      },
    });
    if (claim.count === 0) {
      throw new ProvisioningError(409, "ALREADY_PROCESSED", "This application has already been processed.");
    }

    const app = await tx.application.findUnique({
      where: { id: input.applicationId },
      select: {
        id: true,
        contactPhone: true,
        contactEmail: true,
        details: true,
      },
    });
    if (!app) {
      throw new ProvisioningError(404, "APPLICATION_NOT_FOUND", "Application not found.");
    }

    const details = app.details as ApplicationDetails;
    const overrides = new Map((input.accounts ?? []).map((account) => [account.key, account.username]));
    const accounts: ProvisionedAccount[] = [];

    if (appType === "GUARDIAN") {
      const guardianUsername = await resolveUsername(
        tx,
        input.academyId,
        "guardian",
        details.full_name ?? "",
        overrides,
        input.randomDigits
      );

      const guardianUser = await tx.user.create({
        data: {
          academyId: input.academyId,
          username: guardianUsername,
          passwordHash: credentials.get("guardian")!.passwordHash,
          displayName: details.full_name ?? "",
          phone: app.contactPhone,
          email: app.contactEmail ?? null,
          role: "GUARDIAN",
          timezone: details.timezone ?? "Africa/Cairo",
          preferredLanguage: details.preferred_language ?? "ar",
        },
        select: { id: true, username: true },
      });

      const guardianProfile = await tx.guardian.create({
        data: {
          userId: guardianUser.id,
          academyId: input.academyId,
          relationship: normalizeRelationship(input.relationship as "father" | "mother"),
        },
        select: { id: true },
      });

      accounts.push({
        key: "guardian",
        userId: guardianUser.id,
        role: "GUARDIAN",
        username: guardianUser.username,
        displayName: details.full_name ?? "",
        tempPassword: credentials.get("guardian")!.tempPassword,
        deliveryPhone: app.contactPhone,
      });

      const children = details.children ?? [];
      for (let index = 0; index < children.length; index += 1) {
        const child = children[index];
        const key = `child-${index}`;
        const childUsername = await resolveUsername(
          tx,
          input.academyId,
          key,
          child.name,
          overrides,
          input.randomDigits
        );

        const childUser = await tx.user.create({
          data: {
            academyId: input.academyId,
            username: childUsername,
            passwordHash: credentials.get(key)!.passwordHash,
            displayName: child.name,
            phone: null,
            email: null,
            role: "STUDENT",
            timezone: details.timezone ?? "Africa/Cairo",
            preferredLanguage: details.preferred_language ?? "ar",
          },
          select: { id: true, username: true },
        });

        const childStudentProfile = await tx.student.create({
          data: {
            userId: childUser.id,
            guardianId: guardianProfile.id,
            isAdult: child.age >= 18,
            academyId: input.academyId,
            enrollmentDate: new Date(),
          },
          select: { id: true },
        });
        await createStudentSubjectsAndAssignments(tx, input, studentPlans, key, childStudentProfile.id);

        accounts.push({
          key,
          userId: childUser.id,
          role: "STUDENT",
          username: childUser.username,
          displayName: child.name,
          tempPassword: credentials.get(key)!.tempPassword,
          deliveryPhone: app.contactPhone,
        });
      }
    }

    if (appType === "STUDENT") {
      let guardianProfileId: string | null = null;

      if (input.createGuardian) {
        const guardianUsername = await resolveUsername(
          tx,
          input.academyId,
          "guardian",
          input.createGuardian.full_name,
          overrides,
          input.randomDigits
        );
        const guardianPhone = normalizeEgyptPhone(input.createGuardian.phone_whatsapp);

        const guardianUser = await tx.user.create({
          data: {
            academyId: input.academyId,
            username: guardianUsername,
            passwordHash: credentials.get("guardian")!.passwordHash,
            displayName: input.createGuardian.full_name,
            phone: guardianPhone,
            email: null,
            role: "GUARDIAN",
            timezone: details.timezone ?? "Africa/Cairo",
            preferredLanguage: details.preferred_language ?? "ar",
          },
          select: { id: true, username: true },
        });

        const guardianProfile = await tx.guardian.create({
          data: {
            userId: guardianUser.id,
            academyId: input.academyId,
            relationship: normalizeRelationship(input.createGuardian.relationship),
          },
          select: { id: true },
        });

        guardianProfileId = guardianProfile.id;
        accounts.push({
          key: "guardian",
          userId: guardianUser.id,
          role: "GUARDIAN",
          username: guardianUser.username,
          displayName: input.createGuardian.full_name,
          tempPassword: credentials.get("guardian")!.tempPassword,
          deliveryPhone: guardianPhone,
        });
      } else if (input.existingGuardianId) {
        const guardian = await tx.guardian.findUnique({
          where: { id: input.existingGuardianId },
          select: { id: true, academyId: true },
        });
        if (!guardian || guardian.academyId !== input.academyId) {
          throw new ProvisioningError(400, "VALIDATION_ERROR", "Please correct the highlighted fields.", {
            existingGuardianId: ["The selected guardian was not found."],
          });
        }
        guardianProfileId = guardian.id;
      }

      const studentUsername = await resolveUsername(
        tx,
        input.academyId,
        "student",
        details.full_name ?? "",
        overrides,
        input.randomDigits
      );

      const studentUser = await tx.user.create({
        data: {
          academyId: input.academyId,
          username: studentUsername,
          passwordHash: credentials.get("student")!.passwordHash,
          displayName: details.full_name ?? "",
          phone: app.contactPhone,
          email: app.contactEmail ?? null,
          role: "STUDENT",
          timezone: details.timezone ?? "Africa/Cairo",
          preferredLanguage: details.preferred_language ?? "ar",
        },
        select: { id: true, username: true },
      });

      const studentProfile = await tx.student.create({
        data: {
          userId: studentUser.id,
          guardianId: guardianProfileId,
          isAdult: (studentAge as number) >= 18,
          academyId: input.academyId,
          enrollmentDate: new Date(),
        },
        select: { id: true },
      });
      await createStudentSubjectsAndAssignments(tx, input, studentPlans, "student", studentProfile.id);

      accounts.push({
        key: "student",
        userId: studentUser.id,
        role: "STUDENT",
        username: studentUser.username,
        displayName: details.full_name ?? "",
        tempPassword: credentials.get("student")!.tempPassword,
        deliveryPhone: app.contactPhone,
      });
    }

    if (appType === "TEACHER") {
      const teacherUsername = await resolveUsername(
        tx,
        input.academyId,
        "teacher",
        details.full_name ?? "",
        overrides,
        input.randomDigits
      );

      const teacherUser = await tx.user.create({
        data: {
          academyId: input.academyId,
          username: teacherUsername,
          passwordHash: credentials.get("teacher")!.passwordHash,
          displayName: details.full_name ?? "",
          phone: app.contactPhone,
          email: app.contactEmail ?? null,
          role: "TEACHER",
          timezone: details.timezone ?? "Africa/Cairo",
          preferredLanguage: details.preferred_language ?? "ar",
        },
        select: { id: true, username: true },
      });

      const teacherProfile = await tx.teacher.create({
        data: {
          userId: teacherUser.id,
          academyId: input.academyId,
        },
        select: { id: true },
      });

      if (teacherSubjectIds.length > 0) {
        await tx.teacherSubject.createMany({
          data: teacherSubjectIds.map((subjectId) => ({
            teacherId: teacherProfile.id,
            subjectId,
            academyId: input.academyId,
          })),
        });
      }

      accounts.push({
        key: "teacher",
        userId: teacherUser.id,
        role: "TEACHER",
        username: teacherUser.username,
        displayName: details.full_name ?? "",
        tempPassword: credentials.get("teacher")!.tempPassword,
        deliveryPhone: app.contactPhone,
      });
    }

    // Link created records back to the application (same transaction).
    await tx.applicationRecord.createMany({
      data: accounts.map((account) => ({
        applicationId: app.id,
        userId: account.userId,
        role: account.role,
      })),
    });
    const primaryAccount =
      appType === "GUARDIAN" ? accounts[0] : accounts[accounts.length - 1];
    await tx.application.update({
      where: { id: app.id },
      data: { approvedUserId: primaryAccount.userId },
    });

    return accounts;
  });
}
