import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen">
      <section className="bg-[var(--navy)] text-white">
        <div className="mx-auto flex max-w-5xl flex-col items-center px-4 py-20 text-center">
          <h1 className="text-3xl font-bold sm:text-4xl">Zarabicschool</h1>
          <p className="mt-4 max-w-xl text-lg opacity-90">
            تعلّم العربية والقرآن ... بنيَة تضيء قلبك
          </p>
          <Link
            href="/login"
            className="mt-8 rounded-lg bg-[var(--emerald)] px-8 py-3 font-semibold text-white transition hover:opacity-90"
          >
            تسجيل الدخول
          </Link>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-14">
        <h2 className="text-center text-xl font-bold text-[var(--navy)]">التقديم للانضمام</h2>
        <p className="mt-2 text-center text-sm text-[var(--foreground)] opacity-60">
          نماذج التقديم ستكون متاحة قريبًا
        </p>
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[
            { title: "تقديم ولي الأمر", description: "لأولياء الأمور الراغبين في تسجيل أبنائهم" },
            { title: "تقديم طالب", description: "للطلاب الراغبين في تعلم العربية والقرآن" },
            { title: "تقديم معلمة", description: "للمعلمات المتخصصات في اللغة العربية والقرآن" },
          ].map((item) => (
            <div key={item.title} className="rounded-xl border border-[var(--line)] bg-white p-6 text-center">
              <h3 className="font-semibold text-[var(--navy)]">{item.title}</h3>
              <p className="mt-2 text-sm text-[var(--foreground)] opacity-60">{item.description}</p>
              <span className="mt-4 inline-block rounded-full bg-[var(--gold)]/10 px-3 py-1 text-xs font-medium text-[var(--gold)]">
                قريبًا
              </span>
            </div>
          ))}
        </div>
1      </section>
    </div>
  );
}
