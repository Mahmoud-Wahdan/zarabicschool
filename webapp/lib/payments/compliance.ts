import "server-only";

import { prisma } from "../prisma";
import { isPhase6bReady } from "../billing/readiness";

export type CurrencyTotals = {
  currency: string;
  paidMinor: bigint;
  refundedMinor: bigint;
  netMinor: bigint;
  paidCount: number;
  refundedCount: number;
};

export async function getReconciliationReport(academyId: string) {
  const [invoices, unmatchedWebhooksCount] = await Promise.all([
    prisma.invoice.findMany({
      where: {
        academyId,
        status: { in: ["PAID", "PENDING", "FAILED", "CANCELLED"] },
      },
      orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
      take: 200,
      select: {
        id: true,
        amountMinor: true,
        currency: true,
        provider: true,
        status: true,
        packageType: true,
        sessionsPurchased: true,
        providerReference: true,
        paidAt: true,
        termsConsentAt: true,
        createdAt: true,
        student: {
          select: {
            user: { select: { displayName: true } },
            guardian: { select: { user: { select: { displayName: true } } } },
          },
        },
        refunds: {
          where: { status: "SUCCEEDED" },
          select: { id: true, amountMinor: true, providerRefundId: true, completedAt: true },
        },
      },
    }),
    (await isPhase6bReady())
      ? prisma.webhookEvent.count({ where: { status: { in: ["UNMATCHED", "INVALID_SHAPE"] } } }).catch(() => 0)
      : Promise.resolve(0),
  ]);

  const byCurrency = new Map<string, CurrencyTotals>();
  for (const inv of invoices) {
    if (inv.status !== "PAID") continue;
    const entry = byCurrency.get(inv.currency) ?? {
      currency: inv.currency,
      paidMinor: BigInt(0),
      refundedMinor: BigInt(0),
      netMinor: BigInt(0),
      paidCount: 0,
      refundedCount: 0,
    };
    entry.paidMinor += inv.amountMinor;
    entry.paidCount += 1;
    const refundedForInv = inv.refunds.reduce((sum, r) => sum + r.amountMinor, BigInt(0));
    if (refundedForInv > BigInt(0)) {
      entry.refundedMinor += refundedForInv;
      entry.refundedCount += 1;
    }
    entry.netMinor = entry.paidMinor - entry.refundedMinor;
    byCurrency.set(inv.currency, entry);
  }

  return {
    totals: Array.from(byCurrency.values()),
    unmatchedWebhooksCount,
    invoices: invoices.map((inv) => ({
      ...inv,
      refundedMinor: inv.refunds.reduce((sum, r) => sum + r.amountMinor, BigInt(0)),
    })),
  };
}

export async function getChargebackEvidence(academyId: string, invoiceId: string) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, academyId },
    select: {
      id: true,
      amountMinor: true,
      currency: true,
      provider: true,
      status: true,
      packageType: true,
      sessionsPurchased: true,
      providerReference: true,
      paidAt: true,
      termsConsentAt: true,
      createdAt: true,
      studentId: true,
      student: {
        select: {
          id: true,
          userId: true,
          user: { select: { displayName: true, phone: true, email: true } },
          guardian: {
            select: {
              userId: true,
              relationship: true,
              user: { select: { displayName: true, phone: true, email: true } },
            },
          },
        },
      },
      attempts: {
        orderBy: { createdAt: "asc" },
        select: { id: true, provider: true, status: true, providerReference: true, createdAt: true },
      },
      refunds: {
        orderBy: { createdAt: "asc" },
        select: { id: true, amountMinor: true, currency: true, status: true, providerRefundId: true, reason: true, createdAt: true, completedAt: true },
      },
      auditEvents: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          eventType: true,
          actorRole: true,
          metadata: true,
          createdAt: true,
          actor: { select: { displayName: true } },
        },
      },
    },
  });

  if (!invoice) return null;

  const since = invoice.paidAt ?? invoice.createdAt;
  const sessionStudents = await prisma.sessionStudent.findMany({
    where: {
      studentId: invoice.studentId,
      session: { academyId, scheduledStart: { gte: since } },
    },
    orderBy: { session: { scheduledStart: "asc" } },
    take: 50,
    select: {
      attendanceStatus: true,
      session: {
        select: {
          id: true,
          scheduledStart: true,
          scheduledEnd: true,
          status: true,
          subject: { select: { nameAr: true, nameEn: true } },
          teacher: { select: { user: { select: { displayName: true } } } },
          joinClicks: {
            where: {
              userId: {
                in: [
                  invoice.student.userId,
                  ...(invoice.student.guardian ? [invoice.student.guardian.userId] : []),
                ],
              },
            },
            orderBy: { clickedAt: "asc" },
            select: { clickedAt: true, user: { select: { role: true } } },
          },
          reports: {
            where: { studentId: invoice.studentId },
            select: { id: true, status: true, submittedAt: true },
          },
        },
      },
    },
  });

  return {
    generatedAt: new Date().toISOString(),
    invoice,
    sessions: sessionStudents.map((ss) => ({
      sessionId: ss.session.id,
      scheduledStart: ss.session.scheduledStart,
      scheduledEnd: ss.session.scheduledEnd,
      sessionStatus: ss.session.status,
      attendanceStatus: ss.attendanceStatus,
      subject: ss.session.subject,
      teacherName: ss.session.teacher.user.displayName,
      joinClicks: ss.session.joinClicks,
      reports: ss.session.reports,
    })),
  };
}

export async function getSystemAuditFeed(academyId: string) {
  const [linkAudits, webhookEvents] = await Promise.all([
    prisma.sessionLinkAudit.findMany({
      where: { academyId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        sessionId: true,
        seriesId: true,
        source: true,
        joinUrlChanged: true,
        hostUrlChanged: true,
        createdAt: true,
        changedBy: { select: { displayName: true, role: true } },
      },
    }),
    (await isPhase6bReady())
      ? prisma.webhookEvent
          .findMany({
            orderBy: { createdAt: "desc" },
            take: 50,
            select: { id: true, provider: true, providerEventId: true, eventType: true, status: true, createdAt: true },
          })
          .catch(() => [])
      : Promise.resolve([]),
  ]);

  return { linkAudits, webhookEvents };
}
