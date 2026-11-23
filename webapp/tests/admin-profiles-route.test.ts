import { GET } from "../app/api/admin/profiles/route";
import { getStudentFinanceStatus } from "../lib/billing/student-finance-status";
import { requireApiRoles } from "../lib/dal";
import { isPhase7FollowupReady } from "../lib/phase7/readiness";
import { prisma } from "../lib/prisma";

jest.mock("../lib/billing/student-finance-status", () => ({ getStudentFinanceStatus: jest.fn() }));
jest.mock("../lib/dal", () => ({ requireApiRoles: jest.fn() }));
jest.mock("../lib/phase7/readiness", () => ({ isPhase7FollowupReady: jest.fn() }));
jest.mock("../lib/prisma", () => ({ prisma: { user: { findMany: jest.fn() } } }));

const mockedFindMany = jest.mocked(prisma.user.findMany);
const mockedFinanceStatus = jest.mocked(getStudentFinanceStatus);
const mockedRequireApiRoles = jest.mocked(requireApiRoles);
const mockedReadiness = jest.mocked(isPhase7FollowupReady);

test("student response uses DOB-derived adult status and stored fallback without DOB", async () => {
  mockedRequireApiRoles.mockResolvedValue({ user: { academyId: "academy-1" }, error: null } as never);
  mockedReadiness.mockResolvedValue(false);
  mockedFindMany.mockResolvedValue([
    {
      id: "dob-student",
      dateOfBirth: new Date("2000-01-01T00:00:00.000Z"),
      studentProfile: { id: "dob-profile", isAdult: false, guardian: null, assignments: [] },
    },
    {
      id: "fallback-student",
      dateOfBirth: null,
      studentProfile: { id: "fallback-profile", isAdult: true, guardian: null, assignments: [] },
    },
  ] as never);
  mockedFinanceStatus.mockResolvedValue(new Map());

  const response = await GET(new Request("http://localhost/api/admin/profiles?type=student"));
  const { data } = await response.json();

  expect(data[0].studentProfile.isAdult).toBe(true);
  expect(data[1].studentProfile.isAdult).toBe(true);
});
