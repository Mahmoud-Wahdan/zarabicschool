"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import StatusBadge, { type BadgeTone } from "../../_components/ui/status-badge";
import WhatsAppPhoneLink from "../../_components/ui/whatsapp-phone-link";
import TeacherFlagsCell, { type TeacherFlagForDisplay } from "./teacher-flags-cell";

type ProfileType = "student" | "guardian" | "teacher";
type PaymentStatus = "PAID" | "PENDING" | "FAILED" | "CANCELLED";
/** S-09 / D29: amount-free per-student status (students list only). */
type FinanceStatus = { remainingSessions: number; paymentStatus: PaymentStatus | null };
type ActiveAssignment = { subjectId: string; subjectNameAr: string; subjectNameEn: string; teacherName: string };
type LinkedChild = { id: string; displayName: string; dateOfBirth?: string | null; isAdult: boolean; assignments: ActiveAssignment[] };
type StudentProfile = { guardianId: string | null; dateOfBirth?: string | null; isAdult?: boolean; guardian?: { displayName: string; phone: string | null; relationship: string } | null; activeAssignments?: ActiveAssignment[] };
type TeacherSubject = { id: string; nameAr: string; nameEn: string };
type AssignedSubjectStudent = { id: string; displayName: string; isAdult: boolean };
type Row = { email?: string | null; id: string; username: string; displayName: string; phone?: string | null; isActive: boolean; dateOfBirth?: string | null; financeStatus?: FinanceStatus | null; announcementsOptOut?: boolean; studentProfile?: StudentProfile | null; guardianProfile?: { relationship: string; students?: LinkedChild[] } | null; teacherProfile?: { id: string; approvalStatus?: string; teacherFlags?: TeacherFlagForDisplay[]; subjects?: TeacherSubject[]; studentsBySubject?: Record<string, AssignedSubjectStudent[]> } | null };
type GuardianOption = { id: string; displayName: string };

function paymentTone(status: PaymentStatus | null): BadgeTone {
  if (status === "PAID") return "success";
  if (status === "PENDING") return "pending";
  if (status === "FAILED") return "danger";
  return "neutral";
}

function calculateAge(dateOfBirth: string | null | undefined): number | null {
  if (!dateOfBirth) return null;
  const birth = new Date(`${dateOfBirth}T00:00:00Z`);
  if (!Number.isFinite(birth.getTime())) return null;
  const today = new Date();
  let age = today.getUTCFullYear() - birth.getUTCFullYear();
  const month = today.getUTCMonth() - birth.getUTCMonth();
  if (month < 0 || (month === 0 && today.getUTCDate() < birth.getUTCDate())) age -= 1;
  return age;
}

