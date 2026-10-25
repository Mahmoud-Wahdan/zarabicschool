"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

type TeacherOption = { id: string; displayName: string };
type StudentOption = { id: string; displayName: string };
type AssignmentRow = {
  id: string;
  status: string;
  createdAt: string;
  endedAt: string | null;
  endedReason: string | null;
  studentId: string;
  teacherId: string;
  subjectId: string;
  student: { user: { displayName: string } };
  teacher: { user: { displayName: string } };
  subject: { nameEn: string; nameAr: string };
  createdBy: { displayName: string };
};
type NeedsTeacherRow = {
  studentId: string;
  subjectId: string;
  student: { user: { displayName: string } };
  subject: { nameEn: string; nameAr: string };
};

const inputClass = "mt-1 w-full rounded-xl border border-[var(--line)] px-3 py-2";

export default function StudentAssignmentsPanel() {
  const t = useTranslations("assignmentsAdmin");
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [needsTeacher, setNeedsTeacher] = useState<NeedsTeacherRow[]>([]);
  const [teachers, setTeachers] = useState<TeacherOption[]>([]);
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [filters, setFilters] = useState({ teacherId: "", status: "" });
  const [form, setForm] = useState({ studentId: "", teacherId: "", subjectId: "" });
  const [changeTeacherFor, setChangeTeacherFor] = useState<{ id: string; newTeacherId: string } | null>(null);
  const [formSubjects, setFormSubjects] = useState<{ id: string; nameEn: string; nameAr: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadFormSubjects = useCallback(async (teacherId: string) => {
    setFormSubjects([]);
    if (!teacherId) return;
    try {
      const response = await fetch(`/api/admin/teachers/${teacherId}/context`);
      if (!response.ok) throw new Error("context failed");
      const payload = await response.json();
      setFormSubjects(payload.data?.subjects ?? []);
    } catch {
      setError(t("states.loadError"));
    }
  }, [t]);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filters.teacherId) params.set("teacherId", filters.teacherId);
      if (filters.status) params.set("status", filters.status);
      const [assignmentsResponse, needsResponse] = await Promise.all([
        fetch(`/api/admin/assignments?${params.toString()}`),
        fetch("/api/admin/assignments/needs-teacher"),
      ]);
      if (!assignmentsResponse.ok || !needsResponse.ok) throw new Error("load failed");
      const assignmentsPayload = await assignmentsResponse.json();
      const needsPayload = await needsResponse.json();
      setAssignments(assignmentsPayload.data ?? []);
      setNeedsTeacher(needsPayload.data ?? []);
      setError("");
    } catch {
      setError(t("states.loadError"));
    } finally {
      setLoading(false);
    }
  }, [filters.teacherId, filters.status, t]);

  useEffect(() => {
    // Defer to a microtask so no state is set synchronously inside the effect body.
    void Promise.resolve().then(() => load());
  }, [load]);

  function applyFilters(next: { teacherId: string; status: string }) {
    setFilters(next);
    setLoading(true);
  }

  useEffect(() => {
    Promise.all([
      fetch("/api/admin/profiles?type=teacher"),
      fetch("/api/admin/profiles?type=student"),
    ])
      .then(async ([teacherResponse, studentResponse]) => {
        if (!teacherResponse.ok || !studentResponse.ok) throw new Error("options failed");
        const teacherPayload = await teacherResponse.json();
        const studentPayload = await studentResponse.json();
        setTeachers(((teacherPayload.data ?? []) as { id: string; displayName: string; teacherProfile?: { id: string } | null }[]).map((teacher) => ({
          id: teacher.teacherProfile?.id ?? teacher.id,
          displayName: teacher.displayName,
        })));
        setStudents(((studentPayload.data ?? []) as { id: string; displayName: string; studentProfile?: { id: string } | null }[]).map((student) => ({
          id: student.studentProfile?.id ?? student.id,
          displayName: student.displayName,
        })));
      })
      .catch(() => setError(t("states.loadError")));
  }, [t]);

  async function act(request: Promise<Response>, successMessage: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await request;
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload.error?.message ?? t("states.submitError"));
        return false;
      }
      setMessage(successMessage);
      await load();
      return true;
    } catch {
      setError(t("states.submitError"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  function createAssignment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void act(
      fetch("/api/admin/assignments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      }),
      t("messages.created"),
    ).then((ok) => {
      if (ok) setForm({ studentId: "", teacherId: "", subjectId: "" });
    });
  }

  function endAssignment(id: string) {
    const endedReason = window.prompt(t("prompts.endReason")) ?? "";
    void act(
      fetch(`/api/admin/assignments/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "END", endedReason }),
      }),
      t("messages.ended"),
    );
  }

  function changeTeacher() {
    if (!changeTeacherFor || !changeTeacherFor.newTeacherId) return;
    void act(
      fetch(`/api/admin/assignments/${changeTeacherFor.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "CHANGE_TEACHER", newTeacherId: changeTeacherFor.newTeacherId }),
      }),
      t("messages.changed"),
    ).then((ok) => {
      if (ok) setChangeTeacherFor(null);
    });
  }

  function assignNeedsTeacher(row: NeedsTeacherRow, teacherId: string) {
    if (!teacherId) return;
    void act(
      fetch("/api/admin/assignments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ studentId: row.studentId, teacherId, subjectId: row.subjectId }),
      }),
      t("messages.created"),
    );
  }

  return (
    <div className="mt-6 space-y-6">
      <section className="dashboard-card space-y-3 p-5">
        <h2 className="text-lg font-bold text-[var(--navy)]">{t("create.title")}</h2>
        <form onSubmit={createAssignment} className="grid gap-3 sm:grid-cols-4">
          <label className="text-sm">{t("create.teacher")}
            <select required value={form.teacherId} onChange={(event) => { setForm({ ...form, teacherId: event.target.value, subjectId: "" }); void loadFormSubjects(event.target.value); }} className={inputClass}>
              <option value="">{t("labels.chooseTeacher")}</option>
              {teachers.map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.displayName}</option>)}
            </select>
          </label>
          <label className="text-sm">{t("create.subject")}
            <select
              required
              value={form.subjectId}
              onChange={(event) => setForm({ ...form, subjectId: event.target.value })}
              disabled={!form.teacherId}
              className={inputClass}
            >
              <option value="">{form.teacherId ? t("labels.chooseSubject") : t("labels.chooseTeacherFirst")}</option>
              {formSubjects.map((subject) => (
                <option key={subject.id} value={subject.id}>{subject.nameEn} / {subject.nameAr}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">{t("create.student")}
            <select required value={form.studentId} onChange={(event) => setForm({ ...form, studentId: event.target.value })} className={inputClass}>
              <option value="">{t("labels.chooseStudent")}</option>
              {students.map((student) => <option key={student.id} value={student.id}>{student.displayName}</option>)}
            </select>
          </label>
          <button type="submit" disabled={busy || !form.subjectId || !form.studentId} className="cta-primary mt-1 rounded-xl px-4 py-2 text-sm disabled:opacity-50">
            {t("create.submit")}
          </button>
          <p className="text-xs opacity-60 sm:col-span-4">{t("create.subjectHint")}</p>
        </form>
      </section>

      {error ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
      {message ? <p role="status" className="text-sm opacity-75">{message}</p> : null}

      <section className="dashboard-card space-y-3 p-5">
        <h2 className="text-lg font-bold text-[var(--navy)]">{t("needsTeacher.title")}</h2>
        {loading ? (
          <p className="text-sm opacity-70">{t("states.loading")}</p>
        ) : needsTeacher.length === 0 ? (
          <p className="text-sm opacity-70">{t("needsTeacher.empty")}</p>
        ) : (
          <ul className="space-y-2">
            {needsTeacher.map((row) => (
              <li key={`${row.studentId}-${row.subjectId}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--line)] p-3 text-sm">
                <span className="font-semibold text-[var(--navy)]">{row.student.user.displayName}</span>
                <span className="opacity-70">{row.subject.nameEn} / {row.subject.nameAr}</span>
                <select
                  value=""
                  onChange={(event) => assignNeedsTeacher(row, event.target.value)}
                  disabled={busy}
                  className={inputClass}
                >
                  <option value="">{t("needsTeacher.assign")}</option>
                  {teachers.map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.displayName}</option>)}
                </select>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs opacity-60">{t("needsTeacher.hint")}</p>
      </section>

      <section className="dashboard-card space-y-3 p-5">
        <h2 className="text-lg font-bold text-[var(--navy)]">{t("list.title")}</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm">{t("list.filterTeacher")}
            <select value={filters.teacherId} onChange={(event) => applyFilters({ ...filters, teacherId: event.target.value })} className={inputClass}>
              <option value="">{t("list.anyTeacher")}</option>
              {teachers.map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.displayName}</option>)}
            </select>
          </label>
          <label className="text-sm">{t("list.filterStatus")}
            <select value={filters.status} onChange={(event) => applyFilters({ ...filters, status: event.target.value })} className={inputClass}>
              <option value="">{t("list.anyStatus")}</option>
              <option value="ACTIVE">ACTIVE</option>
              <option value="ENDED">ENDED</option>
            </select>
          </label>
        </div>
        {loading ? (
          <p className="text-sm opacity-70">{t("states.loading")}</p>
        ) : assignments.length === 0 ? (
          <p className="text-sm opacity-70">{t("list.empty")}</p>
        ) : (
          <ul className="space-y-2">
            {assignments.map((assignment) => (
              <li key={assignment.id} className="rounded-xl border border-[var(--line)] p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold text-[var(--navy)]">
                      {assignment.student.user.displayName} · {assignment.subject.nameEn} / {assignment.subject.nameAr} · {assignment.teacher.user.displayName}
                    </p>
                    <p className="mt-1 text-xs opacity-70">
                      {assignment.status === "ACTIVE" ? t("list.active") : `${t("list.ended")} ${assignment.endedAt ? new Date(assignment.endedAt).toISOString().slice(0, 10) : ""}${assignment.endedReason ? ` · ${assignment.endedReason}` : ""}`}
                    </p>
                  </div>
                  {assignment.status === "ACTIVE" ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <button type="button" disabled={busy} onClick={() => endAssignment(assignment.id)} className="rounded-xl border border-[var(--line)] px-3 py-1.5 text-xs font-semibold">
                        {t("list.end")}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setChangeTeacherFor(changeTeacherFor?.id === assignment.id ? null : { id: assignment.id, newTeacherId: "" })}
                        className="rounded-xl border border-[var(--line)] px-3 py-1.5 text-xs font-semibold"
                      >
                        {t("list.changeTeacher")}
                      </button>
                    </div>
                  ) : null}
                </div>
                {changeTeacherFor?.id === assignment.id ? (
                  <div className="mt-2 flex flex-wrap items-end gap-2 border-t border-[var(--line)] pt-2">
                    <label className="text-xs">{t("list.newTeacher")}
                      <select value={changeTeacherFor.newTeacherId} onChange={(event) => setChangeTeacherFor({ ...changeTeacherFor, newTeacherId: event.target.value })} className={inputClass}>
                        <option value="">{t("labels.chooseTeacher")}</option>
                        {teachers.filter((teacher) => teacher.id !== assignment.teacherId).map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.displayName}</option>)}
                      </select>
                    </label>
                    <button type="button" disabled={busy || !changeTeacherFor.newTeacherId} onClick={changeTeacher} className="cta-primary rounded-xl px-3 py-2 text-xs disabled:opacity-50">
                      {t("list.confirmChange")}
                    </button>
                    <p className="w-full text-xs opacity-60">{t("list.changeHint")}</p>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

