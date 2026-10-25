import { getTranslations } from "next-intl/server";

import DashboardShell from "../../../_components/dashboard-shell";
import { requireRole } from "../../../../lib/dal";
import { prisma } from "../../../../lib/prisma";
import PrivilegedUsersPanel from "./privileged-users-panel";

export default async function PrivilegedUsersPage() {
  const user = await requireRole("ADMIN");
  const t = await getTranslations("privilegedUsers");
  const rows = await prisma.user.findMany({
    where: { academyId: user.academyId, role: { in: ["ADMIN", "SUPERVISOR"] } },
    orderBy: [{ role: "asc" }, { displayName: "asc" }],
    select: {
      id: true,
      username: true,
      displayName: true,
      email: true,
      phone: true,
      role: true,
      isActive: true,
    },
  });
  const users = rows.map((row) => ({
    ...row,
    role: row.role as "ADMIN" | "SUPERVISOR",
  }));

  return (
    <DashboardShell role={user.role} userName={user.displayName}>
      <h1 className="text-xl font-bold text-[var(--navy)]">{t("title")}</h1>
      <p className="mt-2 text-sm opacity-70">{t("subtitle")}</p>
      <PrivilegedUsersPanel initialUsers={users} currentUserId={user.id} />
    </DashboardShell>
  );
}
