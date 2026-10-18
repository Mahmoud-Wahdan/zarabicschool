"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

type Subject = {
  id: string; slug: string; nameAr: string; nameEn: string;
  descriptionAr: string | null; descriptionEn: string | null; icon: string | null;
  sortOrder: number; isActive: boolean;
};

const emptyForm = { slug: "", nameAr: "", nameEn: "", sortOrder: 0 };

export default function SubjectsPanel({ initialSubjects }: { initialSubjects: Subject[] }) {
  const t = useTranslations("management.form");
  const [subjects, setSubjects] = useState(initialSubjects);
  const [form, setForm] = useState(emptyForm);
  const [message, setMessage] = useState("");

  async function createSubject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const response = await fetch("/api/subjects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(form) });
    const payload = await response.json();
    if (!response.ok) { setMessage(payload.error?.message ?? t("createFailed")); return; }
    setSubjects((current) => [...current, payload.data]);
    setForm(emptyForm);
    setMessage(t("profileCreated"));
  }

  async function toggleSubject(subject: Subject) {
    const response = await fetch(`/api/subjects/${subject.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ isActive: !subject.isActive }) });
    const payload = await response.json();
    if (!response.ok) { setMessage(payload.error?.message ?? t("updateFailed")); return; }
    setSubjects((current) => current.map((item) => item.id === subject.id ? { ...item, ...payload.data } : item));
  }

  return (
    <div className="mt-6 space-y-6">
      <form onSubmit={createSubject} className="dashboard-card grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4">
        <input required placeholder={t("slug")} value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} className="rounded-lg border border-[var(--line)] px-3 py-2" />
        <input required placeholder={t("arabicName")} value={form.nameAr} onChange={(e) => setForm({ ...form, nameAr: e.target.value })} className="rounded-lg border border-[var(--line)] px-3 py-2" dir="rtl" />
        <input required placeholder={t("englishName")} value={form.nameEn} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} className="rounded-lg border border-[var(--line)] px-3 py-2" dir="ltr" />
        <div className="flex gap-2"><input type="number" min={0} placeholder={t("order")} value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })} className="min-w-0 flex-1 rounded-lg border border-[var(--line)] px-3 py-2" /><button className="cta-primary rounded-lg px-3 py-2 text-sm">{t("create")}</button></div>
        {message ? <p role="status" className="text-sm opacity-75 sm:col-span-2 lg:col-span-4">{message}</p> : null}
      </form>
      <div className="dashboard-card overflow-x-auto p-5">
        <table className="w-full min-w-[620px] text-start text-sm">
          <thead className="border-b border-[var(--line)] text-xs opacity-70"><tr><th className="px-3 py-2 text-start">{t("arabicName")}</th><th className="px-3 py-2 text-start">{t("englishName")}</th><th className="px-3 py-2 text-start">{t("slug")}</th><th className="px-3 py-2 text-start">{t("status")}</th><th className="px-3 py-2 text-start">{t("action")}</th></tr></thead>
          <tbody>{subjects.map((subject) => <tr key={subject.id} className="border-b border-[var(--line)] last:border-0"><td className="px-3 py-3">{subject.nameAr}</td><td className="px-3 py-3">{subject.nameEn}</td><td className="px-3 py-3 opacity-70">{subject.slug}</td><td className="px-3 py-3">{subject.isActive ? t("active") : t("inactive")}</td><td className="px-3 py-3"><button onClick={() => toggleSubject(subject)} className="rounded-lg border border-[var(--line)] px-3 py-1 text-xs font-semibold">{subject.isActive ? t("deactivate") : t("activate")}</button></td></tr>)}          </tbody>
        </table>
      </div>
    </div>
  );
}
