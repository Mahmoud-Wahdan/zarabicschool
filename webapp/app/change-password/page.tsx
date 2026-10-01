import { redirect } from "next/navigation";

import { getAuthSession, dashboardPath } from "../../lib/dal";
import ChangePasswordForm from "./change-password-form";

export const metadata = { title: "تغيير كلمة المرور | Zarabicschool" };

export default async function ChangePasswordPage() {
  const user = await getAuthSession();
  if (!user) redirect("/login");
  if (!user.mustChangePassword) redirect(dashboardPath(user.role));

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-[var(--line)] bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-bold text-[var(--navy)]">تغيير كلمة المرور</h1>
        <p className="mt-2 text-sm text-[var(--foreground)] opacity-70">
          يجب تغيير كلمة المرور المؤقتة قبل الوصول إلى المنصة
        </p>
        <ChangePasswordForm username={user.username} role={user.role} />
      </div>
    </main>
  );
}
