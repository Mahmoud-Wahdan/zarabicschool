"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { Link } from "../../../../i18n/navigation";
import Icon from "../../../_components/ui/icon";
import { formatSessionDateTime } from "../../../../lib/schedules/display";
import { wallClockInputToUtc } from "../../../../lib/schedules/recurrence";
import { rangeFromInputs, rangeToInputs } from "../../../../lib/schedules/form-times";
import { validateZoomUrl, type ZoomUrlInvalidReason } from "../../../../lib/validation/zoom-url";
import {
  useSmartSessionForm,
  useTeacherOptions,
} from "./use-smart-session-form";

type Session = { id: string; scheduledStart: string; scheduledEnd: string; status: string; sessionType: string; timezone: string; hasHostLink?: boolean; subject: { nameEn: string; nameAr: string }; teacher: { user: { displayName: string } }; students: { student: { user: { displayName: string } } }[]; reportCount?: number };
type Series = { id: string; status: string; timezone: string; totalWeeks: number; generatedThroughWeek: number; sessionType: string; subject: { nameEn: string; nameAr: string }; teacher: { user: { displayName: string } } };
type ChangeRequest = { id: string; reason: string; proposedChange: string; createdAt: string; teacher: { user: { displayName: string } }; session: { id: string; scheduledStart: string; subject: { nameEn: string; nameAr: string } } };

// No bare UTC entry (time-zone audit, 2026-10-27): forms work in real zone names.
const TIMEZONES = ["Africa/Cairo", "Asia/Riyadh", "Asia/Dubai", "Europe/London", "America/New_York"];

const inputClass = "z-input mt-1";

