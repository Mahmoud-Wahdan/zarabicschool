"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import EmptyState from "../../../_components/ui/empty-state";
import StatusBadge from "../../../_components/ui/status-badge";

type TeacherOption = { id: string; displayName: string };
type StudentOption = { id: string; displayName: string };
type SubjectName = { nameEn: string; nameAr: string };
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
  subject: SubjectName;
  createdBy: { displayName: string };
};
type NeedsTeacherRow = {
  studentId: string;
  subjectId: string;
  student: { user: { displayName: string } };
  subject: SubjectName;
};
type Feedback = { tone: "success" | "error"; text: string } | null;
/** One open inline action at a time: end (with a reason) or change teacher. */
type OpenAction = { id: string; kind: "end"; reason: string } | { id: string; kind: "change"; newTeacherId: string } | null;

const KNOWN_ERRORS = ["DUPLICATE_ASSIGNMENT", "TEACHER_SUBJECT_NOT_ASSIGNED", "ASSIGNMENT_PARTICIPANTS_INVALID", "CONFLICT", "NOT_FOUND", "VALIDATION_ERROR"] as const;

export default function StudentAssignmentsPanel({ timeZone }: { timeZone: string }) {
  const t = useTranslations("assignmentsAdmin");
  const locale = useLocale();
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [needsTeacher, setNeedsTeacher] = useState<NeedsTeacherRow[]>([]);
  const [needsChoice, setNeedsChoice] = useState<Record<string, string>>({});
  const [teachers, setTeachers] = useState<TeacherOption[]>([]);
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [filters, setFilters] = useState({ teacherId: "", status: "ACTIVE" });
  const [form, setForm] = useState({ studentId: "", teacherId: "", subjectId: "" });
  const [open, setOpen] = useState<OpenAction>(null);
  const [formSubjects, setFormSubjects] = useState<(SubjectName & { id: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const subjectName = useCallback((subject: SubjectName) => (locale === "ar" ? subject.nameAr : subject.nameEn), [locale]);
  const dateFormat = useMemo(() => new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { timeZone, day: "numeric", month: "short", year: "numeric" }), [locale, timeZone]);

  const loadFormSubjects = useCallback(async (teacherId: string) => {
    setFormSubjects([]);
    if (!teacherId) return;
    try {
      const response = await fetch(`/api/admin/teachers/${teacherId}/context`);
      if (!response.ok) throw new Error("context failed");
      const payload = await response.json();
      setFormSubjects(payload.data?.subjects ?? []);
    } catch {
      setFeedback({ tone: "error", text: t("states.loadError") });
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
      setAssignments((await assignmentsResponse.json()).data ?? []);
      setNeedsTeacher((await needsResponse.json()).data ?? []);
    } catch {
      setFeedback({ tone: "error", text: t("states.loadError") });
    } finally {
      setLoading(false);
    }
  }, [filters.teacherId, filters.status, t]);

  useEffect(() => {
    // Defer to a microtask so no state is set synchronously inside the effect body.
    void Promise.resolve().then(() => load());
  }, [load]);

  useEffect(() => {
    Promise.all([fetch("/api/admin/profiles?type=teacher"), fetch("/api/admin/profiles?type=student")])
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
      .catch(() => setFeedback({ tone: "error", text: t("states.loadError") }));
  }, [t]);

  function applyFilters(next: { teacherId: string; status: string }) {
    setFilters(next);
    setLoading(true);
  }

  async function act(request: () => Promise<Response>, successMessage: string) {
    setBusy(true);
    setFeedback(null);
    try {
      const response = await request();
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const code = payload.error?.code as string | undefined;
        const known = KNOWN_ERRORS.find((item) => item === code);
        setFeedback({ tone: "error", text: known ? t(`errors.${known}`) : t("states.submitError") });
        return false;
      }
      setFeedback({ tone: "success", text: successMessage });
      await load();
      return true;
    } catch {
      setFeedback({ tone: "error", text: t("states.submitError") });
      return false;
    } finally {
      setBusy(false);
    }
  }

  const post = (body: unknown) => () => fetch("/api/admin/assignments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const patch = (id: string, body: unknown) => () => fetch(`/api/admin/assignments/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  function createAssignment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void act(post(form), t("messages.created")).then((ok) => {
      if (ok) {
        setForm({ studentId: "", teacherId: "", subjectId: "" });
        setFormSubjects([]);
      }
    });
  }

  function confirmOpenAction() {
    if (!open) return;
    if (open.kind === "end") {
      void act(patch(open.id, { action: "END", endedReason: open.reason.trim() }), t("messages.ended")).then((ok) => ok && setOpen(null));
    } else if (open.newTeacherId) {
      void act(patch(open.id, { action: "CHANGE_TEACHER", newTeacherId: open.newTeacherId }), t("messages.changed")).then((ok) => ok && setOpen(null));
    }
  }

  const statusBadge = (assignment: AssignmentRow) =>
    assignment.status === "ACTIVE" ? <StatusBadge tone="success">{t("list.active")}</StatusBadge> : <StatusBadge tone="neutral">{t("list.ended")}</StatusBadge>;
  const dateLine = (assignment: AssignmentRow) =>
    assignment.status === "ACTIVE"
      ? t("list.since", { date: dateFormat.format(new Date(assignment.createdAt)) })
      : `${t("list.endedOn", { date: assignment.endedAt ? dateFormat.format(new Date(assignment.endedAt)) : "—" })}${assignment.endedReason ? ` · ${assignment.endedReason}` : ""}`;

  function actions(assignment: AssignmentRow) {
    if (assignment.status !== "ACTIVE") return null;
    return (
      <div className="flex flex-wrap justify-end gap-2 md:flex-nowrap">
        <button type="button" className="btn btn-outline" disabled={busy} onClick={() => setOpen(open?.id === assignment.id && open.kind === "change" ? null : { id: assignment.id, kind: "change", newTeacherId: "" })}>
          {t("list.changeTeacher")}
        </button>
        <button type="button" className="btn btn-ghost-danger" disabled={busy} onClick={() => setOpen(open?.id === assignment.id && open.kind === "end" ? null : { id: assignment.id, kind: "end", reason: "" })}>
          {t("list.end")}
        </button>
      </div>
    );
  }

  function inlineAction(assignment: AssignmentRow) {
    if (open?.id !== assignment.id) return null;
    return (
      <div className="flex flex-col gap-2 rounded-lg bg-surface-container-low p-3 sm:flex-row sm:items-end">
        {open.kind === "end" ? (
          <label className="flex flex-1 flex-col gap-1 text-label-md text-on-surface">
            {t("list.endReason")}
            <input className="z-input" maxLength={300} value={open.reason} onChange={(event) => setOpen({ ...open, reason: event.target.value })} placeholder={t("list.endReasonPlaceholder")} />
          </label>
        ) : (
          <label className="flex flex-1 flex-col gap-1 text-label-md text-on-surface">
            {t("list.newTeacher")}
            <select className="z-input" value={open.newTeacherId} onChange={(event) => setOpen({ ...open, newTeacherId: event.target.value })}>
              <option value="">{t("labels.chooseTeacher")}</option>
              {teachers.filter((teacher) => teacher.id !== assignment.teacherId).map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.displayName}</option>)}
            </select>
          </label>
        )}
        <div className="flex gap-2">
          <button type="button" className="btn btn-outline" onClick={() => setOpen(null)} disabled={busy}>{t("list.cancel")}</button>
          <button
            type="button"
            className={open.kind === "end" ? "btn btn-ghost-danger" : "btn btn-primary"}
            disabled={busy || (open.kind === "change" && !open.newTeacherId)}
            onClick={confirmOpenAction}
          >
            {open.kind === "end" ? t("list.confirmEnd") : t("list.confirmChange")}
          </button>
        </div>
        <p className="text-body-sm text-on-surface-variant sm:max-w-xs">{open.kind === "end" ? t("list.endHint") : t("list.changeHint")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {feedback ? (
        <p role={feedback.tone === "error" ? "alert" : "status"} className={`rounded-lg px-3 py-2 text-body-sm ${feedback.tone === "success" ? "bg-secondary-fixed/30 text-on-surface" : "bg-error-container/60 text-on-error-container"}`}>
          {feedback.text}
        </p>
      ) : null}

      <section className="z-card rounded-xl p-4 sm:p-6" aria-labelledby="needs-teacher">
        <div className="flex items-center justify-between gap-2">
          <h2 id="needs-teacher" className="text-headline-sm font-semibold text-primary">{t("needsTeacher.title")}</h2>
          {needsTeacher.length ? <StatusBadge tone="pending">{t("needsTeacher.count", { count: needsTeacher.length })}</StatusBadge> : null}
        </div>
        <p className="mt-1 text-body-sm text-on-surface-variant">{t("needsTeacher.hint")}</p>
        {loading ? (
          <div className="mt-4 h-16 animate-pulse rounded-lg bg-surface-container-low" aria-busy="true" />
        ) : needsTeacher.length === 0 ? (
          <EmptyState icon="done" title={t("needsTeacher.empty")} />
        ) : (
          <ul className="mt-3 divide-y divide-outline-variant">
            {needsTeacher.map((row) => {
              const key = `${row.studentId}-${row.subjectId}`;
              return (
                <li key={key} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-body-md font-semibold text-on-surface">{row.student.user.displayName}</p>
                    <p className="text-body-sm text-on-surface-variant">{subjectName(row.subject)}</p>
                  </div>
                  <div className="flex gap-2">
                    <label className="sr-only" htmlFor={`needs-${key}`}>{t("labels.chooseTeacher")}</label>
                    <select id={`needs-${key}`} className="z-input sm:w-56" value={needsChoice[key] ?? ""} onChange={(event) => setNeedsChoice({ ...needsChoice, [key]: event.target.value })} disabled={busy}>
                      <option value="">{t("labels.chooseTeacher")}</option>
                      {teachers.map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.displayName}</option>)}
                    </select>
                    <button
                      type="button"
                      className="btn btn-primary shrink-0"
                      disabled={busy || !needsChoice[key]}
                      onClick={() => void act(post({ studentId: row.studentId, teacherId: needsChoice[key], subjectId: row.subjectId }), t("messages.created"))}
                    >
                      {t("needsTeacher.assign")}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="z-card rounded-xl p-4 sm:p-6" aria-labelledby="create-assignment">
        <h2 id="create-assignment" className="text-headline-sm font-semibold text-primary">{t("create.title")}</h2>
        <p className="mt-1 text-body-sm text-on-surface-variant">{t("create.subjectHint")}</p>
        <form onSubmit={createAssignment} className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto] md:items-end">
          <label className="flex flex-col gap-1 text-label-md text-on-surface">
            {t("create.teacher")}
            <select required className="z-input" value={form.teacherId} onChange={(event) => { setForm({ ...form, teacherId: event.target.value, subjectId: "" }); void loadFormSubjects(event.target.value); }}>
              <option value="">{t("labels.chooseTeacher")}</option>
              {teachers.map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.displayName}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-label-md text-on-surface">
            {t("create.subject")}
            <select required className="z-input" value={form.subjectId} onChange={(event) => setForm({ ...form, subjectId: event.target.value })} disabled={!form.teacherId}>
              <option value="">{form.teacherId ? t("labels.chooseSubject") : t("labels.chooseTeacherFirst")}</option>
              {formSubjects.map((subject) => <option key={subject.id} value={subject.id}>{subjectName(subject)}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-label-md text-on-surface">
            {t("create.student")}
            <select required className="z-input" value={form.studentId} onChange={(event) => setForm({ ...form, studentId: event.target.value })}>
              <option value="">{t("labels.chooseStudent")}</option>
              {students.map((student) => <option key={student.id} value={student.id}>{student.displayName}</option>)}
            </select>
          </label>
          <button type="submit" className="btn btn-primary" disabled={busy || !form.subjectId || !form.studentId}>{t("create.submit")}</button>
        </form>
      </section>

      <section className="z-card overflow-hidden rounded-xl" aria-labelledby="assignment-list">
        <div className="flex flex-col gap-3 p-4 sm:p-6 md:flex-row md:items-end md:justify-between">
          <h2 id="assignment-list" className="text-headline-sm font-semibold text-primary">{t("list.title")}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-label-md text-on-surface">
              {t("list.filterTeacher")}
              <select className="z-input" value={filters.teacherId} onChange={(event) => applyFilters({ ...filters, teacherId: event.target.value })}>
                <option value="">{t("list.anyTeacher")}</option>
                {teachers.map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.displayName}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-label-md text-on-surface">
              {t("list.filterStatus")}
              <select className="z-input" value={filters.status} onChange={(event) => applyFilters({ ...filters, status: event.target.value })}>
                <option value="">{t("list.anyStatus")}</option>
                <option value="ACTIVE">{t("list.active")}</option>
                <option value="ENDED">{t("list.ended")}</option>
              </select>
            </label>
          </div>
        </div>
        {loading ? (
          <div className="mx-4 mb-4 h-32 animate-pulse rounded-lg bg-surface-container-low sm:mx-6" aria-busy="true" />
        ) : assignments.length === 0 ? (
          <EmptyState icon="assignment" title={t("list.empty")} />
        ) : (
          <>
            <ul className="divide-y divide-outline-variant border-t border-outline-variant md:hidden">
              {assignments.map((assignment) => (
                <li key={assignment.id} className="flex flex-col gap-3 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-body-md font-semibold text-on-surface">{assignment.student.user.displayName}</p>
                      <p className="text-body-sm text-on-surface-variant">{subjectName(assignment.subject)} · {assignment.teacher.user.displayName}</p>
                      <p className="text-body-sm text-on-surface-variant">{dateLine(assignment)}</p>
                    </div>
                    {statusBadge(assignment)}
                  </div>
                  {actions(assignment)}
                  {inlineAction(assignment)}
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto md:block">
              <table className="z-table">
                <thead>
                  <tr>
                    <th scope="col">{t("create.student")}</th>
                    <th scope="col">{t("create.subject")}</th>
                    <th scope="col">{t("create.teacher")}</th>
                    <th scope="col">{t("list.status")}</th>
                    <th scope="col"><span className="sr-only">{t("list.actions")}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {assignments.map((assignment) => (
                    <Fragment key={assignment.id}>
                    <tr>
                      <td className="font-semibold text-on-surface">{assignment.student.user.displayName}</td>
                      <td>{subjectName(assignment.subject)}</td>
                      <td>{assignment.teacher.user.displayName}</td>
                      <td>
                        <div className="flex flex-col items-start gap-1">
                          {statusBadge(assignment)}
                          <span className="text-body-sm text-on-surface-variant">{dateLine(assignment)}</span>
                        </div>
                      </td>
                      <td className="w-px whitespace-nowrap">{actions(assignment)}</td>
                    </tr>
                    {open?.id === assignment.id ? (
                      <tr>
                        <td colSpan={5}>{inlineAction(assignment)}</td>
                      </tr>
                    ) : null}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
