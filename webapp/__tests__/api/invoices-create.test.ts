jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));

jest.mock("next-intl/server", () => ({
  getLocale: jest.fn().mockResolvedValue("ar"),
}));

import { getServerSession } from "next-auth";

import { POST as createInvoiceRoute } from "../../app/api/invoices/route";
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

function asActor(userId: string) {
  getServerSessionMock.mockResolvedValue({ user: { id: userId } });
}

function apiRequest(path: string, body?: unknown) {
  return new Request(`http://localhost:3000${path}`, {
    method: "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function usdInvoicePayload(studentId: string, overrides: Record<string, unknown> = {}) {
  return {
    studentId,
    packageType: "MONTHLY_PLAN",
    sessionsPurchased: 8,
    amountMinor: 12000,
    currency: "USD",
    provider: "USD_GATEWAY",
    ...overrides,
  };
}

async function postInvoice(actorId: string, payload: unknown) {
  asActor(actorId);
  const response = await createInvoiceRoute(apiRequest("/api/invoices", payload));
  return { status: response.status, body: await response.json() };
}

beforeAll(async () => {
  fx = await createSessionFixtures();
});

afterAll(async () => {
  if (fx) {
    // ExchangeRate rows (RESTRICT FK to academy) are not covered by the shared
    // fixture cleanup — remove them first.
    await prisma.exchangeRate.deleteMany({ where: { academyId: { in: [fx.academyId, fx.foreignAcademyId] } } });
    await cleanupSessionFixtures(fx);
  }
  await closePrisma();
});

describe("Session 2 — server-side exchange-rate snapshot on invoice creation", () => {
  it("INT-RATE-01: a USD invoice stores the configured USD→EGP rate snapshot and ignores a client-sent rate", async () => {
    const rate = await prisma.exchangeRate.create({
      data: {
        academyId: fx.academyId,
        fromCurrency: "USD",
        toCurrency: "EGP",
        rate: 48.5,
        effectiveFrom: new Date(Date.now() - 60 * 60 * 1000),
        createdById: fx.adminUserId,
      },
    });
    // exchangeRate in the body is NOT part of the schema — an extra client field
    // that must be ignored in favor of the server-side configuration.
    const { status, body } = await postInvoice(
      fx.adminUserId,
      usdInvoicePayload(fx.studentProfileIds.student1, { exchangeRate: "99" }),
    );
    expect(status).toBe(201);
    const row = await prisma.invoice.findUniqueOrThrow({ where: { id: body.data.id } });
    expect(row.currency).toBe("USD");
    expect(parseFloat(String(row.exchangeRate))).toBe(48.5);
    expect(String(row.exchangeRate)).not.toBe("99");
    expect(rate.id).toBeDefined();
  });

  it("INT-RATE-02: with no rate configured the snapshot stays null and the invoice is still created", async () => {
    // The foreign academy fixture has no ExchangeRates configuration at all.
    const { status, body } = await postInvoice(
      fx.foreignAdminUserId,
      usdInvoicePayload(fx.foreignStudentProfileId),
    );
    expect(status).toBe(201);
    const row = await prisma.invoice.findUniqueOrThrow({ where: { id: body.data.id } });
    expect(row.academyId).toBe(fx.foreignAcademyId);
    expect(row.exchangeRate).toBeNull();
  });

  it("INT-RATE-03: a supervisor cannot create invoices (403, Admin-only)", async () => {
    const { status, body } = await postInvoice(
      fx.supervisorUserId,
      usdInvoicePayload(fx.studentProfileIds.student2),
    );
    expect(status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("INT-RATE-04: changing the rate affects new invoices only — an existing invoice keeps its stored snapshot", async () => {
    // (Setup identical to INT-RATE-01: the 48.5 rate is already effective.)
    const before = await prisma.invoice.findFirstOrThrow({
      where: { academyId: fx.academyId, currency: "USD" },
      orderBy: { createdAt: "asc" },
      select: { id: true, exchangeRate: true },
    });
    const originalSnapshot = before.exchangeRate;
    expect(originalSnapshot).not.toBeNull();

    // A new, more recent rate becomes effective.
    await prisma.exchangeRate.create({
      data: {
        academyId: fx.academyId,
        fromCurrency: "USD",
        toCurrency: "EGP",
        rate: 50,
        effectiveFrom: new Date(),
        createdById: fx.adminUserId,
      },
    });
    const { status, body } = await postInvoice(fx.adminUserId, usdInvoicePayload(fx.studentProfileIds.student2));
    expect(status).toBe(201);
    const newRow = await prisma.invoice.findUniqueOrThrow({ where: { id: body.data.id } });
    expect(parseFloat(String(newRow.exchangeRate))).toBe(50);

    // The earlier invoice is untouched — the snapshot is immutable history.
    const reloaded = await prisma.invoice.findUniqueOrThrow({ where: { id: before.id }, select: { exchangeRate: true } });
    expect(reloaded.exchangeRate?.toString()).toBe(originalSnapshot?.toString());
    expect(parseFloat(String(reloaded.exchangeRate))).toBe(48.5);
  });
});
