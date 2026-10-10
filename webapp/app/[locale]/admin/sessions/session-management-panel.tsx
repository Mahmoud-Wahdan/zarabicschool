"use client";

import { useEffect, useState } from "react";

import { formatSessionDateTime } from "../../../../lib/schedules/display";
import { wallClockInputToUtc } from "../../../../lib/schedules/recurrence";

type Option = { id: string; displayName?: string; nameEn?: string; nameAr?: string; teacherProfile?: { id: string } | null };
type Session = { id: string; scheduledStart: string; scheduledEnd: string; status: string; sessionType: string; timezone: string; subject: { nameEn: string; nameAr: string }; teacher: { user: { displayName: string } }; students: { student: { user: { displayName: string } } }[] };
type Series = { id: string; status: string; timezone: string; totalWeeks: number; generatedThroughWeek: number; sessionType: string; subject: { nameEn: string; nameAr: string }; teacher: { user: { displayName: string } } };
type ChangeRequest = { id: string; reason: string; proposedChange: string; createdAt: string; teacher: { user: { displayName: string } }; session: { id: string; scheduledStart: string; subject: { nameEn: string; nameAr: string } } };

const TIMEZONES = ["Africa/Cairo", "Asia/Riyadh", "Asia/Dubai", "Europe/London", "America/New_York", "UTC"];

function toIsoInTz(value: string, timeZone: string) {
  return wallClockInputToUtc(value, timeZone).toISOString();
}

const inputClass = "mt-1 w-full rounded-xl border border-[var(--line)] px-3 py-2";

