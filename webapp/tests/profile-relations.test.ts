import assert from "node:assert/strict";
import test from "node:test";

import { mapProfileRelations } from "../lib/admin/profile-relations";
import { calculateAdultStatus, resolveAdultStatus } from "../lib/validation/birth-date";

test("student mapping returns guardian and only active assignments", () => {
  const result = mapProfileRelations("student", {
    dateOfBirth: new Date("2010-05-10T00:00:00.000Z"),
    studentProfile: {
      guardianId: "g1",
      isAdult: false,
      guardian: { user: { displayName: "Father Name", phone: "123" }, relationship: "FATHER" },
      assignments: [
        { status: "ACTIVE", subjectId: "s1", subject: { nameAr: "رياضيات", nameEn: "Math" }, teacher: { user: { displayName: "Teacher One" } } },
        { status: "ENDED", subjectId: "s2", subject: { nameAr: "علوم", nameEn: "Science" }, teacher: { user: { displayName: "Teacher Two" } } },
      ],
    },
  });

  assert.equal(result.dateOfBirth, "2010-05-10");
  assert.deepEqual(result.guardian, { displayName: "Father Name", phone: "123", relationship: "FATHER" });
  assert.equal(result.activeAssignments.length, 1);
  assert.equal(result.activeAssignments[0].subjectNameEn, "Math");
});

test("guardian mapping keeps only supplied linked children", () => {
  const result = mapProfileRelations("guardian", {
    guardianProfile: {
      students: [
        { id: "child1", isAdult: false, user: { displayName: "Child One", dateOfBirth: new Date("2012-01-01T00:00:00.000Z") }, assignments: [] },
      ],
    },
  });

  assert.deepEqual(result.students.map((student) => student.id), ["child1"]);
});

test("teacher mapping groups active students by subject", () => {
  const result = mapProfileRelations("teacher", {
    teacherProfile: {
      subjects: [{ subject: { id: "math", nameAr: "رياضيات", nameEn: "Math" } }],
      assignments: [
        { status: "ACTIVE", subjectId: "math", subject: { id: "math", nameAr: "رياضيات", nameEn: "Math" }, student: { user: { displayName: "Student One" } } },
        { status: "ENDED", subjectId: "math", subject: { id: "math", nameAr: "رياضيات", nameEn: "Math" }, student: { user: { displayName: "Student Two" } } },
      ],
    },
  });

  assert.equal(result.subjects.length, 1);
  assert.equal(result.subjects[0].nameEn, "Math");
  assert.equal(result.studentsBySubject["math"].length, 1);
  assert.equal(result.studentsBySubject["math"][0].displayName, "Student One");
});

test("missing DOB returns null and uses stored Student isAdult", () => {
  const withMissingDob = mapProfileRelations("student", {
    dateOfBirth: null,
    studentProfile: {
      isAdult: true,
      guardian: null,
      assignments: [],
    },
  });

  assert.equal(withMissingDob.dateOfBirth, null);
  assert.equal(withMissingDob.isAdult, true);

  const guardianChild = mapProfileRelations("guardian", {
    guardianProfile: {
      students: [{ id: "child1", isAdult: true, user: { displayName: "Adult Child", dateOfBirth: null }, assignments: [] }],
    },
  });
  assert.equal(guardianChild.students[0].dateOfBirth, null);
  assert.equal(guardianChild.students[0].isAdult, true);
});


test("adult status uses UTC birthday boundaries for Date values", () => {
  const dateOfBirth = new Date("2008-11-23T00:00:00.000Z");

  assert.equal(calculateAdultStatus(dateOfBirth, new Date("2026-11-22T23:59:59.999Z")), false);
  assert.equal(calculateAdultStatus(dateOfBirth, new Date("2026-11-23T00:00:00.000Z")), true);
});

test("DOB-derived status overrides the stored flag and missing DOB preserves it", () => {
  assert.equal(resolveAdultStatus(new Date("2000-01-01T00:00:00.000Z"), false), true);
  assert.equal(resolveAdultStatus(null, true), true);
  assert.equal(resolveAdultStatus(null, false), false);
});
