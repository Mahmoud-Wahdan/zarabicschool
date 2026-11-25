import { NextResponse } from "next/server";

import { requireApiRoles } from "../../../../../lib/dal";
import { getReconciliationReport } from "../../../../../lib/payments/compliance";
import { formatMoney } from "../../../../../lib/payments/format";

export const runtime = "nodejs";

function csvCell(value: string | number | null | undefined): string {
  const raw = value === null || value === undefined ? "" : String(value);
  return `"${raw.replace(/"/g, '""')}"`;
}

export async function GET() {
  const { user, error } = await requireApiRoles(["ADMIN"]);
  if (error) return error;

  const report = await getReconciliationReport(user.academyId);
  const header = [
    "Invoice ID",
    "Student",
    "Guardian",
    "Provider",
    "Provider Reference",
    "Status",
    "Currency",
    "Amount",
    "Refunded",
    "Net",
    "Paid At",
    "Terms Consent At",
    "Created At",
  ];

  const rows = report.invoices.map((inv) => {
    const netMinor = inv.status === "PAID" ? inv.amountMinor - inv.refundedMinor : BigInt(0);
    return [
      csvCell(inv.id),
      csvCell(inv.student.user.displayName),
      csvCell(inv.student.guardian?.user.displayName ?? ""),
      csvCell(inv.provider),
      csvCell(inv.providerReference ?? ""),
      csvCell(inv.status),
      csvCell(inv.currency),
      csvCell(formatMoney(inv.amountMinor, inv.currency, "en")),
      csvCell(formatMoney(inv.refundedMinor, inv.currency, "en")),
      csvCell(formatMoney(netMinor, inv.currency, "en")),
      csvCell(inv.paidAt ? inv.paidAt.toISOString() : ""),
      csvCell(inv.termsConsentAt ? inv.termsConsentAt.toISOString() : ""),
      csvCell(inv.createdAt.toISOString()),
    ].join(",");
  });

  const csv = `\uFEFF${[header.join(","), ...rows].join("\n")}`;
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="reconciliation-${new Date().toISOString().slice(0, 10)}.csv"`,
      "cache-control": "no-store",
    },
  });
}
