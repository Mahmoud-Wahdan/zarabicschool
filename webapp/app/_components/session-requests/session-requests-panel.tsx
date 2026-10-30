"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";

import { formatDateTime } from "../../../lib/schedules/display";
import { utcToWallClockInput, wallClockInputToUtc } from "../../../lib/schedules/recurrence";
import Icon from "../ui/icon";
import DataTable, { type DataRow } from "../ui/data-table";
import StatusBadge from "../ui/status-badge";

export type QueueSessionRequest = {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  reason: string;
  createdAt: string;
  reviewedAt: string | null;
  replacementSessionId: string | null;
  requesterName: string;
  requesterRole: "ADMIN" | "SUPERVISOR" | "TEACHER" | "STUDENT" | "GUARDIAN";
  requesterStudentId: string | null;
  sessionId: string;
  sessionStatus: "SCHEDULED" | "COMPLETED" | "MISSED" | "CANCELLED";
  sessionType: "PRIVATE" | "GROUP";
  subjectName: string;
  teacherName: string;
  scheduledStart: string;
  scheduledEnd: string;
  timezone: string;
  teacherId: string;
  subjectId: string;
  students: { id: string; name: string; isRequester: boolean }[];
};

/**
 * Admin/Supervisor outage & absence review queue (Batch C). Approval requires the
 * replacement details; the scope choice follows the owner decision 2026-10-14:
 * whole-session (original → MISSED + full replacement) or per-student (group session
 * stays SCHEDULED; the requester's reservation is released + private replacement).
 */
