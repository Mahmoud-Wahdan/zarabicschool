import { getTranslations } from "next-intl/server";

import DashboardShell from "@/app/_components/dashboard-shell";
import WhatsAppAdminPanel from "@/app/_components/whatsapp/whatsapp-admin-panel";
import PageHeader from "@/app/_components/ui/page-header";
import { requireRole } from "@/lib/dal";
import { getWhatsAppContactNumber } from "@/lib/messaging/contact-number";
import { isWhatsAppDeliveryReady } from "@/lib/messaging/readiness";
import { prisma } from "@/lib/prisma";

export async function generateMetadata() {
  const t = await getTranslations("whatsappAdmin");
  return { title: t("title") };
}

/**
 * Admin-only WhatsApp page (slice d): OpenWA health check (server-side probe),
 * the site contact number (AcademySettings) and individual messages. Supervisors
 * are redirected by requireRole — individual messages are an Admin permission.
 */
export default async function WhatsAppAdminPage() {
  const user = await requireRole("ADMIN");
  const t = await getTranslations("whatsappAdmin");
  const [ready, contactNumber, recipients] = await Promise.all([
    isWhatsAppDeliveryReady(),
    getWhatsAppContactNumber(user.academyId),
    prisma.user.findMany({
      where: { academyId: user.academyId, isActive: true, phone: { not: null } },
      orderBy: { displayName: "asc" },
      take: 500,
      select: { id: true, displayName: true, username: true, role: true },
    }),
  ]);

  return (
    <DashboardShell role={user.role} userName={user.displayName} timezone={user.timezone}>
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} subtitle={t("subtitle")} />
      <WhatsAppAdminPanel ready={ready} initialContactNumber={contactNumber ?? ""} recipients={recipients} />
    </DashboardShell>
  );
}
