jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));

jest.mock("next-intl/server", () => ({
  getLocale: jest.fn().mockResolvedValue("ar"),
}));

import { getServerSession } from "next-auth";

import { GET as listInvoicesRoute } from "../../app/api/invoices/route";
import { GET as getInvoiceRoute } from "../../app/api/invoices/[id]/route";
import { prisma } from "../../lib/prisma";
import {
  cleanupSessionFixtures,
  createSessionFixtures,
  closePrisma,
  type SessionFixtures,
} from "../helpers/session-fixtures";

const getServerSessionMock = getServerSession as jest.Mock;

jest.setTimeout(180_000);

let fx: SessionFixtures;
let adultUser: { id: string };
let adultStudent: { id: string };

function asActor(userId: string) {
  getServerSessionMock.mockResolvedValue({ user: { id: userId } });
}

function apiRequest(path: string) {
  return new Request(`http://localhost:3000${path}`, { method: "GET" });
}

async function createInvoice(studentProfileId: string, overrides: Record<string, unknown> = {}) {
  return prisma.invoice.create({
    data: {
      academyId: fx.academyId,
      studentId: studentProfileId,
      amountMinor: BigInt(80000),
      currency: "EGP",
      provider: "PAYMOB",
      packageType: "MONTHLY_PLAN",
      sessionsPurchased: 8,
      status: "PENDING",
      ...overrides,
    },
    select: { id: true, studentId: true, status: true },
  });
}

beforeAll(async () => {
  fx = await createSessionFixtures();
  // The fixture students all share one guardian; the finance wall permits only an
  // ADULT student without a guardian, created inline (same pattern as reports.test.ts).
  adultUser = await prisma.user.create({
    data: {
      academyId: fx.academyId,
      username: `demo_test_adult_${fx.suffix}`,
      displayName: "Demo Test Endpoints Adult",
      passwordHash: "x".repeat(60),
      role: "STUDENT",
      phone: "+201000000043",
      timezone: "Africa/Cairo",
      isActive: true,
      mustChangePassword: false,
    },
    select: { id: true },
  });
  adultStudent = await prisma.student.create({
    data: { userId: adultUser.id, academyId: fx.academyId, guardianId: null, isAdult: true, enrollmentDate: new Date() },
    select: { id: true },
  });
  await createInvoice(adultStudent.id);
  await createInvoice(fx.studentProfileIds.student2);
});

afterAll(async () => {
  if (fx) await cleanupSessionFixtures(fx);
  await closePrisma();
});

describe("Session 1 — server-side finance wall on the invoice GET endpoints", () => {
  it("INT-FIN-05: GET /api/invoices as a student WITH a guardian rejects with 403 FORBIDDEN", async () => {
    asActor(fx.studentUserIds.student1);
    const response = await listInvoicesRoute(apiRequest("/api/invoices"));
    const body = await response.json();
    expect(response.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("INT-FIN-06: GET /api/invoices as an adult student without a guardian returns 200 with only their own invoices", async () => {
    asActor(adultUser.id);
    const response = await listInvoicesRoute(apiRequest("/api/invoices"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].studentId).toBe(adultStudent.id);
    expect(body.data[0].amountMinor).toBe("80000");
  });

  it("INT-FIN-07: GET /api/invoices as a supervisor rejects with 403 (no money access)", async () => {
    asActor(fx.supervisorUserId);
    const response = await listInvoicesRoute(apiRequest("/api/invoices"));
    const body = await response.json();
    expect(response.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("INT-FIN-08: GET /api/invoices/[id] as a student WITH a guardian rejects with 403", async () => {
    const invoice = await prisma.invoice.findFirstOrThrow({
      where: { academyId: fx.academyId, studentId: fx.studentProfileIds.student2 },
      select: { id: true },
    });
    asActor(fx.studentUserIds.student1);
    const response = await getInvoiceRoute(apiRequest(`/api/invoices/${invoice.id}`), {
      params: Promise.resolve({ id: invoice.id }),
    });
    const body = await response.json();
    expect(response.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("INT-FIN-09: GET /api/invoices/[id] as a supervisor rejects with 403", async () => {
    const invoice = await prisma.invoice.findFirstOrThrow({
      where: { academyId: fx.academyId, studentId: fx.studentProfileIds.student2 },
      select: { id: true },
    });
    asActor(fx.supervisorUserId);
    const response = await getInvoiceRoute(apiRequest(`/api/invoices/${invoice.id}`), {
      params: Promise.resolve({ id: invoice.id }),
    });
    const body = await response.json();
    expect(response.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
  });
});