export default function SessionRequestsPanel({
  requests,
  pendingCount,
  migrationPending,
  locale,
  viewerTimezone,
}: {
  requests: QueueSessionRequest[];
  pendingCount: number;
  migrationPending: boolean;
  locale: string;
  /** The reviewer's stored zone: the replacement time is pre-filled, typed and labelled in it. */
  viewerTimezone: string;
}) {
  const t = useTranslations("sessionRequests");
  const router = useRouter();
  const [items, setItems] = useState(requests);
  const [selectedId, setSelectedId] = useState(requests.find((request) => request.status === "PENDING")?.id ?? null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const selected = items.find((request) => request.id === selectedId) ?? null;

  const [scope, setScope] = useState<"SESSION" | "STUDENT">("SESSION");
  const [studentId, setStudentId] = useState<string>("");
  const [startInput, setStartInput] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [zoomJoinUrl, setZoomJoinUrl] = useState("");

  function selectRequest(request: QueueSessionRequest) {
    setSelectedId(request.id);
    setError("");
    setScope("SESSION");
    setStudentId(request.requesterStudentId ?? request.students.find((entry) => entry.isRequester)?.id ?? "");
    setStartInput(utcToWallClockInput(new Date(request.scheduledStart), viewerTimezone));
    setDurationMinutes(Math.max(15, Math.round((new Date(request.scheduledEnd).getTime() - new Date(request.scheduledStart).getTime()) / 60000)));
    setZoomJoinUrl("");
  }

  async function decide(action: "APPROVE" | "REJECT") {
    if (!selected) return;
    setBusy(true);
    setError("");
    let body: Record<string, unknown> = { action };
    if (action === "APPROVE") {
      // The typed time is the REVIEWER's wall clock (its zone is shown on the label),
      // never the browser's or the session's stored zone (time-zone audit, 2026-10-27).
      const start = wallClockInputToUtc(startInput, viewerTimezone);
      if (Number.isNaN(start.getTime())) {
        setBusy(false);
        setError(t("invalidStart"));
        return;
      }
      const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
      const replacementStudentIds =
        scope === "STUDENT"
          ? [studentId]
          : selected.students.map((entry) => entry.id);
      body = {
        action,
        scope,
        ...(scope === "STUDENT" ? { studentId } : {}),
        replacement: {
          teacherId: selected.teacherId,
          subjectId: selected.subjectId,
          sessionType: scope === "STUDENT" ? "PRIVATE" : selected.sessionType,
          scheduledStart: start.toISOString(),
          scheduledEnd: end.toISOString(),
          timezone: selected.timezone,
          zoomJoinUrl,
          studentIds: replacementStudentIds,
        },
      };
    }
    const response = await fetch(`/api/session-requests/${selected.id}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => null);
    setBusy(false);
    if (!response.ok) {
      setError(payload?.error?.message ?? t("actionError"));
      return;
    }
    setItems((current) => current.map((request) => (request.id === selected.id ? { ...request, status: (payload?.data?.status ?? request.status) } : request)));
    router.refresh();
  }

  const dateTime = (iso: string) => formatDateTime(iso, viewerTimezone, locale);

  if (migrationPending) {
    return (
      <div className="z-card mt-6 flex flex-col items-center gap-2 rounded-xl px-6 py-12 text-center">
        <span className="rounded-xl bg-surface-container-low p-3 text-on-surface-variant">
          <Icon name="report_problem" size={28} />
        </span>
        <p className="text-title-md text-on-surface">{t("migrationPendingTitle")}</p>
        <p className="max-w-md text-body-sm text-on-surface-variant">{t("migrationPendingText")}</p>
      </div>
    );
  }

  return (
    <div className="z-card mt-6 flex flex-col gap-4 rounded-xl p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-headline-sm font-bold text-primary">{t("queueTitle")}</h2>
        <span className="rounded bg-surface-container-high px-2 py-1 text-label-sm text-on-surface-variant">
          {t("pendingCount", { count: pendingCount })}
        </span>
      </div>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
        <div className="min-w-0 overflow-hidden rounded-lg border border-outline-variant pt-3 lg:col-span-7">
          <DataTable
            caption={t("listTitle")}
            columns={[
              { key: "requester", label: t("colRequester") },
              { key: "role", label: t("colRole") },
              { key: "session", label: t("colSession") },
              { key: "time", label: t("colTime") },
              { key: "status", label: t("colStatus") },
            ]}
            rows={items.map((request): DataRow => ({
              id: request.id,
              filter: request.status,
              cells: {
                requester: { text: request.requesterName },
                role: { text: t(`roles.${request.requesterRole}`) },
                session: { text: `${request.subjectName} · ${request.teacherName}` },
                time: { text: dateTime(request.scheduledStart), sort: request.scheduledStart, numeric: true },
                status: { text: t(`statuses.${request.status}`), tone: request.status === "PENDING" ? "pending" : request.status === "APPROVED" ? "success" : "danger" },
              },
            }))}
            quickFilters={(["PENDING", "APPROVED", "REJECTED"] as const).map((status) => ({ key: status, label: t(`statuses.${status}`) }))}
            emptyTitle={t("emptyTitle")}
            emptyIcon="task_alt"
            initialSort={{ key: "time", direction: "asc" }}
            select={{
              selectedId,
              onSelect: (id) => {
                const request = items.find((row) => row.id === id);
                if (request) selectRequest(request);
              },
            }}
          />
        </div>

        <div className="lg:col-span-5 lg:sticky lg:top-20">
          {selected ? (
            <div className="flex flex-col gap-4 rounded-lg border border-outline-variant bg-surface-container-lowest p-5">
              <div className="flex flex-wrap items-start justify-between gap-2 border-b border-outline-variant pb-3">
                <div>
                  <p className="text-title-md font-bold text-primary">{selected.requesterName}</p>
                  <p className="text-label-sm text-on-surface-variant">
                    {t("sessionLabel")}: {selected.subjectName} · {dateTime(selected.scheduledStart)}
                  </p>
                </div>
                <StatusBadge tone={selected.status === "PENDING" ? "pending" : selected.status === "APPROVED" ? "success" : "danger"}>
                  {t(`statuses.${selected.status}`)}
                </StatusBadge>
              </div>
              <p className="rounded bg-surface-container px-3 py-2 text-body-md text-on-surface">{selected.reason}</p>
              {selected.replacementSessionId ? (
                <p className="text-body-sm text-secondary">{t("replacementLinked")}</p>
              ) : null}

              {selected.status === "PENDING" ? (
                <div className="flex flex-col gap-3 rounded-lg bg-surface-container-low p-4">
                  <label className="flex flex-col gap-1 text-label-sm text-on-surface-variant">
                    {t("scopeLabel")}
                    <select
                      value={scope}
                      onChange={(event) => setScope(event.target.value as "SESSION" | "STUDENT")}
                      className="z-input w-full"
                    >
                      <option value="SESSION">{t("scopeSession")}</option>
                      <option value="STUDENT">{t("scopeStudent")}</option>
                    </select>
                  </label>
                  {scope === "STUDENT" ? (
                    <label className="flex flex-col gap-1 text-label-sm text-on-surface-variant">
                      {t("absentStudentLabel")}
                      <select value={studentId} onChange={(event) => setStudentId(event.target.value)} className="z-input w-full">
                        {selected.students.map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {entry.name}
                            {entry.isRequester ? ` — ${t("requesterMark")}` : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  <label className="flex flex-col gap-1 text-label-sm text-on-surface-variant">
                    {t("startLabel")} ({viewerTimezone})
                    <input
                      type="datetime-local"
                      required
                      value={startInput}
                      onChange={(event) => setStartInput(event.target.value)}
                      className="z-input w-full"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-label-sm text-on-surface-variant">
                    {t("durationLabel")}
                    <input
                      type="number"
                      min={15}
                      max={720}
                      value={durationMinutes}
                      onChange={(event) => setDurationMinutes(Number(event.target.value))}
                      className="z-input w-full"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-label-sm text-on-surface-variant">
                    {t("zoomLabel")}
                    <input
                      type="url"
                      required
                      value={zoomJoinUrl}
                      onChange={(event) => setZoomJoinUrl(event.target.value)}
                      placeholder="https://zoom.us/j/…"
                      className="z-input w-full"
                    />
                  </label>
                  <p className="text-label-sm text-on-surface-variant">{t("creditNote")}</p>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => decide("APPROVE")} disabled={busy} className="btn btn-primary">
                      {busy ? t("saving") : t("approve")}
                    </button>
                    <button type="button" onClick={() => decide("REJECT")} disabled={busy} className="btn btn-ghost-danger">
                      {t("reject")}
                    </button>
                  </div>
                </div>
              ) : null}

              {error ? (
                <p role="alert" className="rounded-lg bg-error-container px-3.5 py-2.5 text-body-sm text-on-error-container">
                  {error}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-outline-variant px-6 py-16 text-center">
              <span className="rounded-xl bg-surface-container-low p-3 text-on-surface-variant">
                <Icon name="waving_hand" size={32} />
              </span>
              <p className="text-title-md text-on-surface">{t("selectTitle")}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
