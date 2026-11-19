import test from "node:test";
import assert from "node:assert/strict";
import { summarizeActivity } from "../lib/dashboard/summarize-activity";
import { zonedDayRangeUtc } from "../lib/schedules/recurrence";

test("an empty month has zero counts and undefined rates", () => {
  assert.deepEqual(summarizeActivity([], [], 0, 0), {
    total: 0, completed: 0, missed: 0, hours: 0, missing: 0,
    attendance: null, completion: null, submission: null,
  });
});

test("group lesson hours count once and attendance counts each reported learner", () => {
  const result = summarizeActivity([
    { status: "COMPLETED", _count: 1, _sum: { durationMinutes: 90 } },
    { status: "CANCELLED", _count: 4, _sum: { durationMinutes: 240 } },
    { status: "SCHEDULED", _count: 2, _sum: { durationMinutes: 90 } },
    { status: "MISSED", _count: 1, _sum: { durationMinutes: 45 } },
  ], [{ attendanceOutcome: "ATTENDED", _count: 2 }, { attendanceOutcome: "STUDENT_ABSENT", _count: 1 }], 5, 3);
  assert.deepEqual(result, { total: 4, completed: 1, missed: 1, hours: 1.5, missing: 2,
    completion: 0.25, attendance: 2 / 3, submission: 0.6 });
});

test("fully reported absences produce a measured zero attendance rate", () => {
  const result = summarizeActivity([], [{ attendanceOutcome: "STUDENT_ABSENT", _count: 2 }], 2, 2);
  assert.equal(result.attendance, 0);
  assert.equal(result.submission, 1);
});

test("Cairo October boundaries include the autumn clock change", () => {
  assert.equal(zonedDayRangeUtc("2026-10-01", "Africa/Cairo").start.toISOString(), "2026-09-30T21:00:00.000Z");
  assert.equal(zonedDayRangeUtc("2026-11-01", "Africa/Cairo").start.toISOString(), "2026-10-31T22:00:00.000Z");
});
