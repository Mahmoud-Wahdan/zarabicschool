"use client";

import { useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { useRouter } from "../../../../i18n/navigation";

type Session = {
  id: string;
  scheduledStart: string;
  sessionType: string;
  subject: { nameEn: string; nameAr: string };
  teacher: { user: { displayName: string } };
  students: { studentId: string }[];
};

type Student = { id: string; user: { displayName: string } };
type Candidate = { id: string; displayName: string };
type Candidates = { enrolled: Candidate[]; available: Candidate[] };

export default function EnrollmentsPanel({
  sessions,
  students,
  timeZone,
}: {
  sessions: Session[];
  students: Student[];
  /** The viewer's stored zone — session times render in it (time-zone audit, 2026-10-27). */
  timeZone: string;
}) {
  const t = useTranslations("management.enrollments");
  const locale = useLocale();
  const [sessionId, setSessionId] = useState("");
  const [studentId, setStudentId] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  // Only the chosen session's students: loaded from the server when the session changes.
  const [candidates, setCandidates] = useState<Candidates | null>(null);
  const [loading, setLoading] = useState(false);
  // A newer request wins: a slow answer for a previously chosen session is ignored.
  const latestRequest = useRef(0);

  async function loadCandidates(id: string) {
    const request = ++latestRequest.current;
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/enrollments?sessionId=${encodeURIComponent(id)}`, { cache: "no-store" });
      if (!response.ok) throw new Error("load");
      const data = (await response.json()).data as Candidates;
      if (request === latestRequest.current) setCandidates(data);
    } catch {
      if (request === latestRequest.current) {
        setCandidates(null);
        setMessage(t("loadFailure"));
      }
    } finally {
      if (request === latestRequest.current) setLoading(false);
    }
  }

  function chooseSession(id: string) {
    setSessionId(id);
    setStudentId("");
    setCandidates(null);
    setMessage("");
    if (id) void loadCandidates(id);
    else {
      latestRequest.current += 1;
      setLoading(false);
    }
  }

  const canEnroll = Boolean(candidates?.available.some((student) => student.id === studentId));
  const canRemove = Boolean(candidates?.enrolled.some((student) => student.id === studentId));

  function label(session: Session) {
    const subject = locale === "ar" ? session.subject.nameAr : session.subject.nameEn;
    const when = new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { timeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date(session.scheduledStart));
    return `${subject} · ${session.teacher.user.displayName} · ${when}`;
  }

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
        setMessage(payload.error?.message ?? t("failure"));
        return;
      }
      setMessage(method === "POST" ? t("added") : t("removed"));
      setStudentId("");
      void loadCandidates(sessionId);
      router.refresh();
    } catch {
      setMessage(t("failure"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 space-y-6">
      <div className="dashboard-card grid gap-3 p-5 sm:grid-cols-[1fr_1fr_auto_auto]">
        <select required value={sessionId} onChange={(event) => chooseSession(event.target.value)} className="rounded-lg border border-[var(--line)] px-3 py-2">
          <option value="">{t("chooseSession")}</option>
          {sessions.map((session) => (
            <option key={session.id} value={session.id}>
              {label(session)}
            </option>
          ))}
        </select>
        <select
          required
          value={studentId}
          onChange={(event) => setStudentId(event.target.value)}
          disabled={!sessionId || loading || !candidates}
          aria-busy={loading}
          className="rounded-lg border border-[var(--line)] px-3 py-2 disabled:opacity-60"
        >
          <option value="">{!sessionId ? t("chooseSessionFirst") : loading ? t("loadingStudents") : t("chooseStudent")}</option>
          {candidates && candidates.available.length > 0 ? (
            <optgroup label={t("availableGroup")}>
              {candidates.available.map((student) => <option key={student.id} value={student.id}>{student.displayName}</option>)}
            </optgroup>
          ) : null}
          {candidates && candidates.enrolled.length > 0 ? (
            <optgroup label={t("enrolledGroup")}>
              {candidates.enrolled.map((student) => <option key={student.id} value={student.id}>{student.displayName}</option>)}
            </optgroup>
          ) : null}
        </select>
        <button disabled={!canEnroll || busy} onClick={() => void changeEnrollment("POST")} className="cta-primary rounded-lg px-3 py-2 text-sm disabled:opacity-50">{t("enroll")}</button>
        <button disabled={!canRemove || busy} onClick={() => void changeEnrollment("DELETE")} className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm disabled:opacity-50">{t("remove")}</button>
        {sessionId && candidates && !loading && candidates.available.length === 0 && candidates.enrolled.length === 0 ? (
          <p className="text-sm opacity-75 sm:col-span-4">{t("noCandidates")}</p>
        ) : null}
        {message ? <p role="status" className="text-sm opacity-75 sm:col-span-4">{message}</p> : null}
      </div>

      <div className="dashboard-card p-5">
        <h2 className="font-semibold text-[var(--navy)]">{t("current")}</h2>
        <div className="mt-4 space-y-3">
          {sessions.map((session) => (
            <div key={session.id} className="rounded-lg bg-[var(--background)] p-3 text-sm">
              <strong>{locale === "ar" ? session.subject.nameAr : session.subject.nameEn}</strong>
              <span className="mx-2 opacity-60">·</span>
              {new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { timeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date(session.scheduledStart))}
              <p className="mt-2 opacity-70">
                {session.students.map((enrollment) => students.find((student) => student.id === enrollment.studentId)?.user.displayName ?? enrollment.studentId).join(locale === "ar" ? "، " : ", ") || t("noStudents")}
              </p>
            </div>
          ))}
          {!sessions.length ? <p className="text-sm opacity-70">{t("noSessions")}</p> : null}
        </div>
      </div>
    </div>
  );
}
