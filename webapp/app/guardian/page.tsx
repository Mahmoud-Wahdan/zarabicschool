import DashboardShell from "../_components/dashboard-shell";
import { requireRole } from "../../lib/dal";

export const metadata = { title: "لوحة ولي الأمر | Zarabicschool" };

export default async function GuardianDashboard() {
  const user = await requireRole("GUARDIAN");

  return (
    <DashboardShell role={user.role} userName={user.displayName}>
      <h1 className="text-xl font-bold text-[var(--navy)]">لوحة ولي الأمر</h1>
      <p className="mt-2 text-sm text-[var(--foreground)] opacity-70">
        مرحبًا {user.displayName}. من هنا سترى أبناءك وجداولهم وتقارير تقدمهم ووضعهم المالي.
      </p>

      <section className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {["جدول الأبناء", "تقارير التقدم", "الوضع المالي"].map((item) => (
          <div key={item} className="rounded-xl border border-[var(--line)] bg-white p-5">
            <h2 className="font-semibold text-[var(--navy)]">{item}</h2>
            <p className="mt-2 text-sm text-[var(--foreground)] opacity-60">لا توجد بيانات بعد</p>
          </div>
        ))}
      </section>
    </DashboardShell>
  );
}