/** `canSetAnnouncements`: ADMIN only — the "no announcements" flag (owner, 2026-10-26). */
export default function ProfilesPanel({ type, title, canSetAnnouncements = false, viewerRole = "ADMIN" }: { type: ProfileType; title: string; canSetAnnouncements?: boolean; viewerRole?: "ADMIN" | "SUPERVISOR" }) {
  const t = useTranslations("management.form");
  const locale = useLocale();
  const showFinance = type === "student";
  const showTeacherFlags = type === "teacher";
  const [rows, setRows] = useState<Row[]>([]);
const [form, setForm] = useState({ username: "", displayName: "", password: "", phone: "", relationship: "FATHER", guardianId: "", isAdult: false, rate: "", currency: "EGP", effectiveFrom: new Date().toISOString().slice(0, 10) });  // S-02: per-row rate typed by the Admin when approving a pending teacher.
  const editor = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState<Row | null>(null);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const ar = locale === "ar";
  const editLabel = ar ? "تعديل البيانات" : "Edit details";

  function openEditor(row: Row) {
    setSelected(row);
    setEditError("");
    editor.current?.showModal();
  }

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || saving) return;
    const values = new FormData(event.currentTarget);
    const changes: Record<string, string> = {};
    for (const field of ["displayName", "phone", "email"] as const) {
      const value = String(values.get(field) ?? "").trim();
      if (value !== (selected[field] ?? "")) changes[field] = value;
    }
    if (!Object.keys(changes).length) {
      editor.current?.close();
      return;
    }
    setSaving(true);
    setEditError("");
    try {
      const response = await fetch(`/api/admin/profiles/${selected.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(changes),
      });
      const result = await response.json();
      if (!response.ok) {
        setEditError(result.error?.message || t("loadFailed"));
        return;
      }
      setRows(current => current.map(row => row.id === selected.id ? { ...row, ...result.data } : row));
      setMessage(ar ? "تم حفظ التعديلات." : "Changes saved.");
      editor.current?.close();
    } catch {
      setEditError(ar ? "تعذّر تأكيد الحفظ. حاول مرة أخرى." : "Could not confirm the save. Try again.");
    } finally {
      setSaving(false);
    }
  }

  function editButton(row: Row) {
    return <button type="button" className="btn btn-outline" onClick={() => openEditor(row)}>{editLabel}</button>;
  }

  const [approveRates, setApproveRates] = useState<Record<string, string>>({});
  const isAdmin = viewerRole === "ADMIN";
  // D9: the Admin's rate is typed in major units (e.g. 150.00) and sent in minor units.
  const rateBody = (value: string, currency: string, effectiveFrom: string) => ({ hourlyRateMinor: Math.round(Number(value) * 100), currency, effectiveFrom: new Date(`${effectiveFrom}T00:00:00Z`).toISOString() });
  const [message, setMessage] = useState("");
  const [guardians, setGuardians] = useState<GuardianOption[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/profiles?type=${type}`)
      .then(async (response) => ({ response, payload: await response.json() }))
      .then(({ response, payload }) => {
        if (cancelled) return;
        if (response.ok) setRows(payload.data);
        else setMessage(payload.error?.message ?? t("loadFailed"));
      })
      .catch(() => {
        if (!cancelled) setMessage(t("loadFailed"));
      });
    return () => { cancelled = true; };
  }, [type, t]);
  useEffect(() => {
    if (type !== "student") return;
    fetch("/api/admin/profiles?type=guardian")
      .then((response) => response.json())
      .then((payload) => setGuardians(payload.data ?? []))
      .catch(() => undefined);
  }, [type]);

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const account = { username: form.username, displayName: form.displayName, password: form.password,phone:form.phone };
    const body = type === "guardian"
      ? { ...account, relationship: form.relationship }
      : type === "student"
        ? { ...account, isAdult: form.isAdult, ...(form.guardianId ? { guardianId: form.guardianId } : {}) }
        : { ...account, ...(isAdmin ? { rate: rateBody(form.rate, form.currency, form.effectiveFrom) } : {}) };
    const response = await fetch(`/api/admin/profiles?type=${type}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const payload = await response.json();
    if (!response.ok) { setMessage(payload.error?.message ?? t("createFailed")); return; }
    setForm({ ...form, username: "", displayName: "", password: "", phone: "", guardianId: "", isAdult: false, rate: "" });    
    setMessage(type === "teacher" && !isAdmin ? t("teacherSentForApproval") : t("profileCreated"));
    const refreshed = await fetch(`/api/admin/profiles?type=${type}`);
    const refreshedPayload = await refreshed.json();
    if (refreshed.ok) setRows(refreshedPayload.data);
  }
  async function approveTeacher(row: Row) {
    const teacherId = row.teacherProfile?.id;
    const value = approveRates[row.id] ?? "";
    if (!teacherId || !(Number(value) > 0)) { setMessage(t("rateRequired")); return; }
    const response = await fetch(`/api/admin/teachers/${teacherId}/approve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rate: rateBody(value, "EGP", new Date().toISOString().slice(0, 10)) }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) { setMessage(payload.error?.message ?? t("updateFailed")); return; }
    setMessage(t("teacherApproved", { name: row.displayName }));
    setRows((current) => current.map((item) => item.id === row.id ? { ...item, isActive: true, teacherProfile: { ...item.teacherProfile, id: teacherId, approvalStatus: "APPROVED" } } : item));
  }
  async function toggle(row: Row) {
    const response = await fetch(`/api/admin/profiles/${row.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ isActive: !row.isActive }) });
    const payload = await response.json();
    if (!response.ok) { setMessage(payload.error?.message ?? t("updateFailed")); return; }
    setRows((current) => current.map((item) => item.id === row.id ? { ...item, isActive: !row.isActive } : item));
  }
  async function toggleAnnouncements(row: Row) {
    const next = !row.announcementsOptOut;
    const response = await fetch(`/api/admin/profiles/${row.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ announcementsOptOut: next }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) { setMessage(payload.error?.message ?? t("updateFailed")); return; }
    setRows((current) => current.map((item) => item.id === row.id ? { ...item, announcementsOptOut: next } : item));
  }
  // Hidden until migration 20261026180000 is applied (the API then omits the field).
  const showAnnouncements = canSetAnnouncements && rows.some((row) => row.announcementsOptOut !== undefined);
  return (
    <div className="mt-6 space-y-6">
      <dialog ref={editor} aria-labelledby="profile-editor-heading" onClose={() => setSelected(null)}
        onCancel={event => { if (saving) event.preventDefault(); }}
        className="m-auto w-full max-w-md rounded-xl p-6 backdrop:bg-black/40">
        {selected && <form key={selected.id} onSubmit={saveProfile} className="grid gap-4">
          <h2 id="profile-editor-heading" className="text-lg font-semibold">{editLabel} · {selected.displayName}</h2>
          <label>{t("displayName")}<input name="displayName" required minLength={2} maxLength={100} defaultValue={selected.displayName} className="z-input" /></label>
          <label>{ar ? "رقم الهاتف" : "Phone number"}<input name="phone" type="tel" dir="ltr" maxLength={40} defaultValue={selected.phone ?? ""} className="z-input" /></label>
          <label>{ar ? "البريد الإلكتروني" : "Email"}<input name="email" type="email" dir="ltr" defaultValue={selected.email ?? ""} className="z-input" /></label>
          {editError && <p role="alert">{editError}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={saving} className="btn btn-primary">{ar ? "حفظ" : "Save"}</button>
            <button type="button" disabled={saving} className="btn btn-outline" onClick={() => editor.current?.close()}>{ar ? "إلغاء" : "Cancel"}</button>
          </div>
        </form>}
      </dialog>
      <form method="post" onSubmit={create} className="z-card rounded-xl grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4">
        <input required placeholder={t("username")} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} className="z-input" />
        <input required placeholder={t("displayName")} value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} className="z-input" />
        <input required minLength={12} type="password" placeholder={t("temporaryPassword")} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="z-input" />
       <input
  required
