import { getLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import LocaleSwitcher from "../../_components/locale-switcher";
import { getAuthSession } from "../../../lib/dal";
import LoginForm from "./login-form";

export const metadata = { title: "تسجيل الدخول | Zarabicschool" };

export default async function LoginPage() {
  const user = await getAuthSession();
  if (user) {
    const locale = await getLocale();
    redirect(
      user.mustChangePassword ? `/${locale}/change-password` : `/${locale}/${user.role.toLowerCase()}`,
    );
  }

  const t = await getTranslations("login");

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="mb-4 w-full max-w-md flex justify-end">
        <LocaleSwitcher />
      </div>
      <div className="w-full max-w-md rounded-2xl border border-[var(--line)] bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-bold text-[var(--navy)]">{t("title")}</h1>
        <p className="mt-2 text-sm text-[var(--foreground)] opacity-70">{t("subtitle")}</p>
        <LoginForm />
      </div>
    </main>
  );
}
