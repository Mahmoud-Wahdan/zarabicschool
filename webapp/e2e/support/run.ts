import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/** Everything the fixture created for this run (e2e/support/fixture.ts). */
export type RunFile = {
  marker: string;
  password: string;
  fixtures: {
    suffix: string;
    academyId: string;
    foreignAcademyId: string;
    adminUserId: string;
    supervisorUserId: string;
    teacherUserId: string;
    teacher2UserId: string;
    guardianUserId: string;
    studentUserIds: Record<string, string>;
    teacherProfileId: string;
    teacher2ProfileId: string;
    guardianProfileId: string;
    studentProfileIds: Record<string, string>;
    foreignStudentProfileId: string;
    subjectId: string;
    foreignSubjectId: string;
  };
  users: Record<
    "admin" | "supervisor" | "teacher" | "teacher2" | "guardian" | "student" | "student2" | "adult" | "mustChange" | "rateLimited" | "foreignAdmin",
    string
  >;
  ids: Record<
    | "reportSession"
    | "approvalSession"
    | "absentSession"
    | "soonSession"
    | "futureSession"
    | "adultInvoice"
    | "adultSpareInvoice"
    | "familyInvoice"
    | "application",
    string
  >;
};

export const FIXTURE_FILE = process.env.E2E_FIXTURE ?? "e2e/.run/fixture.json";
export const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

let cached: RunFile | null = null;
/** Read lazily: test files are collected before global setup writes the file. */
export function run(): RunFile {
  cached ??= JSON.parse(readFileSync(FIXTURE_FILE, "utf8")) as RunFile;
  return cached;
}

/** The signed-in roles (one browser state each, written by auth.setup.ts). */
export const ROLES = ["admin", "supervisor", "teacher", "guardian", "student", "adult"] as const;
export type RoleKey = (typeof ROLES)[number];

/** Dashboard each role lands on. "student" has a guardian; "adult" pays for themselves. */
export const ROLE_HOME: Record<RoleKey, string> = {
  admin: "/admin",
  supervisor: "/supervisor",
  teacher: "/teacher",
  guardian: "/guardian",
  student: "/student",
  adult: "/student",
};

export const statePath = (role: RoleKey) => `e2e/.run/state-${role}.json`;

/**
 * A stable documentation-range address (RFC 5737) per simulated client. The app reads
 * the client address from X-Forwarded-For (lib/request.ts getClientIp), as it would
 * behind the reverse proxy; one address per role keeps each role's 120/min and 5
 * logins/10 min budgets separate, the way separate people would have them.
 */
export function clientIp(label: string): string {
  const digest = createHash("sha256").update(label).digest();
  const net = digest[0] % 2 === 0 ? "198.51.100" : "203.0.113";
  return `${net}.${1 + (digest[1] % 250)}`;
}