type="tel"
  inputMode="tel"
  dir="ltr"
  autoComplete="off"
  placeholder={t("phoneWhatsapp")}
  aria-label={t("phoneWhatsapp")}
  value={form.phone}
  onChange={(e) => setForm({ ...form, phone: e.target.value })}
  className="z-input"
/>
        {type === "guardian" ? <select aria-label={t("relationship")} value={form.relationship} onChange={(e) => setForm({ ...form, relationship: e.target.value })} className="z-input"><option value="FATHER">{t("relationshipFather")}</option><option value="MOTHER">{t("relationshipMother")}</option></select> : type === "student" ? <select aria-label={t("guardian")} value={form.guardianId} onChange={(e) => setForm({ ...form, guardianId: e.target.value })} className="z-input"><option value="">{t("noGuardian")}</option>{guardians.map((guardian) => <option key={guardian.id} value={guardian.id}>{guardian.displayName}</option>)}</select> : null}
        {type === "student" ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isAdult} onChange={(e) => setForm({ ...form, isAdult: e.target.checked })} className="h-4 w-4 accent-secondary" />{t("isAdult")}</label> : null}
        {type === "teacher" && isAdmin ? <><input required type="number" min="0.01" step="0.01" inputMode="decimal" placeholder={t("hourlyRate")} aria-label={t("hourlyRate")} value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} className="z-input" /><select aria-label={t("rateCurrency")} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} className="z-input"><option value="EGP">EGP</option><option value="USD">USD</option></select><label className="grid gap-1 text-label-sm text-on-surface-variant">{t("rateFrom")}<input required type="date" value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} className="z-input text-sm" /></label></> : null}
        {type === "teacher" && !isAdmin ? <p className="text-label-sm text-on-surface-variant sm:col-span-2 lg:col-span-4">{t("teacherNeedsApproval")}</p> : null}
        <button className="btn btn-primary">{t("create")}</button>
        {message ? <p role="status" className="text-body-sm text-on-surface-variant sm:col-span-2 lg:col-span-4">{message}</p> : null}
      </form>
      <div className="z-card rounded-xl p-4 sm:p-5">
        <h2 className="mb-4 font-semibold text-primary">{title}</h2>
        <div role="region" aria-label={title} tabIndex={0} className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[640px] text-start text-sm">
            <thead className="border-b border-outline-variant text-label-sm text-on-surface-variant">
              <tr>
                <th className="px-3 py-2 text-start">{t("name")}</th>
                <th className="px-3 py-2 text-start">{t("usernameCol")}</th>
                <th className="px-3 py-2 text-start">{t("phoneCol")}</th>
                {type === "student" ? <><th className="px-3 py-2 text-start">{t("dateOfBirth")}</th><th className="px-3 py-2 text-start">{t("guardian")}</th></> : null}
                {type === "guardian" ? <><th className="px-3 py-2 text-start">{t("relationship")}</th><th className="px-3 py-2 text-start">{t("linkedChildren")}</th></> : null}
                {type === "teacher" ? <th className="px-3 py-2 text-start">{t("subjects")}</th> : null}
                {showFinance ? <><th className="px-3 py-2 text-start">{t("paymentCol")}</th><th className="px-3 py-2 text-start">{t("remainingCol")}</th></> : null}
                {type === "student" ? <th className="px-3 py-2 text-start">{t("activeAssignments")}</th> : null}
                <th className="px-3 py-2 text-start">{t("status")}</th>
                {showTeacherFlags ? <th className="px-3 py-2 text-start">{t("teacherFlags.title")}</th> : null}
                {showAnnouncements ? <th className="px-3 py-2 text-start">{t("announcements")}</th> : null}
                <th className="px-3 py-2 text-start">{t("action")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const dob = row.dateOfBirth ?? row.studentProfile?.dateOfBirth ?? null;
                const age = calculateAge(dob);
                const guardian = row.studentProfile?.guardian;
                const assignments = row.studentProfile?.activeAssignments ?? [];
                const dobLabel = dob ? new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${dob}T00:00:00Z`)) : t("noDateOfBirth");
                return <tr key={row.id} className="border-b border-outline-variant last:border-0">
                  <td className="px-3 py-3 font-medium">{row.displayName}</td>
                  <td className="px-3 py-3 text-on-surface-variant">{row.username}</td>
                  <td className="px-3 py-3"><WhatsAppPhoneLink phone={row.phone} label={t("whatsappChat", { name: row.displayName })} /></td>
                  {type === "student" ? <><td className="px-3 py-3"><div className="tabular-nums">{dobLabel}</div>{age !== null ? <div className="mt-1 text-label-sm text-on-surface-variant">{t("age", { age })} · {row.studentProfile?.isAdult ? t("adult") : t("minor")}</div> : <div className="mt-1 text-label-sm text-on-surface-variant">{row.studentProfile?.isAdult ? t("adult") : t("minor")}</div>}</td><td className="px-3 py-3">{guardian ? <><div className="font-medium">{guardian.displayName}</div><div className="mt-1 text-label-sm text-on-surface-variant">{t("relationship")}: {guardian.relationship === "FATHER" ? t("relationshipFather") : guardian.relationship === "MOTHER" ? t("relationshipMother") : guardian.relationship}</div></> : t("noGuardian")}</td></> : null}
                  {type === "guardian" ? (() => { const linkedChildren = row.guardianProfile?.students ?? []; const relationship = row.guardianProfile?.relationship; return <><td className="px-3 py-3 font-medium">{relationship === "FATHER" ? t("relationshipFather") : relationship === "MOTHER" ? t("relationshipMother") : relationship || t("notRecorded")}</td><td className="px-3 py-3"><details className="max-w-80"><summary aria-label={t("detailsFor", { name: row.displayName })} className="cursor-pointer rounded-sm font-semibold text-secondary underline decoration-secondary/50 underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary">{t("linkedChildrenCount", { count: linkedChildren.length })}</summary><div className="mt-2 border-t border-outline-variant pt-2">{linkedChildren.length ? <ul className="space-y-3">{linkedChildren.map((child) => { const childAge = calculateAge(child.dateOfBirth); const childDob = child.dateOfBirth ? new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${child.dateOfBirth}T00:00:00Z`)) : t("noDateOfBirth"); const assignments = child.assignments ?? []; return <li key={child.id} className="space-y-1"><div className="font-medium">{child.displayName}</div><div className="text-label-sm text-on-surface-variant">{t("dateOfBirth")}: {childDob} · {child.isAdult ? t("adult") : t("minor")}{childAge !== null ? ` · ${t("age", { age: childAge })}` : ""}</div><div className="text-label-sm"><span className="font-semibold">{t("activeAssignments")}:</span> {assignments.length ? "" : t("noAssignments")}</div>{assignments.length ? <ul className="ms-3 space-y-1">{assignments.map((item) => <li key={item.subjectId}><span className="font-medium">{locale === "ar" ? item.subjectNameAr : item.subjectNameEn}</span><span className="text-label-sm text-on-surface-variant"> · {t("teachers")}: {item.teacherName || t("notAssigned")}</span></li>)}</ul> : null}</li>; })}</ul> : <p className="text-body-sm text-on-surface-variant">{t("noChildren")}</p>}</div></details></td></>; })() : null}
                  {showFinance ? <><td className="px-3 py-3"><StatusBadge tone={paymentTone(row.financeStatus?.paymentStatus ?? null)}>{t(`paymentStatus.${row.financeStatus?.paymentStatus ?? "NONE"}`)}</StatusBadge></td><td className="px-3 py-3 tabular-nums">{row.financeStatus?.remainingSessions ?? 0}</td></> : null}
                  {type === "teacher" ? (() => { const subjects = row.teacherProfile?.subjects ?? []; const studentsBySubject = row.teacherProfile?.studentsBySubject ?? {}; return <td className="px-3 py-3"><details className="max-w-80"><summary aria-label={t("detailsFor", { name: row.displayName })} className="cursor-pointer rounded-sm font-semibold text-secondary underline decoration-secondary/50 underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary">{t("subjectCount", { count: subjects.length })}</summary><div className="mt-2 border-t border-outline-variant pt-2">{subjects.length ? <ul className="space-y-3">{subjects.map((subject) => { const students = studentsBySubject[subject.id] ?? []; return <li key={subject.id} className="space-y-1"><div className="font-medium">{locale === "ar" ? subject.nameAr : subject.nameEn}</div><div className="text-label-sm text-on-surface-variant">{t("activeAssignedStudents")}</div>{students.length ? <ul className="ms-3 list-disc space-y-1 text-label-sm">{students.map((student) => <li key={student.id}>{student.displayName}<span className="text-on-surface-variant"> · {student.isAdult ? t("adult") : t("minor")}</span></li>)}</ul> : <p className="text-label-sm text-on-surface-variant">{t("noAssignedStudents")}</p>}</li>; })}</ul> : <p className="text-body-sm text-on-surface-variant">{t("noSubjects")}</p>}</div></details></td>; })() : null}
                  {type === "student" ? <td className="px-3 py-3"><details className="max-w-72"><summary aria-label={t("detailsFor", { name: row.displayName })} className="cursor-pointer rounded-sm font-semibold text-secondary underline decoration-secondary/50 underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary">{assignments.length ? `${t("subjects")}: ${assignments.map((item) => locale === "ar" ? item.subjectNameAr : item.subjectNameEn).filter(Boolean).join("، ")}` : t("noAssignments")}</summary><div className="mt-2 border-t border-outline-variant pt-2"><div className="mb-1 text-label-sm font-semibold">{t("activeAssignments")}</div>{assignments.length ? <ul className="space-y-2">{assignments.map((item) => <li key={item.subjectId}><div className="font-medium">{locale === "ar" ? item.subjectNameAr : item.subjectNameEn}</div><div className="text-label-sm text-on-surface-variant">{t("teachers")}: {item.teacherName || t("notAssigned")}</div></li>)}</ul> : <p className="text-body-sm text-on-surface-variant">{t("noAssignments")}</p>}</div></details></td> : null}
                  <td className="px-3 py-3">{row.teacherProfile?.approvalStatus === "PENDING" ? <StatusBadge tone="pending">{t("pendingApproval")}</StatusBadge> : row.isActive ? t("active") : t("inactive")}</td>
                  {showTeacherFlags ? <td className="px-3 py-3"><TeacherFlagsCell flags={row.teacherProfile?.teacherFlags ?? []} /></td> : null}
                  {showAnnouncements ? <td className="px-3 py-3"><button onClick={() => toggleAnnouncements(row)} title={t("announcementsHint")} className="btn btn-outline">{row.announcementsOptOut ? t("announcementsOff") : t("announcementsOn")}</button></td> : null}
                  <td className="px-3 py-3">{editButton(row)} {row.teacherProfile?.approvalStatus === "PENDING" ? isAdmin ? <span className="flex flex-wrap items-center gap-2"><input type="number" min="0.01" step="0.01" inputMode="decimal" aria-label={t("hourlyRateFor", { name: row.displayName })} placeholder={t("hourlyRate")} value={approveRates[row.id] ?? ""} onChange={(e) => setApproveRates((current) => ({ ...current, [row.id]: e.target.value }))} className="w-28 rounded-lg border border-outline-variant px-2 py-1 text-xs" /><button onClick={() => approveTeacher(row)} className="btn btn-primary px-3 py-1 text-xs">{t("approveTeacher")}</button></span> : <span className="text-label-sm text-on-surface-variant">{t("waitingForAdmin")}</span> : <button onClick={() => toggle(row)} className="btn btn-outline">{row.isActive ? t("deactivate") : t("activate")}</button>}</td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>
        <ul className="divide-y divide-outline-variant md:hidden" aria-label={title}>
          {rows.map((row) => {
            const dob = row.dateOfBirth ?? row.studentProfile?.dateOfBirth ?? null;
            const age = calculateAge(dob);
            const guardian = row.studentProfile?.guardian;
            const assignments = row.studentProfile?.activeAssignments ?? [];
            const dobLabel = dob ? new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${dob}T00:00:00Z`)) : t("noDateOfBirth");
            return <li key={row.id} className="grid min-w-0 gap-3 py-4">
              <div className="min-w-0"><span className="block text-label-sm text-on-surface-variant">{t("name")}</span><span className="block min-w-0 break-words font-medium">{row.displayName}</span></div>
              <div><span className="block text-label-sm text-on-surface-variant">{t("usernameCol")}</span><span>{row.username}</span></div>
              <div><span className="block text-label-sm text-on-surface-variant">{t("phoneCol")}</span><WhatsAppPhoneLink phone={row.phone} label={t("whatsappChat", { name: row.displayName })} /></div>
              {type === "student" ? <><div><span className="block text-label-sm text-on-surface-variant">{t("dateOfBirth")}</span><span className="tabular-nums">{dobLabel}</span>{age !== null ? <span className="ms-2 text-label-sm">{t("age", { age })} · </span> : null}<span className="text-label-sm">{row.studentProfile?.isAdult ? t("adult") : t("minor")}</span></div><div><span className="block text-label-sm text-on-surface-variant">{t("guardian")}</span>{guardian ? <><span className="block min-w-0 break-words font-medium">{guardian.displayName}</span><span className="block text-label-sm text-on-surface-variant">{t("relationship")}: {guardian.relationship === "FATHER" ? t("relationshipFather") : guardian.relationship === "MOTHER" ? t("relationshipMother") : guardian.relationship}</span></> : <span>{t("noGuardian")}</span>}</div></> : null}
              {type === "guardian" ? (() => { const linkedChildren = row.guardianProfile?.students ?? []; const relationship = row.guardianProfile?.relationship; return <><div><span className="block text-label-sm text-on-surface-variant">{t("relationship")}</span><span className="font-medium">{relationship === "FATHER" ? t("relationshipFather") : relationship === "MOTHER" ? t("relationshipMother") : relationship || t("notRecorded")}</span></div><div><span className="block text-label-sm text-on-surface-variant">{t("linkedChildren")}</span><details><summary aria-label={t("detailsFor", { name: row.displayName })} className="cursor-pointer rounded-sm py-1 font-semibold text-secondary underline decoration-secondary/50 underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary">{t("linkedChildrenCount", { count: linkedChildren.length })}</summary><div className="mt-2 border-t border-outline-variant pt-2">{linkedChildren.length ? <ul className="space-y-3">{linkedChildren.map((child) => { const childAge = calculateAge(child.dateOfBirth); const childDob = child.dateOfBirth ? new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${child.dateOfBirth}T00:00:00Z`)) : t("noDateOfBirth"); const assignments = child.assignments ?? []; return <li key={child.id} className="space-y-1"><div className="min-w-0 break-words font-medium">{child.displayName}</div><div className="text-label-sm text-on-surface-variant">{t("dateOfBirth")}: {childDob} · {child.isAdult ? t("adult") : t("minor")}{childAge !== null ? ` · ${t("age", { age: childAge })}` : ""}</div><div className="text-label-sm"><span className="font-semibold">{t("activeAssignments")}:</span> {assignments.length ? "" : t("noAssignments")}</div>{assignments.length ? <ul className="ms-3 space-y-1">{assignments.map((item) => <li key={item.subjectId}><span className="font-medium">{locale === "ar" ? item.subjectNameAr : item.subjectNameEn}</span><span className="text-label-sm text-on-surface-variant"> · {t("teachers")}: {item.teacherName || t("notAssigned")}</span></li>)}</ul> : null}</li>; })}</ul> : <p className="text-body-sm text-on-surface-variant">{t("noChildren")}</p>}</div></details></div></>; })() : null}
              {showFinance ? <><div><span className="block text-label-sm text-on-surface-variant">{t("paymentCol")}</span><StatusBadge tone={paymentTone(row.financeStatus?.paymentStatus ?? null)}>{t(`paymentStatus.${row.financeStatus?.paymentStatus ?? "NONE"}`)}</StatusBadge></div><div><span className="block text-label-sm text-on-surface-variant">{t("remainingCol")}</span><span className="tabular-nums">{row.financeStatus?.remainingSessions ?? 0}</span></div></> : null}
              {type === "teacher" ? (() => { const subjects = row.teacherProfile?.subjects ?? []; const studentsBySubject = row.teacherProfile?.studentsBySubject ?? {}; return <div><span className="block text-label-sm text-on-surface-variant">{t("subjects")}</span><details><summary aria-label={t("detailsFor", { name: row.displayName })} className="cursor-pointer rounded-sm py-1 font-semibold text-secondary underline decoration-secondary/50 underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary">{t("subjectCount", { count: subjects.length })}</summary><div className="mt-2 border-t border-outline-variant pt-2">{subjects.length ? <ul className="space-y-3">{subjects.map((subject) => { const students = studentsBySubject[subject.id] ?? []; return <li key={subject.id} className="space-y-1"><div className="font-medium">{locale === "ar" ? subject.nameAr : subject.nameEn}</div><div className="text-label-sm text-on-surface-variant">{t("activeAssignedStudents")}</div>{students.length ? <ul className="ms-3 list-disc space-y-1 text-label-sm">{students.map((student) => <li key={student.id} className="min-w-0 break-words">{student.displayName}<span className="text-on-surface-variant"> · {student.isAdult ? t("adult") : t("minor")}</span></li>)}</ul> : <p className="text-label-sm text-on-surface-variant">{t("noAssignedStudents")}</p>}</li>; })}</ul> : <p className="text-body-sm text-on-surface-variant">{t("noSubjects")}</p>}</div></details></div>; })() : null}
              {type === "student" ? <div><span className="block text-label-sm text-on-surface-variant">{t("activeAssignments")}</span><details><summary aria-label={t("detailsFor", { name: row.displayName })} className="cursor-pointer rounded-sm py-1 font-semibold text-secondary underline decoration-secondary/50 underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary">{assignments.length ? `${t("subjects")}: ${assignments.map((item) => locale === "ar" ? item.subjectNameAr : item.subjectNameEn).filter(Boolean).join("، ")}` : t("noAssignments")}</summary><div className="mt-2 border-t border-outline-variant pt-2">{assignments.length ? <ul className="space-y-2">{assignments.map((item) => <li key={item.subjectId}><div className="font-medium">{locale === "ar" ? item.subjectNameAr : item.subjectNameEn}</div><div className="text-label-sm text-on-surface-variant">{t("teachers")}: {item.teacherName || t("notAssigned")}</div></li>)}</ul> : <p className="text-body-sm text-on-surface-variant">{t("noAssignments")}</p>}</div></details></div> : null}
              <div><span className="block text-label-sm text-on-surface-variant">{t("status")}</span>{row.teacherProfile?.approvalStatus === "PENDING" ? <StatusBadge tone="pending">{t("pendingApproval")}</StatusBadge> : row.isActive ? t("active") : t("inactive")}</div>
              {showAnnouncements ? <div><span className="block text-label-sm text-on-surface-variant">{t("announcements")}</span><button onClick={() => toggleAnnouncements(row)} title={t("announcementsHint")} className="btn btn-outline">{row.announcementsOptOut ? t("announcementsOff") : t("announcementsOn")}</button></div> : null}
              <div><span className="block text-label-sm text-on-surface-variant">{t("action")}</span>{editButton(row)} {row.teacherProfile?.approvalStatus === "PENDING" ? isAdmin ? <span className="flex flex-wrap items-center gap-2"><input type="number" min="0.01" step="0.01" inputMode="decimal" aria-label={t("hourlyRateFor", { name: row.displayName })} placeholder={t("hourlyRate")} value={approveRates[row.id] ?? ""} onChange={(e) => setApproveRates((current) => ({ ...current, [row.id]: e.target.value }))} className="w-28 rounded-lg border border-outline-variant px-2 py-1 text-xs" /><button onClick={() => approveTeacher(row)} className="btn btn-primary px-3 py-1 text-xs">{t("approveTeacher")}</button></span> : <span className="text-label-sm text-on-surface-variant">{t("waitingForAdmin")}</span> : <button onClick={() => toggle(row)} className="btn btn-outline">{row.isActive ? t("deactivate") : t("activate")}</button>}</div>
            </li>;
          })}
        </ul>
      </div>
    </div>
  );
}
