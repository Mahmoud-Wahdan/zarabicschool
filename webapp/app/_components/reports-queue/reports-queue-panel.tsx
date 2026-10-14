"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import Icon from "../ui/icon";
import StatusBadge from "../ui/status-badge";

export type QueueReport = {
  id: string;
  teacherName: string;
  studentName: string;
  subjectName: string;
  scheduledStart: string;
  scheduledEnd: string;
  submittedAt: string;
  attendanceOutcome: "ATTENDED" | "STUDENT_ABSENT";
  classRemark: string;
  summary: string;
  homework: string;
  notes: string | null;
  extraTimeMinutes: number;
  extraTimeStatus: "NONE" | "PENDING" | "APPROVED" | "REJECTED";
  operationalEvents: Record<string, unknown> | null;
  hasLateFlag: boolean;
};

export type QueueMetrics = {
  pending: number;
  flagged: number;
  overtime: number;
  approvedToday: number;
};

type Filter = "all" | "flagged" | "overtime";

function initials(name: string) {
  return name.trim().slice(0, 1).toUpperCase() || "?";
}

export default function ReportsQueuePanel({
  reports,
  metrics,
  locale,
}: {
  reports: QueueReport[];
  metrics: QueueMetrics;
  locale: string;
}) {
  const t = useTranslations("reportsQueue");
  const router = useRouter();
  const [items, setItems] = useState(reports);
  const [selectedId, setSelectedId] = useState(reports[0]?.id ?? null);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [error, setError] = useState("");

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items.filter((report) => {
      if (filter === "flagged" && !report.hasLateFlag) return false;
      if (filter === "overtime" && report.extraTimeStatus !== "PENDING") return false;
      if (!query) return true;
      return (
        report.teacherName.toLowerCase().includes(query) ||
        report.studentName.toLowerCase().includes(query) ||
        report.subjectName.toLowerCase().includes(query)
      );
    });
  }, [items, filter, search]);

  const selected = items.find((report) => report.id === selectedId) ?? null;

  const dateTime = (iso: string, withTime = true) =>
    new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", {
      weekday: withTime ? undefined : "short",
      day: "numeric",
      month: "short",
      hour: withTime ? "numeric" : undefined,
      minute: withTime ? "2-digit" : undefined,
    }).format(new Date(iso));

  async function submitDecision(action: "APPROVE" | "REJECT") {
    if (!selected) return;
    setPendingId(selected.id);
    setError("");
    const response = await fetch(`/api/reports/${selected.id}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, rejectionReason: action === "REJECT" ? rejectionReason : undefined }),
    });
    setPendingId(null);
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body?.error?.message ?? t("actionError"));
      return;
    }
    setItems((current) => current.filter((report) => report.id !== selected.id));
    setSelectedId((current) => {
      const remaining = items.filter((report) => report.id !== selected.id);
      return current === selected.id ? (remaining[0]?.id ?? null) : current;
    });
    setRejecting(false);
    setRejectionReason("");
    router.refresh();
  }

  const filters: { key: Filter; label: string; count: number }[] = [
    { key: "all", label: t("filterAll"), count: items.length },
    { key: "flagged", label: t("filterFlagged"), count: items.filter((r) => r.hasLateFlag).length },
    { key: "overtime", label: t("filterOvertime"), count: items.filter((r) => r.extraTimeStatus === "PENDING").length },
  ];

  const metricsCards = [
    { label: t("metricPending"), value: metrics.pending, icon: "hourglass_top", tone: "bg-surface-container-high text-primary", badge: t("metricPendingNote") },
    { label: t("metricFlagged"), value: metrics.flagged, icon: "flag", tone: "bg-tertiary-fixed/30 text-tertiary", badge: t("metricFlaggedNote") },
    { label: t("metricOvertime"), value: metrics.overtime, icon: "more_time", tone: "bg-primary-fixed/50 text-primary", badge: t("metricOvertimeNote") },
    { label: t("metricApprovedToday"), value: metrics.approvedToday, icon: "verified", tone: "bg-secondary-fixed/30 text-secondary", badge: t("metricApprovedNote") },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {metricsCards.map((card) => (
          <div key={card.label} className="z-card flex items-center justify-between rounded-xl p-4">
            <div className="flex flex-col">
              <span className="text-label-sm uppercase tracking-wider text-on-surface-variant">{card.label}</span>
              <span className="mt-1 text-display-hero font-bold leading-none text-primary">
                {String(card.value).padStart(2, "0")}
              </span>
              <span className="mt-1 text-body-sm text-on-surface-variant">{card.badge}</span>
            </div>
            <span className={`flex h-12 w-12 items-center justify-center rounded-lg ${card.tone}`}>
              <Icon name={card.icon} />
            </span>
          </div>
        ))}
      </div>

      <div className="z-card flex flex-col gap-4 rounded-xl p-4 sm:p-6">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="rounded bg-tertiary-fixed px-2 py-0.5 text-label-sm font-semibold uppercase tracking-wider text-on-tertiary-fixed">
              {t("gateBadge")}
            </span>
            <span className="text-label-sm tracking-wider text-on-surface-variant">{t("gateNote")}</span>
          </div>
          <h2 className="text-headline-md font-bold text-primary">{t("queueTitle")}</h2>
          <p className="text-body-md text-on-surface-variant">{t("queueSubtitle")}</p>
        </div>

        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
          <div className="flex flex-col gap-4 lg:col-span-5">
            <div className="z-card flex items-center justify-between gap-2 rounded-xl p-2">
              <div className="flex flex-1 items-center gap-1">
                <Icon name="search" size={20} className="ms-2 text-outline" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={t("searchPlaceholder")}
                  className="w-full bg-transparent text-body-sm text-on-surface outline-none placeholder:text-on-surface-variant"
                  aria-label={t("searchPlaceholder")}
                />
              </div>
              <span className="rounded bg-surface-container-high px-2 py-1 text-label-sm text-on-surface-variant">
                {t("newestFirst")}
              </span>
            </div>

            <div
              className="flex items-center gap-1 self-start rounded-lg bg-surface-container-highest p-0.5"
              role="tablist"
              aria-label={t("filterLabel")}
            >
              {filters.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  role="tab"
                  aria-selected={filter === item.key}
                  onClick={() => setFilter(item.key)}
                  className={`rounded px-2 py-1 text-label-md transition-colors ${
                    filter === item.key
                      ? "bg-surface-container-lowest text-on-surface shadow-sm"
                      : "text-on-surface-variant hover:text-on-surface"
                  }`}
                >
                  {item.label} ({item.count})
                </button>
              ))}
            </div>

            <div className="flex flex-col gap-2">
              {filtered.map((report) => {
                const active = report.id === selectedId;
                return (
                  <button
                    key={report.id}
                    type="button"
                    onClick={() => setSelectedId(report.id)}
                    className={`relative rounded-xl p-4 text-start shadow-sm transition-all ${
                      active
                        ? "bg-gradient-to-r from-secondary/5 via-surface-container-lowest to-surface-container-lowest shadow-md"
                        : "bg-surface-container-lowest hover:shadow-md"
                    }`}
                  >
                    {active ? (
                      <span className="absolute inset-y-0 start-0 w-1.5 rounded-s-xl bg-secondary" aria-hidden="true" />
                    ) : null}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-container text-sm font-bold text-on-primary">
                          {initials(report.teacherName)}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-title-md font-bold text-primary">{report.teacherName}</p>
                          <p className="truncate text-label-sm text-on-surface-variant">
                            {t("studentLabel")}: {report.studentName}
                          </p>
                        </div>
                      </div>
                      <StatusBadge tone={report.attendanceOutcome === "ATTENDED" ? "success" : "danger"}>
                        {report.attendanceOutcome === "ATTENDED" ? t("attended") : t("absent")}
                      </StatusBadge>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-label-sm text-on-surface-variant">
                      <span className="rounded bg-surface-container px-2 py-0.5">{report.subjectName}</span>
                      <span>{dateTime(report.scheduledStart)}</span>
                      {report.extraTimeStatus === "PENDING" ? (
                        <span className="rounded bg-tertiary-fixed px-2 py-0.5 font-semibold text-on-tertiary-fixed">
                          +{report.extraTimeMinutes}m
                        </span>
                      ) : null}
                      {report.hasLateFlag ? (
                        <span className="rounded bg-error-container px-2 py-0.5 font-semibold text-on-error-container">
                          {t("lateFlag")}
                        </span>
                      ) : null}
                    </div>
                  </button>
                );
              })}
              {filtered.length === 0 ? (
                <div className="z-card flex flex-col items-center gap-2 rounded-xl px-6 py-10 text-center">
                  <span className="rounded-xl bg-surface-container-low p-3 text-on-surface-variant">
                    <Icon name="fact_check" size={28} />
                  </span>
                  <p className="text-title-md text-on-surface">{t("emptyTitle")}</p>
                  <p className="max-w-md text-body-sm text-on-surface-variant">{t("emptyText")}</p>
                </div>
              ) : null}
            </div>
          </div>

          <div className="lg:col-span-7">
            {selected ? (
              <div className="z-card-raised flex flex-col gap-5 rounded-xl p-5 sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-outline-variant pb-4">
                  <div className="flex items-center gap-3">
                    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-container text-lg font-bold text-on-primary">
                      {initials(selected.teacherName)}
                    </span>
                    <div>
                      <p className="text-title-md font-bold text-primary">{selected.teacherName}</p>
                      <p className="text-label-sm text-on-surface-variant">
                        {t("studentLabel")}: {selected.studentName} • {selected.subjectName}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <StatusBadge tone={selected.attendanceOutcome === "ATTENDED" ? "success" : "danger"}>
                      {selected.attendanceOutcome === "ATTENDED" ? t("attended") : t("absent")}
                    </StatusBadge>
                    <span className="text-label-sm text-outline">
                      {t("submittedLabel")}: {dateTime(selected.submittedAt)}
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 text-label-sm text-on-surface-variant">
                  <span className="rounded bg-surface-container px-2 py-1">
                    {t("sessionLabel")}: {dateTime(selected.scheduledStart)} — {dateTime(selected.scheduledEnd)}
                  </span>
                  {selected.extraTimeStatus === "PENDING" ? (
                    <span className="rounded bg-tertiary-fixed px-2 py-1 font-semibold text-on-tertiary-fixed">
                      {t("overtimeClaim")}: +{selected.extraTimeMinutes}m — {t("overtimePending")}
                    </span>
                  ) : null}
                  {selected.hasLateFlag ? (
                    <span className="rounded bg-error-container px-2 py-1 font-semibold text-on-error-container">
                      {t("lateFlag")}
                    </span>
                  ) : null}
                </div>

                <div className="flex flex-col gap-3">
                  <div>
                    <p className="text-label-sm font-bold uppercase tracking-wider text-on-surface-variant">
                      {t("classRemark")}
                    </p>
                    <p className="text-body-md text-on-surface">{selected.classRemark}</p>
                  </div>
                  <div>
                    <p className="text-label-sm font-bold uppercase tracking-wider text-on-surface-variant">
                      {t("summary")}
                    </p>
                    <p className="text-body-md leading-relaxed text-on-surface">{selected.summary}</p>
                  </div>
                  <div>
                    <p className="text-label-sm font-bold uppercase tracking-wider text-on-surface-variant">
                      {t("homework")}
                    </p>
                    <p className="text-body-md text-on-surface">{selected.homework}</p>
                  </div>
                  {selected.notes ? (
                    <div>
                      <p className="text-label-sm font-bold uppercase tracking-wider text-on-surface-variant">
                        {t("notes")}
                      </p>
                      <p className="text-body-md text-on-surface">{selected.notes}</p>
                    </div>
                  ) : null}
                  {selected.operationalEvents && Object.keys(selected.operationalEvents).length > 0 ? (
                    <div>
                      <p className="text-label-sm font-bold uppercase tracking-wider text-on-surface-variant">
                        {t("operationalEvents")}
                      </p>
                      <ul className="flex flex-col gap-1 text-body-sm text-on-surface">
                        {Object.entries(selected.operationalEvents).map(([key, value]) => (
                          <li key={key} className="rounded bg-surface-container px-2 py-1">
                            <span className="font-semibold">{key}</span>
                            {value !== null && value !== undefined && value !== "" ? `: ${String(value)}` : ""}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>

                {error ? (
                  <p role="alert" className="rounded-lg bg-error-container px-3.5 py-2.5 text-body-sm text-on-error-container">
                    {error}
                  </p>
                ) : null}

                {rejecting ? (
                  <div className="flex flex-col gap-3 rounded-lg bg-surface-container-low p-4">
                    <label htmlFor="rejection-reason" className="text-label-md font-bold text-primary">
                      {t("rejectReasonLabel")}
                    </label>
                    <textarea
                      id="rejection-reason"
                      value={rejectionReason}
                      onChange={(event) => setRejectionReason(event.target.value)}
                      rows={3}
                      className="z-textarea"
                      placeholder={t("rejectReasonPlaceholder")}
                    />
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => submitDecision("REJECT")}
                        disabled={!rejectionReason.trim() || pendingId === selected.id}
                        className="btn btn-ghost-danger"
                      >
                        {pendingId === selected.id ? t("saving") : t("confirmReject")}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setRejecting(false);
                          setRejectionReason("");
                        }}
                        className="btn btn-soft"
                      >
                        {t("cancel")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2 border-t border-outline-variant pt-4">
                    <button
                      type="button"
                      onClick={() => submitDecision("APPROVE")}
                      disabled={pendingId === selected.id}
                      className="btn btn-primary"
                    >
                      <Icon name="check_circle" size={18} />
                      <span>{pendingId === selected.id ? t("saving") : t("approve")}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setRejecting(true)}
                      disabled={pendingId === selected.id}
                      className="btn btn-ghost-danger"
                    >
                      <Icon name="cancel" size={18} />
                      <span>{t("reject")}</span>
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="z-card flex flex-col items-center gap-2 rounded-xl px-6 py-16 text-center">
                <span className="rounded-xl bg-surface-container-low p-3 text-on-surface-variant">
                  <Icon name="task_alt" size={32} />
                </span>
                <p className="text-title-md text-on-surface">{t("emptyTitle")}</p>
                <p className="max-w-md text-body-sm text-on-surface-variant">{t("emptyText")}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
