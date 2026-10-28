import { getTranslations } from "next-intl/server";

import DashboardShell from "../../_components/dashboard-shell";
import InboxList from "../../_components/notifications/inbox-list";
import { requireRoles } from "../../../lib/dal";
import { getInbox } from "../../../lib/notifications/inbox";

export async function generateMetadata() {
  const t = await getTranslations("inbox");
  return { title: `${t("title")} | Zarabicschool` };
}

/** S-06 / D12: every role's inbox; staff also see the team queues (no money for the Supervisor). */
export default async function NotificationsPage() {
  const user = await requireRoles(["ADMIN", "SUPERVISOR", "TEACHER", "STUDENT", "GUARDIAN"]);
  const t = await getTranslations("inbox");
  const items = await getInbox(user);
  return (
    <DashboardShell role={user.role} userName={user.displayName} timezone={user.timezone}>
      <h1 className="text-xl font-bold text-[var(--navy)]">{t("title")}</h1>
      <p className="mt-2 max-w-prose text-sm opacity-70">{t("subtitle")}</p>
      <div className="mt-6 max-w-3xl">
        <InboxList items={items} timeZone={user.timezone} />
      </div>
    </DashboardShell>
  );
}