export default function SessionManagementPanel({ viewerTimezone, locale, sessions: initialSessions, series, changeRequests }: { viewerTimezone: string; locale: string; sessions: Session[]; series: Series[]; changeRequests: ChangeRequest[] }) {
  const [sessions, setSessions] = useState(initialSessions);
  const [teachers, setTeachers] = useState<Option[]>([]);
  const [students, setStudents] = useState<Option[]>([]);
  const [subjects, setSubjects] = useState<Option[]>([]);
  const [form, setForm] = useState({ teacherId: "", subjectId: "", sessionType: "PRIVATE", scheduledStart: "", scheduledEnd: "", timezone: viewerTimezone, zoomJoinUrl: "", zoomHostUrl: "", studentIds: [] as string[] });
  const [seriesForm, setSeriesForm] = useState({ teacherId: "", subjectId: "", sessionType: "PRIVATE", scheduledStart: "", scheduledEnd: "", timezone: viewerTimezone, zoomJoinUrl: "", zoomHostUrl: "", weekCount: 8, studentIds: [] as string[] });
  const [filters, setFilters] = useState({ status: "", from: "", to: "", teacherId: "", studentId: "" });
  const [reschedule, setReschedule] = useState<{ id: string; start: string; end: string } | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([fetch("/api/admin/profiles?type=teacher"), fetch("/api/admin/profiles?type=student"), fetch("/api/subjects")])
      .then(async ([teacherResponse, studentResponse, subjectResponse]) => {
        const [teacherPayload, studentPayload, subjectPayload] = await Promise.all([teacherResponse.json(), studentResponse.json(), subjectResponse.json()]);
        setTeachers(teacherPayload.data ?? []);
        setStudents(studentPayload.data ?? []);
        setSubjects(subjectPayload.data ?? subjectPayload);
      })
      .catch(() => setMessage("Unable to load session options."));
  }, []);

  function toggleStudent(id: string) {
    setForm((current) => ({ ...current, studentIds: current.studentIds.includes(id) ? current.studentIds.filter((item) => item !== id) : [...current.studentIds, id] }));
  }

  function toggleSeriesStudent(id: string) {
    setSeriesForm((current) => ({ ...current, studentIds: current.studentIds.includes(id) ? current.studentIds.filter((item) => item !== id) : [...current.studentIds, id] }));
  }

  async function refreshSessions(nextFilters: typeof filters) {
    const params = new URLSearchParams();
    if (nextFilters.status) params.set("status", nextFilters.status);
    if (nextFilters.from) params.set("from", toIsoInTz(nextFilters.from, viewerTimezone));
    if (nextFilters.to) params.set("to", toIsoInTz(nextFilters.to, viewerTimezone));
    if (nextFilters.teacherId) params.set("teacherId", nextFilters.teacherId);
    if (nextFilters.studentId) params.set("studentId", nextFilters.studentId);
    const response = await fetch(`/api/sessions?${params.toString()}`);
    const payload = await response.json();
    if (response.ok) setSessions(payload.data ?? []);
    else setMessage(payload.error?.message ?? "Unable to filter sessions.");
  }

  async function createSession(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const response = await fetch("/api/sessions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...form, scheduledStart: toIsoInTz(form.scheduledStart, form.timezone), scheduledEnd: toIsoInTz(form.scheduledEnd, form.timezone), zoomHostUrl: form.zoomHostUrl || undefined }) });
    const payload = await response.json();
    if (!response.ok) {
      setMessage(payload.error?.message ?? "Unable to create session.");
      setBusy(false);
      return;
    }
    setMessage("Session created and student credit reserved.");
    window.location.reload();
  }

  async function createSeries(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const response = await fetch("/api/sessions/recurrences", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...seriesForm, scheduledStart: toIsoInTz(seriesForm.scheduledStart, seriesForm.timezone), scheduledEnd: toIsoInTz(seriesForm.scheduledEnd, seriesForm.timezone), zoomHostUrl: seriesForm.zoomHostUrl || undefined }) });
    const payload = await response.json();
    if (!response.ok) {
      setMessage(payload.error?.message ?? "Unable to create the series.");
      setBusy(false);
      return;
    }
    const generated = payload.data?.sessions?.length ?? 0;
    setMessage(`Series created: ${generated} of ${seriesForm.weekCount} weeks generated now; the worker continues the rest when credit is available.`);
    window.location.reload();
  }

  async function cancelSession(id: string) {
    if (!window.confirm("Cancel this session and release its reserved credits?")) return;
    setBusy(true);
    const response = await fetch(`/api/sessions/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "CANCELLED", cancellationReason: "Cancelled by operations" }) });
    const payload = await response.json();
    setMessage(response.ok ? "Session cancelled, reservations released, and reminders stopped." : payload.error?.message ?? "Unable to cancel session.");
    if (response.ok) setSessions((current) => current.map((session) => session.id === id ? { ...session, status: "CANCELLED" } : session));
    setBusy(false);
  }

  async function applyReschedule(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reschedule) return;
    setBusy(true);
    const target = sessions.find((session) => session.id === reschedule.id);
    if (!target) return;
    const response = await fetch(`/api/sessions/${reschedule.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ scheduledStart: toIsoInTz(reschedule.start, target.timezone), scheduledEnd: toIsoInTz(reschedule.end, target.timezone) }) });
    const payload = await response.json();
    setMessage(response.ok ? "Session rescheduled and reminders moved." : payload.error?.message ?? "Unable to reschedule session.");
    if (response.ok) {
      setSessions((current) => current.map((session) => session.id === reschedule.id ? { ...session, scheduledStart: toIsoInTz(reschedule.start, target.timezone), scheduledEnd: toIsoInTz(reschedule.end, target.timezone) } : session));
      setReschedule(null);
    }
    setBusy(false);
  }

  async function reviewChangeRequest(id: string, status: "APPROVED" | "REJECTED") {
    setBusy(true);
    const response = await fetch(`/api/session-change-requests/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) });
    const payload = await response.json();
    setMessage(response.ok ? `Change request ${status.toLowerCase()}.` : payload.error?.message ?? "Unable to review the request.");
    setBusy(false);
  }

  return (
    <div className="mt-6 space-y-6">
      {changeRequests.length ? (
        <section className="dashboard-card space-y-3 p-5">
          <h2 className="text-lg font-bold text-[var(--navy)]">Teacher change requests</h2>
          {changeRequests.map((changeRequest) => (
            <article key={changeRequest.id} className="rounded-xl border border-[var(--line)] p-4">
              <p className="text-sm font-semibold text-[var(--navy)]">{changeRequest.teacher.user.displayName} · {changeRequest.session.subject.nameEn} · {formatSessionDateTime(changeRequest.session.scheduledStart, viewerTimezone, locale)}</p>
              <p className="mt-1 text-sm opacity-75">Reason: {changeRequest.reason}</p>
              <p className="text-sm opacity-75">Proposed change: {changeRequest.proposedChange}</p>
              <div className="mt-2 flex gap-2">
                <button disabled={busy} onClick={() => void reviewChangeRequest(changeRequest.id, "APPROVED")} className="rounded-xl bg-[var(--emerald)] px-3 py-2 text-sm font-semibold text-white">Approve</button>
                <button disabled={busy} onClick={() => void reviewChangeRequest(changeRequest.id, "REJECTED")} className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm">Reject</button>
              </div>
            </article>
          ))}
        </section>
      ) : null}

      {series.length ? (
        <section className="dashboard-card space-y-3 p-5">
          <h2 className="text-lg font-bold text-[var(--navy)]">Recurring series</h2>
          {series.map((item) => (
            <article key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--line)] p-4">
              <div>
                <p className="font-semibold text-[var(--navy)]">{item.subject.nameEn} · {item.teacher.user.displayName} · {item.sessionType}</p>
                <p className="mt-1 text-sm opacity-70">{item.generatedThroughWeek + 1} of {item.totalWeeks} weeks generated · times shown in {item.timezone}</p>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs ${item.status === "PAUSED" ? "bg-[var(--gold)]/25" : "bg-[var(--emerald)]/10 text-[var(--emerald)]"}`}>{item.status}</span>
            </article>
          ))}
        </section>
      ) : null}

      <section className="dashboard-card space-y-3 p-5">
        <h2 className="text-lg font-bold text-[var(--navy)]">Filters</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })} className={inputClass}>
            <option value="">Any status</option>
            {["SCHEDULED", "COMPLETED", "MISSED", "CANCELLED"].map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
          <label className="text-sm">From<input type="datetime-local" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} className={inputClass} /></label>
          <label className="text-sm">To<input type="datetime-local" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} className={inputClass} /></label>
          <select value={filters.teacherId} onChange={(event) => setFilters({ ...filters, teacherId: event.target.value })} className={inputClass}>
            <option value="">Any teacher</option>
            {teachers.map((teacher) => <option key={teacher.teacherProfile?.id ?? teacher.id} value={teacher.teacherProfile?.id}>{teacher.displayName}</option>)}
          </select>
          <select value={filters.studentId} onChange={(event) => setFilters({ ...filters, studentId: event.target.value })} className={inputClass}>
            <option value="">Any student</option>
            {students.map((student) => <option key={student.id} value={student.id}>{student.displayName}</option>)}
          </select>
        </div>
        <button disabled={busy} onClick={() => void refreshSessions(filters)} className="cta-primary rounded-xl px-4 py-2 text-sm">Apply filters</button>
      </section>

      <details className="dashboard-card p-5">
        <summary className="cursor-pointer text-lg font-bold text-[var(--navy)]">New weekly series</summary>
        <form onSubmit={createSeries} className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <select required value={seriesForm.teacherId} onChange={(event) => setSeriesForm({ ...seriesForm, teacherId: event.target.value })} className={inputClass}><option value="">Choose teacher</option>{teachers.map((teacher) => <option key={teacher.teacherProfile?.id ?? teacher.id} value={teacher.teacherProfile?.id}>{teacher.displayName}</option>)}</select>
          <select required value={seriesForm.subjectId} onChange={(event) => setSeriesForm({ ...seriesForm, subjectId: event.target.value })} className={inputClass}><option value="">Choose subject</option>{subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.nameEn} / {subject.nameAr}</option>)}</select>
          <select value={seriesForm.sessionType} onChange={(event) => setSeriesForm({ ...seriesForm, sessionType: event.target.value })} className={inputClass}><option value="PRIVATE">Private</option><option value="GROUP">Group</option></select>
          <label className="text-sm">First session (local time)<input required type="datetime-local" value={seriesForm.scheduledStart} onChange={(event) => setSeriesForm({ ...seriesForm, scheduledStart: event.target.value })} className={inputClass} /></label>
          <label className="text-sm">First session end<input required type="datetime-local" value={seriesForm.scheduledEnd} onChange={(event) => setSeriesForm({ ...seriesForm, scheduledEnd: event.target.value })} className={inputClass} /></label>
          <label className="text-sm">Timezone<select value={seriesForm.timezone} onChange={(event) => setSeriesForm({ ...seriesForm, timezone: event.target.value })} className={inputClass}>{TIMEZONES.map((timeZone) => <option key={timeZone} value={timeZone}>{timeZone}</option>)}</select></label>
          <input required type="url" pattern="https://.*" placeholder="Zoom join link (https)" value={seriesForm.zoomJoinUrl} onChange={(event) => setSeriesForm({ ...seriesForm, zoomJoinUrl: event.target.value })} className={inputClass} />
          <input type="url" pattern="https://.*" placeholder="Zoom host link (optional)" value={seriesForm.zoomHostUrl} onChange={(event) => setSeriesForm({ ...seriesForm, zoomHostUrl: event.target.value })} className={inputClass} />
          <label className="text-sm">Total weeks<input required type="number" min={1} max={52} value={seriesForm.weekCount} onChange={(event) => setSeriesForm({ ...seriesForm, weekCount: Number(event.target.value) })} className={inputClass} /></label>
          <div className="rounded-xl border border-[var(--line)] p-3 sm:col-span-2 lg:col-span-3"><p className="text-sm font-semibold text-[var(--navy)]">Students (a week is generated only when every student has credit)</p><div className="mt-2 flex flex-wrap gap-2">{students.map((student) => <button type="button" key={student.id} onClick={() => toggleSeriesStudent(student.id)} className={`rounded-full border px-3 py-1 text-sm ${seriesForm.studentIds.includes(student.id) ? "border-[var(--emerald)] bg-[var(--emerald)]/10 text-[var(--emerald)]" : "border-[var(--line)]"}`}>{student.displayName}</button>)}</div></div>
          <button disabled={busy} className="cta-primary rounded-xl px-4 py-3 disabled:opacity-50 sm:col-span-2 lg:col-span-3">Create series</button>
        </form>
      </details>

      <details className="dashboard-card p-5">
        <summary className="cursor-pointer text-lg font-bold text-[var(--navy)]">New single session</summary>
        <form onSubmit={createSession} className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <select required value={form.teacherId} onChange={(event) => setForm({ ...form, teacherId: event.target.value })} className={inputClass}><option value="">Choose teacher</option>{teachers.map((teacher) => <option key={teacher.teacherProfile?.id ?? teacher.id} value={teacher.teacherProfile?.id}>{teacher.displayName}</option>)}</select>
          <select required value={form.subjectId} onChange={(event) => setForm({ ...form, subjectId: event.target.value })} className={inputClass}><option value="">Choose subject</option>{subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.nameEn} / {subject.nameAr}</option>)}</select>
          <select value={form.sessionType} onChange={(event) => setForm({ ...form, sessionType: event.target.value })} className={inputClass}><option value="PRIVATE">Private</option><option value="GROUP">Group</option></select>
          <label className="text-sm">Starts<input required type="datetime-local" value={form.scheduledStart} onChange={(event) => setForm({ ...form, scheduledStart: event.target.value })} className={inputClass} /></label>
          <label className="text-sm">Ends<input required type="datetime-local" value={form.scheduledEnd} onChange={(event) => setForm({ ...form, scheduledEnd: event.target.value })} className={inputClass} /></label>
          <label className="text-sm">Timezone<select value={form.timezone} onChange={(event) => setForm({ ...form, timezone: event.target.value })} className={inputClass}>{TIMEZONES.map((timeZone) => <option key={timeZone} value={timeZone}>{timeZone}</option>)}</select></label>
          <input required type="url" pattern="https://.*" placeholder="Zoom join link (https)" value={form.zoomJoinUrl} onChange={(event) => setForm({ ...form, zoomJoinUrl: event.target.value })} className={inputClass} />
          <input type="url" pattern="https://.*" placeholder="Zoom host link (optional)" value={form.zoomHostUrl} onChange={(event) => setForm({ ...form, zoomHostUrl: event.target.value })} className={inputClass} />
          <div className="rounded-xl border border-[var(--line)] p-3 sm:col-span-2 lg:col-span-3"><p className="text-sm font-semibold text-[var(--navy)]">Students</p><div className="mt-2 flex flex-wrap gap-2">{students.map((student) => <button type="button" key={student.id} onClick={() => toggleStudent(student.id)} className={`rounded-full border px-3 py-1 text-sm ${form.studentIds.includes(student.id) ? "border-[var(--emerald)] bg-[var(--emerald)]/10 text-[var(--emerald)]" : "border-[var(--line)]"}`}>{student.displayName}</button>)}</div></div>
          <button disabled={busy} className="cta-primary rounded-xl px-4 py-3 disabled:opacity-50 sm:col-span-2 lg:col-span-3">Create session</button>
        </form>
      </details>

      {message ? <p role="status" className="text-sm opacity-75">{message}</p> : null}

      <section className="space-y-3">
        {sessions.map((session) => (
          <article key={session.id} className="lift-card dashboard-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="font-bold text-[var(--navy)]">{session.subject.nameEn} · {session.teacher.user.displayName}</p>
                <p className="mt-1 text-sm opacity-70">{formatSessionDateTime(session.scheduledStart, viewerTimezone, locale)} · {session.sessionType} · {session.students.map((item) => item.student.user.displayName).join(", ")}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-[var(--gold)]/15 px-3 py-1 text-xs">{session.status}</span>
                {session.status === "SCHEDULED" ? (
                  <>
                    <button type="button" onClick={() => setReschedule(reschedule?.id === session.id ? null : { id: session.id, start: "", end: "" })} className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm">Reschedule</button>
                    <button disabled={busy} onClick={() => void cancelSession(session.id)} className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm">Cancel</button>
                  </>
                ) : null}
              </div>
            </div>
            {reschedule?.id === session.id ? (
              <form onSubmit={applyReschedule} className="mt-3 grid gap-3 border-t border-[var(--line)] pt-3 sm:grid-cols-3">
                <label className="text-sm">New start ({session.timezone})<input required type="datetime-local" value={reschedule.start} onChange={(event) => setReschedule({ ...reschedule, start: event.target.value })} className={inputClass} /></label>
                <label className="text-sm">New end ({session.timezone})<input required type="datetime-local" value={reschedule.end} onChange={(event) => setReschedule({ ...reschedule, end: event.target.value })} className={inputClass} /></label>
                <button disabled={busy} className="cta-primary mt-6 h-10 rounded-xl px-4">Save new time</button>
              </form>
            ) : null}
          </article>
        ))}
        {!sessions.length ? <p className="dashboard-card p-5 text-sm opacity-70">No sessions match the current filters.</p> : null}
      </section>
    </div>
  );
}
