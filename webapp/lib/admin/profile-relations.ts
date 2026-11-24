import { resolveAdultStatus } from "../validation/birth-date";

export type StudentRelationSummary = {
  id: string;
  displayName: string;
  dateOfBirth?: string | null;
  isAdult: boolean;
  assignments: {
    subjectId: string;
    subjectNameAr: string;
    subjectNameEn: string;
    teacherName: string;
  }[];
};

export type ProfileRelationRow = {
  dateOfBirth: string | null;
  isAdult?: boolean;
  guardian: { displayName: string; phone: string | null; relationship: string } | null;
  activeAssignments: {
    subjectId: string;
    subjectNameAr: string;
    subjectNameEn: string;
    teacherName: string;
  }[];
  students: StudentRelationSummary[];
  subjects: { id: string; nameAr: string; nameEn: string }[];
  studentsBySubject: Record<string, { id: string; displayName: string; isAdult: boolean }[]>;
};

type RawAssignment = {
  status: string;
  subjectId?: string;
  subject?: { id?: string; nameAr?: string; nameEn?: string };
  teacher?: { user?: { displayName?: string } };
  student?: { id?: string; isAdult?: boolean; user?: { displayName?: string; dateOfBirth?: Date | null } };
};

type RawRow = {
  dateOfBirth?: Date | null;
  studentProfile?: {
    isAdult?: boolean;
    guardianId?: string | null;
    guardian?: { relationship?: string; user?: { displayName?: string; phone?: string | null } } | null;
    assignments?: RawAssignment[];
  } | null;
  guardianProfile?: {
    students?: {
      id: string;
      isAdult: boolean;
      user: { displayName: string; dateOfBirth: Date | null };
      assignments?: RawAssignment[];
    }[];
  } | null;
  teacherProfile?: {
    subjects?: { subject?: { id?: string; nameAr?: string; nameEn?: string } }[];
    assignments?: RawAssignment[];
  } | null;
};

function dateString(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function activeAssignments(assignments: RawAssignment[] | undefined) {
  return (assignments ?? [])
    .filter((assignment) => assignment.status === "ACTIVE")
    .map((assignment) => ({
      subjectId: assignment.subjectId ?? assignment.subject?.id ?? "",
      subjectNameAr: assignment.subject?.nameAr ?? "",
      subjectNameEn: assignment.subject?.nameEn ?? "",
      teacherName: assignment.teacher?.user?.displayName ?? "",
    }));
}

export function mapProfileRelations(role: "student" | "guardian" | "teacher", row: RawRow): ProfileRelationRow {
  const profile = row.studentProfile;
  if (role === "student") {
    const guardian = profile?.guardian;
    return {
      dateOfBirth: dateString(row.dateOfBirth),
      isAdult: resolveAdultStatus(row.dateOfBirth ?? null, profile?.isAdult),
      guardian: guardian ? {
        displayName: guardian.user?.displayName ?? "",
        phone: guardian.user?.phone ?? null,
        relationship: guardian.relationship ?? "",
      } : null,
      activeAssignments: activeAssignments(profile?.assignments),
      students: [],
      subjects: [],
      studentsBySubject: {},
    };
  }

  if (role === "guardian") {
    const students = (row.guardianProfile?.students ?? []).map((student) => ({
      id: student.id,
      displayName: student.user.displayName,
      isAdult: resolveAdultStatus(student.user.dateOfBirth, student.isAdult),
      dateOfBirth: dateString(student.user.dateOfBirth),
      assignments: activeAssignments(student.assignments),
    }));
    return {
      dateOfBirth: null,
      guardian: null,
      activeAssignments: [],
      students,
      subjects: [],
      studentsBySubject: {},
    };
  }

  const subjects = (row.teacherProfile?.subjects ?? [])
    .map((item) => item.subject)
    .filter((subject): subject is { id: string; nameAr: string; nameEn: string } => Boolean(subject?.id))
    .map((subject) => ({ id: subject.id, nameAr: subject.nameAr, nameEn: subject.nameEn }));
  const studentsBySubject: Record<string, { id: string; displayName: string; isAdult: boolean }[]> = {};
  for (const assignment of (row.teacherProfile?.assignments ?? []).filter((item) => item.status === "ACTIVE")) {
    const subjectId = assignment.subjectId ?? assignment.subject?.id;
    if (!subjectId) continue;
    if (!studentsBySubject[subjectId]) studentsBySubject[subjectId] = [];
    studentsBySubject[subjectId].push({
      id: assignment.student?.id ?? "",
      displayName: assignment.student?.user?.displayName ?? "",
      isAdult: resolveAdultStatus(assignment.student?.user?.dateOfBirth ?? null, assignment.student?.isAdult),
    });
  }
  return {
    dateOfBirth: null,
    guardian: null,
    activeAssignments: [],
    students: [],
    subjects,
    studentsBySubject,
  };
}
