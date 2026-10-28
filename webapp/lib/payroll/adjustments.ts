import "server-only";

import { createHash } from "node:crypto";

import type { Prisma } from "../../generated/prisma/client";

import { prisma } from "../prisma";

/**
 * S-12 deductions & bonuses (D14, D40). The category of an entry: its own column
 * (SQL S-5) for new Admin adjustments; an approved-overtime row (report_id set)
 * counts as OVERTIME (D40); an older manual row without a category stays
 * UNCATEGORIZED (the ledger is append-only, nothing is back-filled).
 */
export type AdjustmentCategory = "BONUS" | "FINE" | "OVERTIME" | "OTHER" | "UNCATEGORIZED";

export function entryCategory(row: { adjustmentCategory: string | null; reportId: string | null }): AdjustmentCategory {
  if (row.adjustmentCategory) return row.adjustmentCategory as AdjustmentCategory;
  return row.reportId ? "OVERTIME" : "UNCATEGORIZED";
}

/** The ONE idempotency key a reversal of `entryId` may use: a second reversal collides. */
export function reversalKey(entryId: string): string {
  const hex = createHash("sha256").update(`payroll-reversal:${entryId}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function categoryWhere(category: AdjustmentCategory): Prisma.PayrollLedgerWhereInput {
  if (category === "OVERTIME") return { OR: [{ adjustmentCategory: "OVERTIME" }, { adjustmentCategory: null, reportId: { not: null } }] };
  if (category === "UNCATEGORIZED") return { adjustmentCategory: null, reportId: null };
  return { adjustmentCategory: category };
}

export async function listAdjustments(options: { academyId: string; teacherId?: string; category?: AdjustmentCategory; from?: Date; to?: Date; forAdmin: boolean }) {
  const rows = await prisma.payrollLedger.findMany({
    where: {
      academyId: options.academyId,
      entryType: "ADMIN_ADJUSTMENT",
      ...(options.teacherId ? { teacherId: options.teacherId } : {}),
      ...(options.category ? categoryWhere(options.category) : {}),
      ...(options.from || options.to ? { createdAt: { ...(options.from ? { gte: options.from } : {}), ...(options.to ? { lt: options.to } : {}) } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true, teacherId: true, amountMinor: true, currency: true, reason: true, adjustmentCategory: true, reportId: true, createdAt: true,
      teacher: { select: { user: { select: { displayName: true } } } },
    },
  });
  const reversed = options.forAdmin && rows.length
    ? new Set((await prisma.payrollLedger.findMany({ where: { academyId: options.academyId, idempotencyKey: { in: rows.map((row) => reversalKey(row.id)) } }, select: { idempotencyKey: true } })).map((row) => row.idempotencyKey))
    : new Set<string | null>();
  return rows.map((row) => ({
    id: row.id,
    teacherId: row.teacherId,
    teacherName: row.teacher.user.displayName,
    amountMinor: row.amountMinor,
    currency: row.currency,
    reason: row.reason,
    category: entryCategory(row),
    createdAt: row.createdAt.toISOString(),
    reversible: options.forAdmin && !reversed.has(reversalKey(row.id)),
  }));
}
