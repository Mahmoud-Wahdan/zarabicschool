import { getLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { getAuthSession } from "../../../lib/dal";
import ChangePasswordForm from "./change-password-form";

export const metadata = { title: "تغيير كلمة المرور | Zarabicschool" };

export default async function ChangePasswordPage() {
  const user = await getAuthSession();
  const locale = await getLocale();
  const t = await getTranslations("changePassword");
  if (!user) redirect(`/${locale}/login`);
  if (!user.mustChangePassword) redirect(`/${locale}/${user.role.toLowerCase()}`);

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-[var(--line)] bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-bold text-[var(--navy)]">{t("title")}</h1>
        <p className="mt-2 text-sm text-[var(--foreground)] opacity-70">{t("subtitle")}</p>
        <ChangePasswordForm username={user.username} role={user.role} />
      </div>
    </main>
  );
}
