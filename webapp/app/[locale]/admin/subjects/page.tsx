import { getTranslations } from "next-intl/server";

import DashboardShell from "../../../_components/dashboard-shell";
import { requireRole } from "../../../../lib/dal";
import { prisma } from "../../../../lib/prisma";
import SubjectsPanel from "./subjects-panel";

export default async function SubjectsPage() {
  const user = await requireRole("ADMIN");
  const t = await getTranslations("subjectsAdmin");
  const subjects = await prisma.subject.findMany({
    where: { academyId: user.academyId },
    orderBy: [{ sortOrder: "asc" }, { nameEn: "asc" }],
    select: { id: true, slug: true, nameAr: true, nameEn: true, descriptionAr: true, descriptionEn: true, icon: true, sortOrder: true, isActive: true },
  });
  return (
    <DashboardShell role={user.role} userName={user.displayName}>
      <h1 className="text-xl font-bold text-[var(--navy)]">{t("title")}</h1>
      <p className="mt-2 text-sm opacity-70">{t("subtitle")}</p>
      <SubjectsPanel initialSubjects={subjects} />
    </DashboardShell>
  );
}
