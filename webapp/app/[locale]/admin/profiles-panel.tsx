"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

type ProfileType = "student" | "guardian" | "teacher";
type Row = { id: string; username: string; displayName: string; isActive: boolean; studentProfile?: { guardianId: string | null } | null; guardianProfile?: { relationship: string } | null };
type GuardianOption = { id: string; displayName: string };

export default function ProfilesPanel({ type, title }: { type: ProfileType; title: string }) {
  const t = useTranslations("management.form");
  const [rows, setRows] = useState<Row[]>([]);
  const [form, setForm] = useState({ username: "", displayName: "", password: "", relationship: "FATHER", guardianId: "" });
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
    const body = type === "guardian" ? form : { username: form.username, displayName: form.displayName, password: form.password, ...(type === "student" && form.guardianId ? { guardianId: form.guardianId } : {}) };
    const response = await fetch(`/api/admin/profiles?type=${type}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const payload = await response.json();
    if (!response.ok) { setMessage(payload.error?.message ?? t("createFailed")); return; }
    setForm({ username: "", displayName: "", password: "", relationship: "FATHER", guardianId: "" });
    setMessage(t("profileCreated"));
    const refreshed = await fetch(`/api/admin/profiles?type=${type}`);
    const refreshedPayload = await refreshed.json();
    if (refreshed.ok) setRows(refreshedPayload.data);
  }
  async function toggle(row: Row) {
    const response = await fetch(`/api/admin/profiles/${row.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ isActive: !row.isActive }) });
    const payload = await response.json();
    if (!response.ok) { setMessage(payload.error?.message ?? t("updateFailed")); return; }
    setRows((current) => current.map((item) => item.id === row.id ? { ...item, isActive: !row.isActive } : item));
  }
  return (
    <div className="mt-6 space-y-6">
      <form onSubmit={create} className="dashboard-card grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4">
        <input required placeholder={t("username")} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} className="rounded-lg border border-[var(--line)] px-3 py-2" />
        <input required placeholder={t("displayName")} value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} className="rounded-lg border border-[var(--line)] px-3 py-2" />
        <input required minLength={12} type="password" placeholder={t("temporaryPassword")} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="rounded-lg border border-[var(--line)] px-3 py-2" />
        {type === "guardian" ? <select value={form.relationship} onChange={(e) => setForm({ ...form, relationship: e.target.value })} className="rounded-lg border border-[var(--line)] px-3 py-2"><option value="FATHER">{t("relationshipFather")}</option><option value="MOTHER">{t("relationshipMother")}</option></select> : type === "student" ? <select value={form.guardianId} onChange={(e) => setForm({ ...form, guardianId: e.target.value })} className="rounded-lg border border-[var(--line)] px-3 py-2"><option value="">{t("noGuardian")}</option>{guardians.map((guardian) => <option key={guardian.id} value={guardian.id}>{guardian.displayName}</option>)}</select> : <button className="cta-primary rounded-lg px-3 py-2 text-sm">{t("create")}</button>}
        {type !== "teacher" ? <button className="cta-primary rounded-lg px-3 py-2 text-sm">{t("create")}</button> : null}
        {message ? <p role="status" className="text-sm opacity-75 sm:col-span-2 lg:col-span-4">{message}</p> : null}
      </form>
      <div className="dashboard-card overflow-x-auto p-5"><h2 className="mb-4 font-semibold text-[var(--navy)]">{title}</h2><table className="w-full min-w-[540px] text-start text-sm"><thead className="border-b border-[var(--line)] text-xs opacity-70"><tr><th className="px-3 py-2 text-start">{t("name")}</th><th className="px-3 py-2 text-start">{t("usernameCol")}</th><th className="px-3 py-2 text-start">{t("status")}</th><th className="px-3 py-2 text-start">{t("action")}</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id} className="border-b border-[var(--line)] last:border-0"><td className="px-3 py-3">{row.displayName}</td><td className="px-3 py-3 opacity-70">{row.username}</td><td className="px-3 py-3">{row.isActive ? t("active") : t("inactive")}</td><td className="px-3 py-3"><button onClick={() => toggle(row)} className="rounded-lg border border-[var(--line)] px-3 py-1 text-xs font-semibold">{row.isActive ? t("deactivate") : t("activate")}</button></td></tr>)}</tbody></table></div>
    </div>
  );
}
