/**
 * Measurement fixture (L1, 2026-10-28). Creates ONE per-run test academy
 * ("Zarabicschool Test <8hex>", the same helper the test suites use) with every
 * role, a few sessions this week and today, and writes the usernames to the JSON
 * file named by PERF_FIXTURE. Never touches the seed academy. The password is the
 * test-fixture password, not a real credential.
 *
 *   npx tsx --require ./scripts/perf/server-only-shim.cjs scripts/perf/fixture.ts create
 *   npx tsx --require ./scripts/perf/server-only-shim.cjs scripts/perf/fixture.ts cleanup
 */
import { readFileSync, writeFileSync } from "node:fs";

import { cleanupSessionFixtures, closePrisma, createSessionFixtures } from "../../tests/helpers/session-fixtures";
import { prisma } from "../../lib/prisma";

const file = process.env.PERF_FIXTURE ?? "perf-fixture.json";

async function create() {
  const fx = await createSessionFixtures();
  // Written first, so a failure below can still be cleaned up with "cleanup".
  writeFileSync(file, JSON.stringify({ fixtures: fx, users: {} }));
  const now = Date.now();
  const hour = 3600 * 1000;
  // Sessions from three days ago to three days ahead, including today, for the teacher.
  for (let offset = -3; offset <= 3; offset++) {
    const start = new Date(now + offset * 24 * hour + 2 * hour);
    await prisma.session.create({
      data: {
        academyId: fx.academyId, teacherId: fx.teacherProfileId, subjectId: fx.subjectId, sessionType: "PRIVATE",
        scheduledStart: start, scheduledEnd: new Date(start.getTime() + hour), durationMinutes: 60, timezone: "Africa/Cairo",
        zoomJoinUrl: "https://zoom.us/j/345678901234", createdById: fx.adminUserId, status: offset < 0 ? "COMPLETED" : "SCHEDULED",
        students: { create: [{ studentId: fx.studentProfileIds.student1 }] },
      },
    });
  }
  const users = await prisma.user.findMany({ where: { academyId: fx.academyId }, select: { username: true, role: true } });
  const pick = (role: string) => users.find((user) => user.role === role)!.username;
  writeFileSync(file, JSON.stringify({ fixtures: fx, users: { ADMIN: pick("ADMIN"), SUPERVISOR: pick("SUPERVISOR"), TEACHER: pick("TEACHER"), STUDENT: users.find((user) => user.username.includes("_student1_"))!.username, GUARDIAN: pick("GUARDIAN") } }, null, 2));
  console.log(`fixture written to ${file}`);
}

async function cleanup() {
  const { fixtures } = JSON.parse(readFileSync(file, "utf8"));
  await cleanupSessionFixtures(fixtures);
  console.log("fixture removed");
}

(process.argv[2] === "cleanup" ? cleanup() : create())
  .catch((cause) => {
    console.error(cause instanceof Error ? cause.message : cause);
    process.exitCode = 1;
  })
  .finally(() => closePrisma());
