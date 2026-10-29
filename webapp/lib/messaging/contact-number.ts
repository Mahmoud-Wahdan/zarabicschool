import "server-only";

import { prisma } from "../prisma";
import { toWaMeLink } from "./phone";

/**
 * Site-wide WhatsApp contact number (owner, 2026-10-24): AcademySettings key
 * `site.whatsapp_number`, Admin-editable, never hardcoded. The initial value is
 * inserted by migration 20261026000000. No row = no link rendered.
 */
export const WHATSAPP_CONTACT_SETTING_KEY = "site.whatsapp_number";

export async function getWhatsAppContactNumber(academyId: string): Promise<string | null> {
  try {
    const row = await prisma.academySetting.findUnique({
      where: { academyId_key: { academyId, key: WHATSAPP_CONTACT_SETTING_KEY } },
      select: { value: true },
    });
    return typeof row?.value === "string" && row.value.trim() ? row.value.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Public pages (landing, footer): single-tenant build (CONTEXT §11), so the
 * first academy row is the academy — no brand name hardcoded in the lookup.
 * Returns null when anything is missing.
 */
export async function getPublicWhatsAppLink(): Promise<string | null> {
  try {
    const academy = await prisma.academy.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
    if (!academy) return null;
    return toWaMeLink(await getWhatsAppContactNumber(academy.id));
  } catch {
    return null;
  }
}
