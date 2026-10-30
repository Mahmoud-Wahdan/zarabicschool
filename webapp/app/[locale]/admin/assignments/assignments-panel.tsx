"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import EmptyState from "../../../_components/ui/empty-state";

type Teacher = { id: string; displayName: string; teacherProfile?: { id: string; subjects: { subjectId: string }[] } | null };
type Subject = { id: string; nameEn: string; nameAr: string };
type Feedback = { tone: "success" | "error"; text: string } | null;

/** Which subjects each teacher teaches (teacher ↔ subject links). Adding only; a link in use by assignments is kept. */
export default function AssignmentsPanel() {
  const t = useTranslations("assignmentsAdmin.teacherSubjects");
  const locale = useLocale();
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [teacherId, setTeacherId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const load = useCallback(async () => {
    try {
      const [teacherResponse, subjectResponse] = await Promise.all([fetch("/api/admin/profiles?type=teacher"), fetch("/api/subjects")]);
      if (!teacherResponse.ok || !subjectResponse.ok) throw new Error("load failed");
      const [teacherPayload, subjectPayload] = await Promise.all([teacherResponse.json(), subjectResponse.json()]);
      setTeachers(teacherPayload.data ?? []);
      setSubjects(subjectPayload.data ?? subjectPayload);
    } catch {
      setFeedback({ tone: "error", text: t("loadError") });
    }
  }, [t]);

  useEffect(() => {
    void Promise.resolve().then(() => load());
  }, [load]);

  const subjectName = (subject: Subject) => (locale === "ar" ? subject.nameAr : subject.nameEn);
  const selectedTeacher = teachers.find((teacher) => teacher.teacherProfile?.id === teacherId);
  const taught = new Set((selectedTeacher?.teacherProfile?.subjects ?? []).map((item) => item.subjectId));

  async function assign(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/admin/teacher-subjects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ teacherId, subjectId }) });
      if (!response.ok) {
        setFeedback({ tone: "error", text: response.status === 409 ? t("duplicate") : t("saveError") });
        return;
      }
      setFeedback({ tone: "success", text: t("saved") });
      setSubjectId("");
      await load();
    } catch {
      setFeedback({ tone: "error", text: t("saveError") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="z-card rounded-xl p-4 sm:p-6" aria-labelledby="teacher-subjects">
      <h2 id="teacher-subjects" className="text-headline-sm font-semibold text-primary">{t("title")}</h2>
      <p className="mt-1 text-body-sm text-on-surface-variant">{t("hint")}</p>
      <form onSubmit={assign} className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
        <label className="flex flex-col gap-1 text-label-md text-on-surface">
          {t("teacher")}
          <select required className="z-input" value={teacherId} onChange={(event) => { setTeacherId(event.target.value); setSubjectId(""); }}>
            <option value="">{t("chooseTeacher")}</option>
            {teachers.filter((teacher) => teacher.teacherProfile).map((teacher) => <option key={teacher.teacherProfile!.id} value={teacher.teacherProfile!.id}>{teacher.displayName}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-label-md text-on-surface">
          {t("subject")}
          <select required className="z-input" value={subjectId} onChange={(event) => setSubjectId(event.target.value)} disabled={!teacherId}>
            <option value="">{teacherId ? t("chooseSubject") : t("chooseTeacherFirst")}</option>
            {subjects.filter((subject) => !taught.has(subject.id)).map((subject) => <option key={subject.id} value={subject.id}>{subjectName(subject)}</option>)}
          </select>
        </label>
        <button type="submit" className="btn btn-primary" disabled={busy || !teacherId || !subjectId}>{t("submit")}</button>
      </form>
      {feedback ? (
        <p role={feedback.tone === "error" ? "alert" : "status"} className={`mt-3 rounded-lg px-3 py-2 text-body-sm ${feedback.tone === "success" ? "bg-secondary-fixed/30 text-on-surface" : "bg-error-container/60 text-on-error-container"}`}>
          {feedback.text}
        </p>
      ) : null}

      {teachers.length ? (
        <ul className="mt-5 divide-y divide-outline-variant border-t border-outline-variant">
          {teachers.map((teacher) => {
            const names = (teacher.teacherProfile?.subjects ?? [])
              .map((item) => subjects.find((subject) => subject.id === item.subjectId))
              .filter((subject): subject is Subject => Boolean(subject));
            return (
              <li key={teacher.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-body-md font-semibold text-on-surface">{teacher.displayName}</span>
                {names.length ? (
                  <ul className="flex flex-wrap gap-1.5" aria-label={t("subjectsOf", { name: teacher.displayName })}>
                    {names.map((subject) => (
                      <li key={subject.id} className="rounded-full bg-surface-container-high px-2.5 py-0.5 text-label-md text-on-surface">{subjectName(subject)}</li>
                    ))}
                  </ul>
                ) : (
                  <span className="text-body-sm text-on-surface-variant">{t("none")}</span>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState icon="school" title={t("noTeachers")} />
      )}
      <p className="mt-3 text-body-sm text-on-surface-variant">{t("keepNote")}</p>
    </section>
  );
}
