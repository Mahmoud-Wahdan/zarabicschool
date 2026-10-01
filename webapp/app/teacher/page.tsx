import DashboardShell from "../_components/dashboard-shell";
import { requireRole } from "../../lib/dal";

export const metadata = { title: "لوحة المعلمة | Zarabicschool" };

export default async function TeacherDashboard() {
  const user = await requireRole("TEACHER");

  return (
    <DashboardShell role={user.role} userName={user.displayName}>
      <h1 className="text-xl font-bold text-[var(--navy)]">لوحة المعلمة</h1>
      <p className="mt-2 text-sm text-[var(--foreground)] opacity-70">
        مرحبًا {user.displayName}. من هنا سترين حصصك وتقاريرك وراتبك.
      </p>

      <section className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {["حصص اليوم", "التقارير المطلوبة", "الراتب حتى الآن"].map((item) => (
          <div key={item} className="rounded-xl border border-[var(--line)] bg-white p-5">
            <h2 className="font-semibold text-[var(--navy)]">{item}</h2>
            <p className="mt-2 text-sm text-[var(--foreground)] opacity-60">لا توجد بيانات بعد</p>
          </div>
        ))}
      </section>
    </DashboardShell>
  );
}
