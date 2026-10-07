"use client";

import { useState } from "react";

type Session = {
  id: string;
  scheduledStart: string;
  sessionType: string;
  subject: { nameEn: string; nameAr: string };
  teacher: { user: { displayName: string } };
  students: { studentId: string }[];
};

type Student = { id: string; user: { displayName: string } };

export default function EnrollmentsPanel({
  sessions,
  students,
}: {
  sessions: Session[];
  students: Student[];
}) {
  const [sessionId, setSessionId] = useState("");
  const [studentId, setStudentId] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function changeEnrollment(method: "POST" | "DELETE") {
    setMessage("");
    setBusy(true);
    try {
      const response = await fetch("/api/admin/enrollments", {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, studentId }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setMessage(payload.error?.message ?? "Unable to update enrollment.");
        return;
      }
      setMessage(method === "POST" ? "Enrollment added." : "Enrollment removed.");
    } catch {
      setMessage("Unable to update enrollment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 space-y-6">
      <div className="dashboard-card grid gap-3 p-5 sm:grid-cols-[1fr_1fr_auto_auto]">
        <select required value={sessionId} onChange={(event) => setSessionId(event.target.value)} className="rounded-lg border border-[var(--line)] px-3 py-2">
          <option value="">Choose session</option>
          {sessions.map((session) => (
            <option key={session.id} value={session.id}>
              {session.subject.nameEn} · {session.teacher.user.displayName} · {new Date(session.scheduledStart).toLocaleString()}
            </option>
          ))}
        </select>
        <select required value={studentId} onChange={(event) => setStudentId(event.target.value)} className="rounded-lg border border-[var(--line)] px-3 py-2">
          <option value="">Choose student</option>
          {students.map((student) => <option key={student.id} value={student.id}>{student.user.displayName}</option>)}
        </select>
        <button disabled={!sessionId || !studentId || busy} onClick={() => void changeEnrollment("POST")} className="cta-primary rounded-lg px-3 py-2 text-sm disabled:opacity-50">Enroll</button>
        <button disabled={!sessionId || !studentId || busy} onClick={() => void changeEnrollment("DELETE")} className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm disabled:opacity-50">Remove</button>
        {message ? <p role="status" className="text-sm opacity-75 sm:col-span-4">{message}</p> : null}
      </div>

      <div className="dashboard-card p-5">
        <h2 className="font-semibold text-[var(--navy)]">Current enrollments</h2>
        <div className="mt-4 space-y-3">
          {sessions.map((session) => (
            <div key={session.id} className="rounded-lg bg-[var(--background)] p-3 text-sm">
              <strong>{session.subject.nameEn}</strong>
              <span className="mx-2 opacity-60">·</span>
              {new Date(session.scheduledStart).toLocaleString()}
              <p className="mt-2 opacity-70">
                {session.students.map((enrollment) => students.find((student) => student.id === enrollment.studentId)?.user.displayName ?? enrollment.studentId).join(", ") || "No students enrolled"}
              </p>
            </div>
          ))}
          {!sessions.length ? <p className="text-sm opacity-70">No sessions found.</p> : null}
        </div>
      </div>
    </div>
  );
}
