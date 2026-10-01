import { redirect } from "next/navigation";

import { getAuthSession, dashboardPath } from "../../lib/dal";
import LoginForm from "./login-form";

export const metadata = { title: "تسجيل الدخول | Zarabicschool" };

export default async function LoginPage() {
  const user = await getAuthSession();
  if (user) {
    redirect(user.mustChangePassword ? "/change-password" : dashboardPath(user.role));
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-[var(--line)] bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-bold text-[var(--navy)]">تسجيل الدخول</h1>
        <p className="mt-2 text-sm text-[var(--foreground)] opacity-70">
          أدخل اسم المستخدم وكلمة المرور للوصول إلى حسابك
        </p>
        <LoginForm />
      </div>
    </main>
  );
}
