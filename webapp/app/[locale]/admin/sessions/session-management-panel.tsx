"use client";

import { useEffect, useState } from "react";

type Option = { id: string; displayName?: string; nameEn?: string; nameAr?: string; teacherProfile?: { id: string } | null };
type Session = { id: string; scheduledStart: string; scheduledEnd: string; status: string; sessionType: string; subject: { nameEn: string; nameAr: string }; teacher: { user: { displayName: string } }; students: { student: { user: { displayName: string } } }[] };

function toIso(value: string) {
  return new Date(value).toISOString();
}

export default function SessionManagementPanel({ sessions: initialSessions }: { sessions: Session[] }) {
  const [sessions, setSessions] = useState(initialSessions);
  const [teachers, setTeachers] = useState<Option[]>([]);
  const [students, setStudents] = useState<Option[]>([]);
  const [subjects, setSubjects] = useState<Option[]>([]);
  const [form, setForm] = useState({ teacherId: "", subjectId: "", sessionType: "PRIVATE", scheduledStart: "", scheduledEnd: "", timezone: "Africa/Cairo", zoomJoinUrl: "", studentIds: [] as string[] });
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

  async function createSession(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const response = await fetch("/api/sessions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...form, scheduledStart: toIso(form.scheduledStart), scheduledEnd: toIso(form.scheduledEnd) }) });
    const payload = await response.json();
    if (!response.ok) {
      setMessage(payload.error?.message ?? "Unable to create session.");
      setBusy(false);
      return;
    }
    setMessage("Session created and student credit reserved.");
    window.location.reload();
  }

  async function cancelSession(id: string) {
    if (!window.confirm("Cancel this session and release its reserved credits?")) return;
    setBusy(true);
    const response = await fetch(`/api/sessions/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "CANCELLED", cancellationReason: "Cancelled by operations" }) });
    const payload = await response.json();
    setMessage(response.ok ? "Session cancelled and reservations released." : payload.error?.message ?? "Unable to cancel session.");
    if (response.ok) setSessions((current) => current.map((session) => session.id === id ? { ...session, status: "CANCELLED" } : session));
    setBusy(false);
  }

  return (
    <div className="mt-6 space-y-6">
      <form onSubmit={createSession} className="dashboard-card grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
        <select required value={form.teacherId} onChange={(event) => setForm({ ...form, teacherId: event.target.value })} className="rounded-xl border border-[var(--line)] px-3 py-2"><option value="">Choose teacher</option>{teachers.map((teacher) => <option key={teacher.teacherProfile?.id ?? teacher.id} value={teacher.teacherProfile?.id}>{teacher.displayName}</option>)}</select>
        <select required value={form.subjectId} onChange={(event) => setForm({ ...form, subjectId: event.target.value })} className="rounded-xl border border-[var(--line)] px-3 py-2"><option value="">Choose subject</option>{subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.nameEn} / {subject.nameAr}</option>)}</select>
        <select value={form.sessionType} onChange={(event) => setForm({ ...form, sessionType: event.target.value })} className="rounded-xl border border-[var(--line)] px-3 py-2"><option value="PRIVATE">Private</option><option value="GROUP">Group</option></select>
        <label className="text-sm">Starts<input required type="datetime-local" value={form.scheduledStart} onChange={(event) => setForm({ ...form, scheduledStart: event.target.value })} className="mt-1 w-full rounded-xl border border-[var(--line)] px-3 py-2" /></label>
        <label className="text-sm">Ends<input required type="datetime-local" value={form.scheduledEnd} onChange={(event) => setForm({ ...form, scheduledEnd: event.target.value })} className="mt-1 w-full rounded-xl border border-[var(--line)] px-3 py-2" /></label>
        <input required type="url" placeholder="Zoom join link" value={form.zoomJoinUrl} onChange={(event) => setForm({ ...form, zoomJoinUrl: event.target.value })} className="rounded-xl border border-[var(--line)] px-3 py-2" />
        <div className="rounded-xl border border-[var(--line)] p-3 sm:col-span-2 lg:col-span-3"><p className="text-sm font-semibold text-[var(--navy)]">Students</p><div className="mt-2 flex flex-wrap gap-2">{students.map((student) => <button type="button" key={student.id} onClick={() => toggleStudent(student.id)} className={`rounded-full border px-3 py-1 text-sm ${form.studentIds.includes(student.id) ? "border-[var(--emerald)] bg-[var(--emerald)]/10 text-[var(--emerald)]" : "border-[var(--line)]"}`}>{student.displayName}</button>)}</div></div>
        {message ? <p role="status" className="text-sm opacity-75 sm:col-span-2 lg:col-span-3">{message}</p> : null}
        <button disabled={busy} className="cta-primary rounded-xl px-4 py-3 disabled:opacity-50 sm:col-span-2 lg:col-span-3">Create session</button>
      </form>
      <section className="space-y-3">{sessions.map((session) => <article key={session.id} className="lift-card dashboard-card flex flex-wrap items-center justify-between gap-4 p-5"><div><p className="font-bold text-[var(--navy)]">{session.subject.nameEn} · {session.teacher.user.displayName}</p><p className="mt-1 text-sm opacity-70">{new Date(session.scheduledStart).toLocaleString()} · {session.sessionType} · {session.students.map((item) => item.student.user.displayName).join(", ")}</p></div><div className="flex items-center gap-2"><span className="rounded-full bg-[var(--gold)]/15 px-3 py-1 text-xs">{session.status}</span>{session.status === "SCHEDULED" ? <button disabled={busy} onClick={() => void cancelSession(session.id)} className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm">Cancel</button> : null}</div></article>)}</section>
    </div>
  );
}
