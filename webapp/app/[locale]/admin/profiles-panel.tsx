"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import StatusBadge, { type BadgeTone } from "../../_components/ui/status-badge";
import WhatsAppPhoneLink from "../../_components/ui/whatsapp-phone-link";

type ProfileType = "student" | "guardian" | "teacher";
type PaymentStatus = "PAID" | "PENDING" | "FAILED" | "CANCELLED";
/** S-09 / D29: amount-free per-student status (students list only). */
type FinanceStatus = { remainingSessions: number; paymentStatus: PaymentStatus | null };
type Row = { id: string; username: string; displayName: string; phone?: string | null; isActive: boolean; financeStatus?: FinanceStatus | null; announcementsOptOut?: boolean; studentProfile?: { guardianId: string | null } | null; guardianProfile?: { relationship: string } | null; teacherProfile?: { id: string; approvalStatus?: string } | null };
type GuardianOption = { id: string; displayName: string };

function paymentTone(status: PaymentStatus | null): BadgeTone {
  if (status === "PAID") return "success";
  if (status === "PENDING") return "pending";
  if (status === "FAILED") return "danger";
  return "neutral";
}

/** `canSetAnnouncements`: ADMIN only — the "no announcements" flag (owner, 2026-10-26). */
export default function ProfilesPanel({ type, title, canSetAnnouncements = false, viewerRole = "ADMIN" }: { type: ProfileType; title: string; canSetAnnouncements?: boolean; viewerRole?: "ADMIN" | "SUPERVISOR" }) {
  const t = useTranslations("management.form");
  const showFinance = type === "student";
  const [rows, setRows] = useState<Row[]>([]);
  const [form, setForm] = useState({ username: "", displayName: "", password: "", relationship: "FATHER", guardianId: "", isAdult: false, rate: "", currency: "EGP", effectiveFrom: new Date().toISOString().slice(0, 10) });
  // S-02: per-row rate typed by the Admin when approving a pending teacher.
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
    const account = { username: form.username, displayName: form.displayName, password: form.password };
    const body = type === "guardian"
      ? { ...account, relationship: form.relationship }
      : type === "student"
        ? { ...account, isAdult: form.isAdult, ...(form.guardianId ? { guardianId: form.guardianId } : {}) }
        : { ...account, ...(isAdmin ? { rate: rateBody(form.rate, form.currency, form.effectiveFrom) } : {}) };
    const response = await fetch(`/api/admin/profiles?type=${type}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const payload = await response.json();
    if (!response.ok) { setMessage(payload.error?.message ?? t("createFailed")); return; }
    setForm({ ...form, username: "", displayName: "", password: "", guardianId: "", isAdult: false, rate: "" });
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
    setRows((current) => current.map((item) => item.id === row.id ? { ...item, isActive: true, teacherProfile: { id: teacherId, approvalStatus: "APPROVED" } } : item));
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
      <form method="post" onSubmit={create} className="dashboard-card grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4">
        <input required placeholder={t("username")} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} className="rounded-lg border border-[var(--line)] px-3 py-2" />
        <input required placeholder={t("displayName")} value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} className="rounded-lg border border-[var(--line)] px-3 py-2" />
        <input required minLength={12} type="password" placeholder={t("temporaryPassword")} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="rounded-lg border border-[var(--line)] px-3 py-2" />
        {type === "guardian" ? <select value={form.relationship} onChange={(e) => setForm({ ...form, relationship: e.target.value })} className="rounded-lg border border-[var(--line)] px-3 py-2"><option value="FATHER">{t("relationshipFather")}</option><option value="MOTHER">{t("relationshipMother")}</option></select> : type === "student" ? <select value={form.guardianId} onChange={(e) => setForm({ ...form, guardianId: e.target.value })} className="rounded-lg border border-[var(--line)] px-3 py-2"><option value="">{t("noGuardian")}</option>{guardians.map((guardian) => <option key={guardian.id} value={guardian.id}>{guardian.displayName}</option>)}</select> : null}
        {type === "student" ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isAdult} onChange={(e) => setForm({ ...form, isAdult: e.target.checked })} className="h-4 w-4 accent-[var(--emerald)]" />{t("isAdult")}</label> : null}
        {type === "teacher" && isAdmin ? <><input required type="number" min="0.01" step="0.01" inputMode="decimal" placeholder={t("hourlyRate")} aria-label={t("hourlyRate")} value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} className="rounded-lg border border-[var(--line)] px-3 py-2" /><select aria-label={t("rateCurrency")} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} className="rounded-lg border border-[var(--line)] px-3 py-2"><option value="EGP">EGP</option><option value="USD">USD</option></select><label className="grid gap-1 text-xs opacity-80">{t("rateFrom")}<input required type="date" value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm" /></label></> : null}
        {type === "teacher" && !isAdmin ? <p className="text-xs opacity-75 sm:col-span-2 lg:col-span-4">{t("teacherNeedsApproval")}</p> : null}
        <button className="cta-primary rounded-lg px-3 py-2 text-sm">{t("create")}</button>
        {message ? <p role="status" className="text-sm opacity-75 sm:col-span-2 lg:col-span-4">{message}</p> : null}
      </form>
      <div className="dashboard-card overflow-x-auto p-5"><h2 className="mb-4 font-semibold text-[var(--navy)]">{title}</h2><table className="w-full min-w-[640px] text-start text-sm"><thead className="border-b border-[var(--line)] text-xs opacity-70"><tr><th className="px-3 py-2 text-start">{t("name")}</th><th className="px-3 py-2 text-start">{t("usernameCol")}</th><th className="px-3 py-2 text-start">{t("phoneCol")}</th>{showFinance ? <><th className="px-3 py-2 text-start">{t("paymentCol")}</th><th className="px-3 py-2 text-start">{t("remainingCol")}</th></> : null}<th className="px-3 py-2 text-start">{t("status")}</th>{showAnnouncements ? <th className="px-3 py-2 text-start">{t("announcements")}</th> : null}<th className="px-3 py-2 text-start">{t("action")}</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id} className="border-b border-[var(--line)] last:border-0"><td className="px-3 py-3">{row.displayName}</td><td className="px-3 py-3 opacity-70">{row.username}</td><td className="px-3 py-3"><WhatsAppPhoneLink phone={row.phone} label={t("whatsappChat", { name: row.displayName })} /></td>{showFinance ? <><td className="px-3 py-3"><StatusBadge tone={paymentTone(row.financeStatus?.paymentStatus ?? null)}>{t(`paymentStatus.${row.financeStatus?.paymentStatus ?? "NONE"}`)}</StatusBadge></td><td className="px-3 py-3 tabular-nums">{row.financeStatus?.remainingSessions ?? 0}</td></> : null}<td className="px-3 py-3">{row.teacherProfile?.approvalStatus === "PENDING" ? <StatusBadge tone="pending">{t("pendingApproval")}</StatusBadge> : row.isActive ? t("active") : t("inactive")}</td>{showAnnouncements ? <td className="px-3 py-3"><button onClick={() => toggleAnnouncements(row)} title={t("announcementsHint")} className="rounded-lg border border-[var(--line)] px-3 py-1 text-xs font-semibold">{row.announcementsOptOut ? t("announcementsOff") : t("announcementsOn")}</button></td> : null}<td className="px-3 py-3">{row.teacherProfile?.approvalStatus === "PENDING" ? (isAdmin ? <span className="flex flex-wrap items-center gap-2"><input type="number" min="0.01" step="0.01" inputMode="decimal" aria-label={t("hourlyRateFor", { name: row.displayName })} placeholder={t("hourlyRate")} value={approveRates[row.id] ?? ""} onChange={(e) => setApproveRates((current) => ({ ...current, [row.id]: e.target.value }))} className="w-28 rounded-lg border border-[var(--line)] px-2 py-1 text-xs" /><button onClick={() => approveTeacher(row)} className="cta-primary rounded-lg px-3 py-1 text-xs">{t("approveTeacher")}</button></span> : <span className="text-xs opacity-70">{t("waitingForAdmin")}</span>) : <button onClick={() => toggle(row)} className="rounded-lg border border-[var(--line)] px-3 py-1 text-xs font-semibold">{row.isActive ? t("deactivate") : t("activate")}</button>}</td></tr>)}</tbody></table></div>
    </div>
  );
}
