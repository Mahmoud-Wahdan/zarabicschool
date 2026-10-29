import { getTranslations } from "next-intl/server";

import DashboardShell from "../../../_components/dashboard-shell";
import PageHeader from "../../../_components/ui/page-header";
import AdminInvoicesPanel from "../../../_components/invoices/admin-invoices-panel";
import RefundRequestsAdmin from "../../../_components/invoices/refund-requests-admin";
import { listRefundRequests } from "../../../../lib/billing/refund-requests";
import { requireRole } from "../../../../lib/dal";
import { prisma } from "../../../../lib/prisma";

export async function generateMetadata() {
  const t = await getTranslations("invoices");
  return { title: `${t("title")} | Zarabicschool` };
}

/** Admin invoice administration: create, review proofs, confirm manual payments. */
export default async function AdminInvoicesPage() {
  const user = await requireRole("ADMIN");
  const t = await getTranslations("invoices");

  const [invoices, students, refundRequests] = await Promise.all([
    prisma.invoice.findMany({
      where: { academyId: user.academyId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        studentId: true,
        amountMinor: true,
        currency: true,
        provider: true,
        packageType: true,
        sessionsPurchased: true,
        status: true,
        createdAt: true,
        student: { select: { user: { select: { displayName: true } } } },
        paymentProofs: {
          orderBy: { createdAt: "desc" },
          select: { id: true, status: true, originalName: true, reference: true, uploadedBy: { select: { displayName: true } } },
        },
      },
    }),
    prisma.student.findMany({
      where: { academyId: user.academyId, user: { isActive: true } },
      orderBy: { user: { displayName: "asc" } },
      select: { id: true, user: { select: { displayName: true } } },
    }),
    // S-15: payers' waiting refund requests.
    listRefundRequests(user.academyId, "PENDING"),
  ]);

  return (
    <DashboardShell role={user.role} userName={user.displayName}>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <div className="mt-4">
        <RefundRequestsAdmin requests={refundRequests} timeZone={user.timezone || "Africa/Cairo"} />
      </div>
      <div className="mt-4">
        <AdminInvoicesPanel
          timeZone={user.timezone || "Africa/Cairo"}
          initialInvoices={invoices.map((invoice) => ({
            id: invoice.id,
            studentId: invoice.studentId,
            studentName: invoice.student.user.displayName,
            amountMinor: invoice.amountMinor.toString(),
            currency: invoice.currency,
            provider: invoice.provider,
            packageType: invoice.packageType,
            sessionsPurchased: invoice.sessionsPurchased,
            status: invoice.status,
            createdAt: invoice.createdAt.toISOString(),
            proofs: invoice.paymentProofs.map((proof) => ({
              id: proof.id,
              status: proof.status,
              originalName: proof.originalName,
              reference: proof.reference,
              uploadedBy: proof.uploadedBy.displayName,
            })),
          }))}
          students={students.map((student) => ({ id: student.id, displayName: student.user.displayName }))}
        />
      </div>
    </DashboardShell>
  );
}
