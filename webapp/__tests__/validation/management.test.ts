import {
  enrollmentSchema,
  guardianCreateSchema,
  privilegedUserCreateSchema,
  studentCreateSchema,
  subjectCreateSchema,
  subjectUpdateSchema,
  teacherSubjectSchema,
} from "../../lib/validation/management";

describe("management validation", () => {
  it("accepts a privileged account with a strong password", () => {
    expect(privilegedUserCreateSchema.safeParse({
      username: "ops_supervisor",
      displayName: "Operations Supervisor",
      password: "secure-password-123",
      role: "SUPERVISOR",
    }).success).toBe(true);
  });

  it("rejects invalid subject slugs", () => {
    expect(subjectCreateSchema.safeParse({
      slug: "Arabic Quran",
      nameAr: "القرآن",
      nameEn: "Quran",
    }).success).toBe(false);
  });

  it("allows activation changes without requiring replacement fields", () => {
    expect(subjectUpdateSchema.safeParse({ isActive: false }).success).toBe(true);
  });

  it("requires a valid guardian relationship", () => {
    expect(guardianCreateSchema.safeParse({
      username: "guardian_one",
      displayName: "Guardian One",
      password: "secure-password-123",
      relationship: "SIBLING",
    }).success).toBe(false);
  });

  it("accepts a student linked to a guardian", () => {
    expect(studentCreateSchema.safeParse({
      username: "student_one",
      displayName: "Student One",
      password: "secure-password-123",
      guardianId: "11111111-1111-4111-8111-111111111111",
      isAdult: false,
    }).success).toBe(true);
  });

  it("requires both sides of relationship and enrollment mutations", () => {
    expect(teacherSubjectSchema.safeParse({ teacherId: "bad", subjectId: "bad" }).success).toBe(false);
    expect(enrollmentSchema.safeParse({ sessionId: "bad", studentId: "bad" }).success).toBe(false);
  });
});
