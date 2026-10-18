import "server-only";

import { prisma } from "../prisma";

export const CLASS_REMARKS_SETTING_KEY = "report.class_remarks";
/** CONTEXT §9: excellent / good / acceptable / needs follow-up — Admin-editable. */
export const DEFAULT_CLASS_REMARKS = ["excellent", "good", "acceptable", "needs follow-up"];

let settingsTableReady: boolean | null = null;

/** Same owner-applied migration as report_attachments (20261015093512). */
export async function isAcademySettingsReady(): Promise<boolean> {
  if (settingsTableReady === true) return true;
  // information_schema instead of to_regclass — the regclass OID column
  // intermittently fails to deserialize through the transaction-mode pooler
  // (see lib/scheduling/session-requests.ts).
  const rows = (await prisma.$queryRawUnsafe(
    "SELECT COUNT(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'academy_settings'",
  )) as { count: number }[];
  settingsTableReady = rows[0]?.count === 1;
  return settingsTableReady;
}

/**
 * The academy's active class-remark list. Falls back to the CONFIRMED defaults until
 * the Admin edits the list (and until the settings migration is applied).
 */
export async function getClassRemarks(academyId: string): Promise<string[]> {
  if (!(await isAcademySettingsReady())) return DEFAULT_CLASS_REMARKS;
  const row = await prisma.academySetting.findUnique({
    where: { academyId_key: { academyId, key: CLASS_REMARKS_SETTING_KEY } },
    select: { value: true },
  });
  const items = (row?.value as { items?: unknown } | null)?.items;
  if (Array.isArray(items) && items.length > 0 && items.every((item) => typeof item === "string" && item.trim().length > 0)) {
    return items as string[];
  }
  return DEFAULT_CLASS_REMARKS;
}

/** Admin-only save (owner decision 2026-10-14 — Supervisors are excluded from system settings). */
export async function setClassRemarks(academyId: string, items: string[]): Promise<void> {
  await prisma.academySetting.upsert({
    where: { academyId_key: { academyId, key: CLASS_REMARKS_SETTING_KEY } },
    create: { academyId, key: CLASS_REMARKS_SETTING_KEY, value: { items } },
    update: { value: { items } },
  });
}