export default function SessionManagementPanel({ viewerTimezone, locale, sessions: initialSessions, series, changeRequests, linkOverlap }: { viewerTimezone: string; locale: string; sessions: Session[]; series: Series[]; changeRequests: ChangeRequest[]; linkOverlap: string[] }) {
  const t = useTranslations("sessionsAdmin");
  const tSessions = useTranslations("sessions");
  // Render-stable clock for the display-only "ended" check (captured once on mount).
  const [nowMs] = useState(() => Date.now());
  const [sessions, setSessions] = useState(initialSessions);
  const [students, setStudents] = useState<{ id: string; displayName: string }[]>([]);
  const [filters, setFilters] = useState({ status: "", from: "", to: "", teacherId: "", studentId: "" });
  const [reschedule, setReschedule] = useState<{ id: string; start: string; end: string } | null>(null);
  const [linkEdit, setLinkEdit] = useState<{ id: string; joinUrl: string; hostUrl: string } | null>(null);
  const [seriesLinkEdit, setSeriesLinkEdit] = useState<{ id: string; joinUrl: string; hostUrl: string } | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const subjectLabel = (subject: { nameEn: string; nameAr: string }) => (locale === "ar" ? subject.nameAr : subject.nameEn);
  const typeLabel = (sessionType: string) => (sessionType === "PRIVATE" ? t("labels.private") : t("labels.group"));

  const { teachers, teachersState } = useTeacherOptions();
  const single = useSmartSessionForm(viewerTimezone);
  const seriesForm = useSmartSessionForm(viewerTimezone);

  useEffect(() => {
    fetch("/api/admin/profiles?type=student")
      .then(async (response) => {
        if (!response.ok) return;
        const payload = await response.json();
        setStudents((payload.data ?? []).map((student: { id: string; displayName: string; studentProfile?: { id: string } | null }) => ({
          id: student.studentProfile?.id ?? student.id,
          displayName: student.displayName,
        })));
      })
      .catch(() => undefined);
  }, []);

  // Keep the timezone fields aligned with the viewer's default.
  useEffect(() => {
    single.setTimezone(viewerTimezone);
    seriesForm.setTimezone(viewerTimezone);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerTimezone]);

  async function refreshSessions(nextFilters: typeof filters) {
    const params = new URLSearchParams();
    if (nextFilters.status) params.set("status", nextFilters.status);
    if (nextFilters.from) params.set("from", wallClockInputToUtc(nextFilters.from, viewerTimezone).toISOString());
    if (nextFilters.to) params.set("to", wallClockInputToUtc(nextFilters.to, viewerTimezone).toISOString());
    if (nextFilters.teacherId) params.set("teacherId", nextFilters.teacherId);
    if (nextFilters.studentId) params.set("studentId", nextFilters.studentId);
    const response = await fetch(`/api/sessions?${params.toString()}`);
    const payload = await response.json();
    if (response.ok) {
      setSessions(payload.data ?? []);
      setMessage("");
    } else {
      setMessage(payload.error?.message ?? t("errors.load"));
    }
  }

  async function submitSmartForm(
    form: ReturnType<typeof useSmartSessionForm>,
    endpoint: string,
    isSeries: boolean,
    successMessage: (generated: number, planned: number) => string,
  ) {
    const scheduledStart = form.toUtcIso(form.scheduledStart);
    const scheduledEnd = form.toUtcIso(form.scheduledEnd);
    if (!scheduledStart || !scheduledEnd) {
      setMessage(t("errors.invalidTime"));
      return;
    }
    setBusy(true);
    setMessage("");
    const body: Record<string, unknown> = {
      teacherId: form.teacherId,
      subjectId: form.subjectId,
      sessionType: form.sessionType,
      scheduledStart,
      scheduledEnd,
      timezone: form.timezone,
      zoomJoinUrl: form.zoomJoinUrl.trim(),
      zoomHostUrl: form.zoomHostUrl.trim() || undefined,
      studentIds: form.studentIds,
    };
    if (isSeries) body.weekCount = form.weekCount;
    const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(payload.error?.message ?? t("errors.submit"));
      setBusy(false);
      return;
    }
    const generated = payload.data?.sessions?.length ?? 1;
    setMessage(successMessage(generated, isSeries ? form.weekCount : 1));
    setBusy(false);
    window.location.reload();
  }

  async function cancelSession(id: string) {
    if (!window.confirm(t("confirmCancel"))) return;
    setBusy(true);
    const response = await fetch(`/api/sessions/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "CANCELLED", cancellationReason: t("cancelReason") }) });
    const payload = await response.json().catch(() => ({}));
    setMessage(response.ok ? t("messages.cancelled") : payload.error?.message ?? t("errors.submit"));
    if (response.ok) setSessions((current) => current.map((session) => session.id === id ? { ...session, status: "CANCELLED" } : session));
    setBusy(false);
  }

  async function applyReschedule(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reschedule) return;
    setBusy(true);
    const target = sessions.find((session) => session.id === reschedule.id);
    if (!target) {
      setBusy(false);
      return;
    }
    // Pre-filled and parsed in the VIEWER's zone (the zone the list shows and the label
    // names) — never the session's stored zone (time-zone audit, 2026-10-27).
    const range = rangeFromInputs(reschedule.start, reschedule.end, viewerTimezone, { start: target.scheduledStart, end: target.scheduledEnd });
    const response = await fetch(`/api/sessions/${reschedule.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ scheduledStart: range.start, scheduledEnd: range.end }) });
    const payload = await response.json().catch(() => ({}));
    setMessage(response.ok ? t("messages.rescheduled") : payload.error?.message ?? t("errors.submit"));
    if (response.ok) {
      setSessions((current) => current.map((session) => session.id === reschedule.id ? { ...session, scheduledStart: range.start, scheduledEnd: range.end } : session));
      setReschedule(null);
    }
    setBusy(false);
  }

  async function reviewChangeRequest(id: string, status: "APPROVED" | "REJECTED") {
    setBusy(true);
    const response = await fetch(`/api/session-change-requests/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) });
    const payload = await response.json().catch(() => ({}));
    setMessage(response.ok ? t("messages.requestReviewed", { status: status === "APPROVED" ? t("words.approved") : t("words.rejected") }) : payload.error?.message ?? t("errors.submit"));
    setBusy(false);
  }

  // B5: the list carries no Zoom link; the editor reads the current ones on demand.
  async function openLinkEdit(sessionId: string) {
    if (linkEdit?.id === sessionId) {
      setLinkEdit(null);
      return;
    }
    const response = await fetch(`/api/sessions/${sessionId}/link`, { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(payload.error?.message ?? t("errors.submit"));
      return;
    }
    setLinkEdit({ id: sessionId, joinUrl: payload.data?.zoomJoinUrl ?? "", hostUrl: payload.data?.zoomHostUrl ?? "" });
  }

  async function saveSessionLinks(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!linkEdit) return;
    setBusy(true);
    const response = await fetch(`/api/sessions/${linkEdit.id}/link`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ zoomJoinUrl: linkEdit.joinUrl.trim(), zoomHostUrl: linkEdit.hostUrl.trim() }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(payload.error?.message ?? t("errors.submit"));
    } else {
      const hasOverlapWarning = (payload.data?.warnings ?? []).length > 0;
      setMessage(hasOverlapWarning ? t("overlap.savedWithWarning") : t("messages.linkUpdated"));
      setSessions((current) => current.map((session) => session.id === linkEdit.id
        ? { ...session, hasHostLink: linkEdit.hostUrl.trim() !== "" }
        : session));
      setLinkEdit(null);
    }
    setBusy(false);
  }

  async function applySeriesLinks(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!seriesLinkEdit) return;
    setBusy(true);
    const response = await fetch(`/api/sessions/recurrences/${seriesLinkEdit.id}/link`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ zoomJoinUrl: seriesLinkEdit.joinUrl.trim(), zoomHostUrl: seriesLinkEdit.hostUrl.trim() }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(payload.error?.message ?? t("errors.submit"));
    } else {
      const hasOverlapWarning = (payload.data?.warnings ?? []).length > 0;
      setMessage(hasOverlapWarning
        ? t("overlap.savedWithWarning")
        : t("messages.seriesLinkApplied", { count: payload.data?.updatedSessions ?? 0 }));
      setSeriesLinkEdit(null);
    }
    setBusy(false);
  }

  return (
    <div className="mt-6 space-y-6">
      <p className="text-sm">
        <Link href="/admin/assignments" className="font-semibold text-secondary hover:underline">
          {t("link.assignments")}
        </Link>
      </p>

      {changeRequests.length ? (
        <section className="z-card space-y-3 rounded-xl p-5">
          <h2 className="text-headline-sm font-bold text-primary">{t("changeRequests.title")}</h2>
          {changeRequests.map((changeRequest) => (
            <article key={changeRequest.id} className="rounded-xl border border-outline-variant p-4">
              <p className="text-body-md font-semibold text-primary">{changeRequest.teacher.user.displayName} · {subjectLabel(changeRequest.session.subject)} · {formatSessionDateTime(changeRequest.session.scheduledStart, viewerTimezone, locale)}</p>
              <p className="mt-1 text-body-sm text-on-surface-variant">{t("changeRequests.reason")}: {changeRequest.reason}</p>
              <p className="text-body-sm text-on-surface-variant">{t("changeRequests.proposed")}: {changeRequest.proposedChange}</p>
              <div className="mt-2 flex gap-2">
                <button disabled={busy} onClick={() => void reviewChangeRequest(changeRequest.id, "APPROVED")} className="btn btn-primary">{t("words.approve")}</button>
                <button disabled={busy} onClick={() => void reviewChangeRequest(changeRequest.id, "REJECTED")} className="btn btn-outline">{t("words.reject")}</button>
              </div>
            </article>
          ))}
        </section>
      ) : null}

      {series.length ? (
        <section className="z-card space-y-3 rounded-xl p-5">
          <h2 className="text-headline-sm font-bold text-primary">{t("series.title")}</h2>
          {series.map((item) => (
            <article key={item.id} className="rounded-xl border border-outline-variant p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-primary">{subjectLabel(item.subject)} · {item.teacher.user.displayName} · {typeLabel(item.sessionType)}</p>
                  <p className="mt-1 text-body-sm text-on-surface-variant">{t("series.progress", { generated: item.generatedThroughWeek + 1, total: item.totalWeeks })}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-3 py-1 text-label-sm ${item.status === "PAUSED" ? "bg-tertiary-fixed text-on-tertiary-fixed" : "bg-secondary-container/60 text-secondary"}`}>{t(`series.statuses.${item.status}`)}</span>
                  <button
                    type="button"
                    onClick={() => setSeriesLinkEdit(seriesLinkEdit?.id === item.id ? null : { id: item.id, joinUrl: "", hostUrl: "" })}
                    className="btn btn-outline"
                  >
                    {t("actions.applySeriesLink")}
                  </button>
                </div>
              </div>
              {seriesLinkEdit?.id === item.id ? (
                <form onSubmit={applySeriesLinks} className="mt-3 space-y-3 border-t border-outline-variant pt-3">
                  <p className="text-body-md font-semibold text-primary">{t("seriesLink.title")}</p>
                  <p className="text-label-sm text-on-surface-variant">{t("seriesLink.note")}</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <ZoomField
                      label={t("editLink.join")}
                      value={seriesLinkEdit.joinUrl}
                      onChange={(value) => setSeriesLinkEdit({ ...seriesLinkEdit, joinUrl: value })}
                      check={seriesLinkEdit.joinUrl ? validateZoomUrl(seriesLinkEdit.joinUrl) : null}
                      required
                    />
                    <ZoomField
                      label={t("editLink.host")}
                      value={seriesLinkEdit.hostUrl}
                      onChange={(value) => setSeriesLinkEdit({ ...seriesLinkEdit, hostUrl: value })}
                      check={seriesLinkEdit.hostUrl ? validateZoomUrl(seriesLinkEdit.hostUrl) : null}
                    />
                  </div>
                  <button
                    disabled={busy || validateZoomUrl(seriesLinkEdit.joinUrl).ok !== true}
                    className="btn btn-primary disabled:opacity-50"
                  >
                    {t("seriesLink.save")}
                  </button>
                </form>
              ) : null}
            </article>
          ))}
        </section>
      ) : null}

      <section className="z-card space-y-3 rounded-xl p-5">
        <h2 className="text-headline-sm font-bold text-primary">{t("filters.title")}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })} className={inputClass}>
            <option value="">{t("filters.anyStatus")}</option>
            {["SCHEDULED", "COMPLETED", "MISSED", "CANCELLED"].map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
          <label className="text-sm">{t("filters.from")} ({viewerTimezone})<input type="datetime-local" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} className={inputClass} /></label>
          <label className="text-sm">{t("filters.to")} ({viewerTimezone})<input type="datetime-local" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} className={inputClass} /></label>
          <select value={filters.teacherId} onChange={(event) => setFilters({ ...filters, teacherId: event.target.value })} className={inputClass}>
            <option value="">{t("filters.anyTeacher")}</option>
            {teachers.map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.displayName}</option>)}
          </select>
          <select value={filters.studentId} onChange={(event) => setFilters({ ...filters, studentId: event.target.value })} className={inputClass}>
            <option value="">{t("filters.anyStudent")}</option>
            {students.map((student) => <option key={student.id} value={student.id}>{student.displayName}</option>)}
          </select>
        </div>
        <button disabled={busy} onClick={() => void refreshSessions(filters)} className="btn btn-primary">{t("filters.apply")}</button>
      </section>

      <details className="z-card rounded-xl p-5">
        <summary className="cursor-pointer text-headline-sm font-bold text-primary">{t("seriesForm.title")}</summary>
        <SmartFormFields
          form={seriesForm}
          teachers={teachers}
          teachersState={teachersState}
          busyTitle={(day) => t("busy.title", { day })}
          locale={locale}
        />
        <label className="mt-3 block text-sm">{t("seriesForm.totalWeeks")}
          <input required type="number" min={1} max={52} value={seriesForm.weekCount} onChange={(event) => seriesForm.setWeekCount(Number(event.target.value))} className={inputClass} />
        </label>
        <button
          disabled={busy || !seriesForm.teacherId || !seriesForm.subjectId || seriesForm.studentIds.length === 0 || !seriesForm.selectedRange || seriesForm.zoomJoinCheck?.ok !== true || seriesForm.conflictSlots.length > 0}
          onClick={() => void submitSmartForm(seriesForm, "/api/sessions/recurrences", true, (generated, planned) => t("messages.seriesCreated", { generated, total: planned }))}
          className="btn btn-primary mt-4 disabled:opacity-50 sm:col-span-2 lg:col-span-3"
        >
          {t("seriesForm.create")}
        </button>
        <p className="mt-2 text-label-sm text-on-surface-variant">{t("seriesForm.creditNote")}</p>
      </details>

      <details className="z-card rounded-xl p-5">
        <summary className="cursor-pointer text-headline-sm font-bold text-primary">{t("single.title")}</summary>
        <SmartFormFields
          form={single}
          teachers={teachers}
          teachersState={teachersState}
          busyTitle={(day) => t("busy.title", { day })}
          locale={locale}
        />
        <button
          disabled={busy || !single.teacherId || !single.subjectId || single.studentIds.length === 0 || !single.selectedRange || single.zoomJoinCheck?.ok !== true || single.conflictSlots.length > 0}
          onClick={() => void submitSmartForm(single, "/api/sessions", false, () => t("messages.created"))}
          className="btn btn-primary mt-4 disabled:opacity-50 sm:col-span-2 lg:col-span-3"
        >
          {t("single.create")}
        </button>
      </details>

      {message ? <p role="status" className="text-body-sm text-on-surface-variant">{message}</p> : null}

      <section className="space-y-3">
        {sessions.map((session) => (
          <article key={session.id} className="z-card lift-card rounded-xl p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="font-bold text-primary">{subjectLabel(session.subject)} · {session.teacher.user.displayName}</p>
                <p className="mt-1 text-body-sm text-on-surface-variant">{formatSessionDateTime(session.scheduledStart, viewerTimezone, locale)} · {typeLabel(session.sessionType)} · {session.students.map((item) => item.student.user.displayName).join(", ")}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-3 py-1 text-label-sm ${
                  session.status === "SCHEDULED"
                    ? "bg-secondary-container/60 text-secondary"
                    : session.status === "CANCELLED" || session.status === "MISSED"
                      ? "bg-error-container text-on-error-container"
                      : "bg-tertiary-fixed text-on-tertiary-fixed"
                }`}>{t(`statuses.${session.status}`)}</span>
                {/* Display only (owner, 2026-10-25): an ended session completes when its last
                    roster report is submitted; until then show the progress from existing data. */}
                {session.status === "SCHEDULED" && new Date(session.scheduledEnd).getTime() <= nowMs ? (
                  <span className="rounded-full bg-tertiary-fixed px-3 py-1 text-label-sm text-on-tertiary-fixed">
                    {tSessions("teacher.ended")} · {tSessions("awaitingReports", { done: session.reportCount ?? 0, total: session.students.length })}
                  </span>
                ) : null}
                {session.status === "SCHEDULED" ? (
                  <>
                    <button type="button" onClick={() => setReschedule(reschedule?.id === session.id ? null : { id: session.id, ...rangeToInputs(session.scheduledStart, session.scheduledEnd, viewerTimezone) })} className="btn btn-outline">{t("actions.reschedule")}</button>
                    <button
                      type="button"
                      onClick={() => void openLinkEdit(session.id)}
                      className="btn btn-outline"
                    >
                      {t("actions.editLink")}
                    </button>
                    <button disabled={busy} onClick={() => void cancelSession(session.id)} className="btn btn-outline">{t("actions.cancel")}</button>
                  </>
                ) : null}
              </div>
            </div>
            {linkOverlap.includes(session.id) ? (
              <p role="status" className="mt-3 flex items-start gap-2 rounded-lg bg-tertiary-fixed p-2 text-label-sm text-on-tertiary-fixed">
                <Icon name="warning" size={16} className="shrink-0" />
                <span>{t("overlap.warning")}</span>
              </p>
            ) : null}
            {reschedule?.id === session.id ? (
              <form onSubmit={applyReschedule} className="mt-3 grid gap-3 border-t border-outline-variant pt-3 sm:grid-cols-3">
                <label className="text-sm">{t("reschedule.newStart")} ({viewerTimezone})<input required type="datetime-local" value={reschedule.start} onChange={(event) => setReschedule({ ...reschedule, start: event.target.value })} className={inputClass} /></label>
                <label className="text-sm">{t("reschedule.newEnd")} ({viewerTimezone})<input required type="datetime-local" value={reschedule.end} onChange={(event) => setReschedule({ ...reschedule, end: event.target.value })} className={inputClass} /></label>
                <button disabled={busy} className="btn btn-primary mt-6">{t("reschedule.save")}</button>
              </form>
            ) : null}
            {linkEdit?.id === session.id ? (
              <form onSubmit={saveSessionLinks} className="mt-3 space-y-3 border-t border-outline-variant pt-3">
                <p className="text-body-md font-semibold text-primary">{t("editLink.title")}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <ZoomField
                    label={t("editLink.join")}
                    value={linkEdit.joinUrl}
                    onChange={(value) => setLinkEdit({ ...linkEdit, joinUrl: value })}
                    check={validateZoomUrl(linkEdit.joinUrl)}
                    required
                  />
                  <ZoomField
                    label={t("editLink.host")}
                    value={linkEdit.hostUrl}
                    onChange={(value) => setLinkEdit({ ...linkEdit, hostUrl: value })}
                    check={linkEdit.hostUrl ? validateZoomUrl(linkEdit.hostUrl) : null}
                  />
                </div>
                <div className="flex gap-2">
                  <button disabled={busy || validateZoomUrl(linkEdit.joinUrl).ok !== true} className="btn btn-primary disabled:opacity-50">{t("editLink.save")}</button>
                  <button type="button" onClick={() => setLinkEdit(null)} className="btn btn-outline">{t("editLink.hide")}</button>
                </div>
              </form>
            ) : null}
          </article>
        ))}
        {!sessions.length ? <p className="z-card rounded-xl p-5 text-body-sm text-on-surface-variant">{t("states.listEmpty")}</p> : null}
      </section>
    </div>
  );
}

function SmartFormFields({
  form,
  teachers,
  teachersState,
  busyTitle,
  locale,
}: {
  form: ReturnType<typeof useSmartSessionForm>;
  teachers: { id: string; displayName: string }[];
  teachersState: "loading" | "ready" | "error";
  busyTitle: (day: string) => string;
  locale: string;
}) {
  const t = useTranslations("sessionsAdmin");

  return (
    <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <label className="text-sm">{t("labels.teacher")}
        <select required value={form.teacherId} onChange={(event) => form.selectTeacher(event.target.value)} className={inputClass}>
          <option value="">{teachersState === "loading" ? t("states.teachersLoading") : t("labels.chooseTeacher")}</option>
          {teachers.map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.displayName}</option>)}
        </select>
      </label>
      {teachersState === "error" ? <p role="alert" className="text-sm text-error sm:col-span-2">{t("states.teachersError")}</p> : null}
      {teachersState === "ready" && teachers.length === 0 ? <p className="text-body-sm text-on-surface-variant sm:col-span-2">{t("states.teachersEmpty")}</p> : null}

      <label className="text-sm">{t("labels.subject")}
        <select required value={form.subjectId} onChange={(event) => form.selectSubject(event.target.value)} disabled={!form.teacherId || form.contextState === "loading"} className={inputClass}>
          <option value="">{form.contextState === "loading" ? t("states.contextLoading") : t("labels.chooseSubject")}</option>
          {form.subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.nameEn} / {subject.nameAr}</option>)}
        </select>
      </label>
      {form.contextState === "error" ? (
        <p role="alert" className="text-sm text-error sm:col-span-2">{t("states.contextError")}</p>
      ) : null}
      {form.contextState === "ready" && form.subjects.length === 0 ? (
        <p className="text-body-sm text-on-surface-variant sm:col-span-2">
          {t("states.subjectsEmpty")} <Link href="/admin/assignments" className="font-semibold text-secondary hover:underline">{t("states.subjectsEmptyLink")}</Link>
        </p>
      ) : null}

      <label className="text-sm">{t("labels.sessionType")}
        <select value={form.sessionType} onChange={(event) => form.setSessionType(event.target.value)} className={inputClass}>
          <option value="PRIVATE">{t("labels.private")}</option>
          <option value="GROUP">{t("labels.group")}</option>
        </select>
      </label>

      <label className="text-sm">{t("labels.starts")} ({form.timezone})
        <input required type="datetime-local" value={form.scheduledStart} onChange={(event) => form.setScheduledStart(event.target.value)} className={inputClass} />
      </label>
      <label className="text-sm">{t("labels.ends")} ({form.timezone})
        <input required type="datetime-local" value={form.scheduledEnd} onChange={(event) => form.setScheduledEnd(event.target.value)} className={inputClass} />
      </label>
      <label className="text-sm">{t("labels.timezone")}
        <select value={form.timezone} onChange={(event) => form.setTimezone(event.target.value)} className={inputClass}>
          {[...new Set([form.timezone, ...TIMEZONES])].map((timeZone) => <option key={timeZone} value={timeZone}>{timeZone}</option>)}
        </select>
      </label>

      <div className="sm:col-span-2">
        <ZoomField
          label={t("labels.zoomJoin")}
          value={form.zoomJoinUrl}
          onChange={form.setZoomJoinUrl}
          check={form.zoomJoinCheck}
          required
        />
      </div>
      <ZoomField
        label={t("labels.zoomHost")}
        value={form.zoomHostUrl}
        onChange={form.setZoomHostUrl}
        check={form.zoomHostCheck}
      />

      <div className="rounded-xl border border-outline-variant p-3 sm:col-span-2 lg:col-span-3">
        <p className="text-body-md font-semibold text-primary">{t("labels.students")}</p>
        {form.contextState === "ready" && form.subjectId && form.assignedStudents.length === 0 ? (
          <p className="mt-2 text-body-sm text-on-surface-variant">
            {t("states.studentsEmpty")} <Link href="/admin/assignments" className="font-semibold text-secondary hover:underline">{t("states.studentsEmptyLink")}</Link>
          </p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2">
            {form.assignedStudents.map((student) => (
              <button type="button" key={student.studentId} onClick={() => form.toggleStudent(student.studentId)} className={`rounded-full border px-3 py-1 text-sm ${form.studentIds.includes(student.studentId) ? "border-secondary bg-secondary-container/60 text-secondary" : "border-outline-variant"}`}>
                {student.displayName}
              </button>
            ))}
          </div>
        )}
      </div>

      {form.scheduledStart ? (
        <div className="rounded-xl border border-outline-variant p-3 sm:col-span-2 lg:col-span-3">
          <p className="text-body-md font-semibold text-primary">{busyTitle(form.scheduledStart.slice(0, 10))}</p>
          {form.busySlotsForDay.length === 0 ? (
            <p className="mt-2 text-body-sm text-on-surface-variant">{t("busy.none")}</p>
          ) : (
            <ul className="mt-2 space-y-1 text-sm">
              {form.busySlotsForDay.map((slot) => {
                const conflicting = form.conflictSlots.some((item) => item.id === slot.id);
                return (
                  <li key={slot.id} className={conflicting ? "font-semibold text-error" : "opacity-80"}>
                    {formatSessionDateTime(slot.scheduledStart, form.timezone, locale)} – {formatSessionDateTime(slot.scheduledEnd, form.timezone, locale)} · {locale === "ar" ? slot.subject.nameAr : slot.subject.nameEn} · {slot.sessionType === "PRIVATE" ? t("labels.private") : t("labels.group")}
                  </li>
                );
              })}
            </ul>
          )}
          {form.conflictSlots.length > 0 ? (
            <p role="alert" className="mt-2 rounded-lg bg-error-container p-2 text-body-sm text-on-error-container">{t("busy.conflict")}</p>
          ) : null}
          <p className="mt-2 text-label-sm text-on-surface-variant">{t("busy.note")}</p>
        </div>
      ) : null}
    </div>
  );
}

function ZoomField({ label, value, onChange, check, required: isRequired = false }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  check: { ok: true } | { ok: false; reason: ZoomUrlInvalidReason } | null;
  required?: boolean;
}) {
  const t = useTranslations("sessionsAdmin");
  return (
    <label className="block text-sm">
      {label}
      <input
        required={isRequired}
        type="url"
        placeholder={t("labels.zoomPlaceholder")}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={inputClass}
      />
      {check ? (
        check.ok ? (
          <span className="mt-1 block text-xs font-semibold text-secondary">{t("zoom.valid")}</span>
        ) : (
          <span role="alert" className="mt-1 block text-xs font-semibold text-error">
            {t(`zoom.reasons.${check.reason}`)}
          </span>
        )
      ) : (
        <span className="mt-1 block text-label-sm text-on-surface-variant">{t("zoom.formatNote")}</span>
      )}
    </label>
  );
}
