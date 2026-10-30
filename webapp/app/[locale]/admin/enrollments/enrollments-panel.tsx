"use client";

import { useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { useRouter } from "../../../../i18n/navigation";
import EmptyState from "../../../_components/ui/empty-state";
import Icon from "../../../_components/ui/icon";
import StatusBadge from "../../../_components/ui/status-badge";

type Session = {
  id: string;
  scheduledStart: string;
  scheduledEnd: string;
  status: string;
  sessionType: string;
  subject: { nameEn: string; nameAr: string };
  teacher: { user: { displayName: string } };
  students: { studentId: string }[];
};

type Student = { id: string; user: { displayName: string } };
type Candidate = { id: string; displayName: string };
type Candidates = { enrolled: Candidate[]; available: Candidate[] };
type Feedback = { tone: "success" | "error"; text: string } | null;

/** Codes the add/remove calls answer with; anything else shows the generic failure. */
const KNOWN_ERRORS = [
  "RENEWAL_PAST_DUE",
  "INSUFFICIENT_SESSION_CREDIT",
  "STUDENT_NOT_ASSIGNED_TO_TEACHER_SUBJECT",
  "STUDENT_NOT_FOUND_OR_INACTIVE",
  "PRIVATE_SESSION_FULL",
  "PRIVATE_SESSION_CANCEL_INSTEAD",
  "SESSION_ALREADY_ENDED",
  "SESSION_NOT_SCHEDULED",
  "REPORT_EXISTS",
  "ATTENDANCE_SETTLED",
  "CONFLICT",
] as const;

export default function EnrollmentsPanel({
  sessions,
  students,
  timeZone,
  now,
}: {
  sessions: Session[];
  students: Student[];
  /** The viewer's stored zone — session times render in it (time-zone audit, 2026-10-27). */
  timeZone: string;
  /** Server time (ISO), so "upcoming" and "ended" match on server and client. */
  now: string;
}) {
  const t = useTranslations("management.enrollments");
  const locale = useLocale();
  const router = useRouter();
  const [sessionId, setSessionId] = useState("");
  const [query, setQuery] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busyStudentId, setBusyStudentId] = useState<string | null>(null);
  // Only the chosen session's students: loaded from the server when the session changes.
  const [candidates, setCandidates] = useState<Candidates | null>(null);
  const [loading, setLoading] = useState(false);
  // A newer request wins: a slow answer for a previously chosen session is ignored.
  const latestRequest = useRef(0);

  const dateTime = useMemo(
    () => new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { timeZone, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }),
    [locale, timeZone],
  );
  const nowMs = new Date(now).getTime();
  const upcoming = sessions
    .filter((session) => new Date(session.scheduledEnd).getTime() > nowMs && session.status === "SCHEDULED")
    .sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart));
  const ended = sessions.filter((session) => !upcoming.includes(session));
  const selected = sessions.find((session) => session.id === sessionId) ?? null;
  const studentName = useMemo(() => new Map(students.map((student) => [student.id, student.user.displayName])), [students]);

  const subjectOf = (session: Session) => (locale === "ar" ? session.subject.nameAr : session.subject.nameEn);
  const optionLabel = (session: Session) => `${subjectOf(session)} · ${session.teacher.user.displayName} · ${dateTime.format(new Date(session.scheduledStart))}`;

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
        setFeedback({ tone: "error", text: t("loadFailure") });
      }
    } finally {
      if (request === latestRequest.current) setLoading(false);
    }
  }

  function chooseSession(id: string) {
    setSessionId(id);
    setCandidates(null);
    setFeedback(null);
    setQuery("");
    if (id) {
      void loadCandidates(id);
    } else {
      latestRequest.current += 1;
      setLoading(false);
    }
  }

  async function changeEnrollment(method: "POST" | "DELETE", student: Candidate) {
    setFeedback(null);
    setBusyStudentId(student.id);
    try {
      const response = await fetch("/api/admin/enrollments", {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, studentId: student.id }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const code = payload?.error?.code as string | undefined;
        const known = KNOWN_ERRORS.find((item) => item === code);
        setFeedback({ tone: "error", text: known ? t(`errors.${known}`) : t("failure") });
        return;
      }
      setFeedback({ tone: "success", text: t(method === "POST" ? "addedName" : "removedName", { name: student.displayName }) });
      void loadCandidates(sessionId);
      router.refresh();
    } catch {
      setFeedback({ tone: "error", text: t("failure") });
    } finally {
      setBusyStudentId(null);
    }
  }

  const isPrivate = selected?.sessionType === "PRIVATE";
  const privateFull = Boolean(isPrivate && candidates && candidates.enrolled.length >= 1);
  const canChange = Boolean(selected && upcoming.includes(selected));
  const needle = query.trim().toLocaleLowerCase(locale);
  const available = (candidates?.available ?? []).filter((student) => !needle || student.displayName.toLocaleLowerCase(locale).includes(needle));

  return (
    <div className="mt-4 flex flex-col gap-6">
      <section className="z-card rounded-xl p-4 sm:p-6" aria-labelledby="enroll-manage">
        <h2 id="enroll-manage" className="text-headline-sm font-semibold text-primary">{t("manageTitle")}</h2>
        <p className="mt-1 text-body-sm text-on-surface-variant">{t("manageHint")}</p>
        <div className="mt-4 flex max-w-2xl flex-col gap-1.5">
          <label htmlFor="enroll-session" className="text-label-md text-on-surface">{t("sessionLabel")}</label>
          <select id="enroll-session" value={sessionId} onChange={(event) => chooseSession(event.target.value)} className="z-input">
            <option value="">{t("chooseSession")}</option>
            {upcoming.length ? (
              <optgroup label={t("upcomingGroup")}>
                {upcoming.map((session) => <option key={session.id} value={session.id}>{optionLabel(session)}</option>)}
              </optgroup>
            ) : null}
            {ended.length ? (
              <optgroup label={t("endedGroup")}>
                {ended.map((session) => <option key={session.id} value={session.id}>{optionLabel(session)}</option>)}
              </optgroup>
            ) : null}
          </select>
        </div>

        {selected ? (
          <div className="mt-5 flex flex-col gap-5">
            <dl className="grid gap-3 rounded-lg bg-surface-container-low p-4 sm:grid-cols-4">
              <div>
                <dt className="text-label-sm text-on-surface-variant">{t("summary.subject")}</dt>
                <dd className="text-body-md font-semibold text-on-surface">{subjectOf(selected)}</dd>
              </div>
              <div>
                <dt className="text-label-sm text-on-surface-variant">{t("summary.teacher")}</dt>
                <dd className="text-body-md text-on-surface">{selected.teacher.user.displayName}</dd>
              </div>
              <div>
                <dt className="text-label-sm text-on-surface-variant">{t("summary.time")}</dt>
                <dd className="text-body-md text-on-surface tabular-nums">{dateTime.format(new Date(selected.scheduledStart))}</dd>
              </div>
              <div>
                <dt className="text-label-sm text-on-surface-variant">{t("summary.type")}</dt>
                <dd className="mt-0.5">
                  <StatusBadge tone={isPrivate ? "neutral" : "info"}>{t(isPrivate ? "summary.private" : "summary.group")}</StatusBadge>
                </dd>
              </div>
            </dl>

            {!canChange ? <p className="text-body-sm text-on-surface-variant">{t("endedNote")}</p> : null}
            {feedback ? (
              <p role="status" className={`rounded-lg px-3 py-2 text-body-sm ${feedback.tone === "success" ? "bg-secondary-fixed/30 text-on-surface" : "bg-error-container/60 text-on-error-container"}`}>
                {feedback.text}
              </p>
            ) : null}

            {loading && !candidates ? (
              <div className="grid gap-4 md:grid-cols-2" aria-busy="true" aria-label={t("loadingStudents")}>
                {[0, 1].map((key) => <div key={key} className="h-40 animate-pulse rounded-lg bg-surface-container-low" />)}
              </div>
            ) : candidates ? (
              <div className="grid gap-4 md:grid-cols-2">
                <section aria-labelledby="enroll-enrolled" className="rounded-lg border border-outline-variant p-4">
                  <div className="flex items-center justify-between gap-2">
                    <h3 id="enroll-enrolled" className="text-title-md font-semibold text-on-surface">{t("enrolledGroup")}</h3>
                    <span className="text-label-md text-on-surface-variant tabular-nums">{candidates.enrolled.length}</span>
                  </div>
                  {candidates.enrolled.length ? (
                    <ul className="mt-3 divide-y divide-outline-variant">
                      {candidates.enrolled.map((student) => (
                        <li key={student.id} className="flex items-center justify-between gap-3 py-2.5">
                          <span className="text-body-md text-on-surface">{student.displayName}</span>
                          {canChange && !isPrivate ? (
                            <button
                              type="button"
                              className="btn btn-ghost-danger"
                              disabled={busyStudentId !== null}
                              aria-label={t("removeName", { name: student.displayName })}
                              onClick={() => void changeEnrollment("DELETE", student)}
                            >
                              {t("remove")}
                            </button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <EmptyState icon="group" title={t("noStudents")} />
                  )}
                  {isPrivate && candidates.enrolled.length ? <p className="mt-2 text-body-sm text-on-surface-variant">{t("privateNoRemove")}</p> : null}
                </section>

                <section aria-labelledby="enroll-available" className="rounded-lg border border-outline-variant p-4">
                  <div className="flex items-center justify-between gap-2">
                    <h3 id="enroll-available" className="text-title-md font-semibold text-on-surface">{t("availableTitle")}</h3>
                    <span className="text-label-md text-on-surface-variant tabular-nums">{candidates.available.length}</span>
                  </div>
                  <p className="mt-1 text-body-sm text-on-surface-variant">{t("availableHint")}</p>
                  {privateFull ? <p className="mt-3 text-body-sm text-on-surface-variant">{t("privateFull")}</p> : null}
                  {candidates.available.length > 6 ? (
                    <label className="mt-3 flex items-center gap-2">
                      <span className="sr-only">{t("search")}</span>
                      <Icon name="search" size={18} />
                      <input type="search" className="z-input" placeholder={t("search")} value={query} onChange={(event) => setQuery(event.target.value)} />
                    </label>
                  ) : null}
                  {available.length ? (
                    <ul className="mt-3 divide-y divide-outline-variant">
                      {available.map((student) => (
                        <li key={student.id} className="flex items-center justify-between gap-3 py-2.5">
                          <span className="text-body-md text-on-surface">{student.displayName}</span>
                          {canChange && !privateFull ? (
                            <button
                              type="button"
                              className="btn btn-soft"
                              disabled={busyStudentId !== null}
                              aria-label={t("addName", { name: student.displayName })}
                              onClick={() => void changeEnrollment("POST", student)}
                            >
                              {busyStudentId === student.id ? t("adding") : t("enroll")}
                            </button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <EmptyState icon="person" title={needle ? t("noMatch") : t("noCandidates")} />
                  )}
                </section>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="z-card overflow-hidden rounded-xl" aria-labelledby="enroll-current">
        <div className="flex items-baseline justify-between gap-2 p-4 sm:px-6">
          <h2 id="enroll-current" className="text-headline-sm font-semibold text-primary">{t("current")}</h2>
          <span className="text-body-sm text-on-surface-variant">{t("currentHint")}</span>
        </div>
        {upcoming.length ? (
          <>
            <ul className="divide-y divide-outline-variant border-t border-outline-variant sm:hidden">
              {upcoming.map((session) => (
                <li key={session.id} className="flex items-start justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="text-body-md font-semibold text-on-surface">{subjectOf(session)}</p>
                    <p className="text-body-sm text-on-surface-variant tabular-nums">{dateTime.format(new Date(session.scheduledStart))} · {session.teacher.user.displayName}</p>
                    <p className="mt-1 text-body-sm text-on-surface">
                      {session.students.map((row) => studentName.get(row.studentId) ?? "—").join(locale === "ar" ? "، " : ", ") || t("noStudents")}
                    </p>
                  </div>
                  <button type="button" className="btn btn-outline shrink-0" onClick={() => { chooseSession(session.id); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
                    {t("manage")}
                  </button>
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto sm:block">
            <table className="z-table">
              <thead>
                <tr>
                  <th scope="col">{t("summary.subject")}</th>
                  <th scope="col">{t("summary.time")}</th>
                  <th scope="col">{t("summary.teacher")}</th>
                  <th scope="col">{t("studentsColumn")}</th>
                  <th scope="col"><span className="sr-only">{t("manageTitle")}</span></th>
                </tr>
              </thead>
              <tbody>
                {upcoming.map((session) => (
                  <tr key={session.id}>
                    <td className="font-semibold text-on-surface">{subjectOf(session)}</td>
                    <td className="whitespace-nowrap tabular-nums">{dateTime.format(new Date(session.scheduledStart))}</td>
                    <td>{session.teacher.user.displayName}</td>
                    <td className="text-on-surface-variant">
                      {session.students.map((row) => studentName.get(row.studentId) ?? "—").join(locale === "ar" ? "، " : ", ") || t("noStudents")}
                    </td>
                    <td className="text-end">
                      <button type="button" className="btn btn-outline" onClick={() => { chooseSession(session.id); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
                        {t("manage")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        ) : (
          <EmptyState icon="event" title={t("noSessions")} />
        )}
      </section>
    </div>
  );
}
