import { PATCH } from "../app/api/me/profile/route";
import { requireApiRoles } from "../lib/dal";
import { prisma } from "../lib/prisma";

jest.mock("../lib/dal", () => ({ requireApiRoles: jest.fn() }));
jest.mock("../lib/prisma", () => ({ prisma: { $transaction: jest.fn() } }));

const mockedRequireApiRoles = jest.mocked(requireApiRoles);
const mockedTransaction = jest.mocked(prisma.$transaction);

test("clearing DOB preserves the stored Student.isAdult value", async () => {
  const userId = "11111111-1111-4111-8111-111111111111";
  mockedRequireApiRoles.mockResolvedValue({
    user: { id: userId, academyId: "academy-1", role: "STUDENT" },
    error: null,
  } as never);

  const tx = {
    user: { update: jest.fn().mockResolvedValue({ id: userId }) },
    student: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({ isAdult: true }),
      update: jest.fn().mockResolvedValue({ id: "student-1" }),
    },
  };
  mockedTransaction.mockImplementation(async (operation) => {
    if (typeof operation !== "function") throw new Error("Expected interactive transaction");
    return operation(tx as never);
  });

  const response = await PATCH(new Request("http://localhost/api/me/profile", {
    method: "PATCH",
    headers: { origin: "http://localhost", host: "localhost", "content-type": "application/json" },
    body: JSON.stringify({ dateOfBirth: "" }),
  }));

  expect(response.status).toBe(200);
  expect(tx.student.update).toHaveBeenCalledWith({
    where: { userId },
    data: { isAdult: true },
    select: { id: true },
  });
  expect(tx.student.findUniqueOrThrow).toHaveBeenCalledWith({
    where: { userId },
    select: { isAdult: true },
  });
});
