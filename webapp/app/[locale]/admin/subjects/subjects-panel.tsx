"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import DataTable, { type DataRow } from "../../../_components/ui/data-table";

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
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function createSubject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setBusy(true);
    try {
      const response = await fetch("/api/subjects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(form) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) { setMessage({ tone: "error", text: response.status === 409 ? t("slugTaken") : t("createFailed") }); return; }
      setSubjects((current) => [...current, payload.data]);
      setForm(emptyForm);
      setMessage({ tone: "success", text: t("subjectCreated") });
    } catch {
      setMessage({ tone: "error", text: t("createFailed") });
    } finally {
      setBusy(false);
    }
  }

  async function toggleSubject(subject: Subject) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/subjects/${subject.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ isActive: !subject.isActive }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) { setMessage({ tone: "error", text: t("updateFailed") }); return; }
      setSubjects((current) => current.map((item) => item.id === subject.id ? { ...item, ...payload.data } : item));
    } catch {
      setMessage({ tone: "error", text: t("updateFailed") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 flex flex-col gap-6">
      <section className="z-card rounded-xl p-4 sm:p-6" aria-labelledby="subject-create">
        <h2 id="subject-create" className="text-headline-sm font-semibold text-primary">{t("newSubject")}</h2>
        <form onSubmit={createSubject} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_8rem_auto] lg:items-end">
          <label className="flex flex-col gap-1 text-label-md text-on-surface">{t("arabicName")}
            <input required value={form.nameAr} onChange={(e) => setForm({ ...form, nameAr: e.target.value })} className="z-input" dir="rtl" />
          </label>
          <label className="flex flex-col gap-1 text-label-md text-on-surface">{t("englishName")}
            <input required value={form.nameEn} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} className="z-input" dir="ltr" />
          </label>
          <label className="flex flex-col gap-1 text-label-md text-on-surface">{t("slug")}
            <input required value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} className="z-input" dir="ltr" placeholder="quran-tajweed" />
          </label>
          <label className="flex flex-col gap-1 text-label-md text-on-surface">{t("order")}
            <input type="number" min={0} value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })} className="z-input" dir="ltr" />
          </label>
          <button type="submit" disabled={busy} className="btn btn-primary">{t("create")}</button>
        </form>
        {message ? (
          <p role={message.tone === "error" ? "alert" : "status"} className={`mt-3 rounded-lg px-3 py-2 text-body-sm ${message.tone === "success" ? "bg-secondary-fixed/30 text-on-surface" : "bg-error-container/60 text-on-error-container"}`}>{message.text}</p>
        ) : null}
      </section>

      <section className="z-card overflow-hidden rounded-xl pt-4 sm:pt-6" aria-labelledby="subject-list">
        <h2 id="subject-list" className="px-4 pb-3 text-headline-sm font-semibold text-primary sm:px-6">{t("subjectList")}</h2>
        <DataTable
          caption={t("subjectList")}
          columns={[
            { key: "nameAr", label: t("arabicName") },
            { key: "nameEn", label: t("englishName") },
            { key: "slug", label: t("slug") },
            { key: "order", label: t("order") },
            { key: "status", label: t("status") },
          ]}
          rows={subjects.map((subject): DataRow => ({
            id: subject.id,
            filter: subject.isActive ? "active" : "inactive",
            cells: {
              nameAr: { text: subject.nameAr, strong: true },
              nameEn: { text: subject.nameEn },
              slug: { text: subject.slug },
              order: { text: String(subject.sortOrder), sort: subject.sortOrder, numeric: true },
              status: { text: subject.isActive ? t("active") : t("inactive"), tone: subject.isActive ? "success" : "neutral" },
            },
          }))}
          quickFilters={[{ key: "active", label: t("active") }, { key: "inactive", label: t("inactive") }]}
          emptyTitle={t("noSubjects")}
          emptyIcon="menu_book"
          initialSort={{ key: "order", direction: "asc" }}
          actions={{
            label: t("action"),
            render: (id) => {
              const subject = subjects.find((row) => row.id === id);
              if (!subject) return null;
              return (
                <button type="button" disabled={busy} onClick={() => void toggleSubject(subject)} className={subject.isActive ? "btn btn-ghost-danger" : "btn btn-outline"}>
                  {subject.isActive ? t("deactivate") : t("activate")}
                </button>
              );
            },
          }}
        />
      </section>
    </div>
  );
}
