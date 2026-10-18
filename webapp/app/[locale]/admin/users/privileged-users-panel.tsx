"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

type PrivilegedUser = {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  role: "ADMIN" | "SUPERVISOR";
  isActive: boolean;
};

export default function PrivilegedUsersPanel({
  initialUsers,
  currentUserId,
}: {
  initialUsers: PrivilegedUser[];
  currentUserId: string;
}) {
  const t = useTranslations("management.form");
  const [users, setUsers] = useState(initialUsers);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({ username: "", displayName: "", password: "", role: "SUPERVISOR" });

  async function createUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(form),
    });
    const payload = await response.json();
    if (!response.ok) {
      setMessage(payload.error?.message ?? t("addFailed"));
      return;
    }
    setUsers((current) => [...current, payload.data]);
    setForm({ username: "", displayName: "", password: "", role: "SUPERVISOR" });
    setMessage(t("accountCreated"));
  }

  async function toggleUser(account: PrivilegedUser) {
    setMessage("");
    const response = await fetch(`/api/admin/users/${account.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isActive: !account.isActive }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setMessage(payload.error?.message ?? t("updateAccountFailed"));
      return;
    }
    setUsers((current) => current.map((item) => (item.id === account.id ? { ...item, ...payload.data } : item)));
  }

  return (
    <div className="mt-6 space-y-6">
      <form onSubmit={createUser} className="dashboard-card grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4">
        <input required minLength={3} placeholder={t("username")} value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} className="rounded-lg border border-[var(--line)] px-3 py-2" />
        <input required minLength={2} placeholder={t("displayName")} value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} className="rounded-lg border border-[var(--line)] px-3 py-2" />
        <input required minLength={12} type="password" placeholder={t("password")} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} className="rounded-lg border border-[var(--line)] px-3 py-2" />
        <div className="flex gap-2">
          <select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })} className="min-w-0 flex-1 rounded-lg border border-[var(--line)] px-3 py-2">
            <option value="SUPERVISOR">{t("supervisorRole")}</option>
            <option value="ADMIN">{t("adminRole")}</option>
          </select>
          <button type="submit" className="cta-primary rounded-lg px-3 py-2 text-sm">{t("create")}</button>
        </div>
        {message ? <p role="status" className="text-sm opacity-75 sm:col-span-2 lg:col-span-4">{message}</p> : null}
      </form>

      <div className="dashboard-card overflow-x-auto p-5">
        <table className="w-full min-w-[620px] text-start text-sm">
          <thead className="border-b border-[var(--line)] text-xs opacity-70">
            <tr><th className="px-3 py-2 text-start">{t("name")}</th><th className="px-3 py-2 text-start">{t("usernameCol")}</th><th className="px-3 py-2 text-start">{t("role")}</th><th className="px-3 py-2 text-start">{t("status")}</th><th className="px-3 py-2 text-start">{t("action")}</th></tr>
          </thead>
          <tbody>
            {users.map((account) => (
              <tr key={account.id} className="border-b border-[var(--line)] last:border-0">
                <td className="px-3 py-3 font-medium">{account.displayName}</td>
                <td className="px-3 py-3 opacity-70">{account.username}</td>
                <td className="px-3 py-3">{account.role === "ADMIN" ? t("adminRole") : t("supervisorRole")}</td>
                <td className="px-3 py-3">{account.isActive ? t("active") : t("inactive")}</td>
                <td className="px-3 py-3">
                  <button disabled={account.id === currentUserId} onClick={() => toggleUser(account)} className="rounded-lg border border-[var(--line)] px-3 py-1 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40">
                    {account.isActive ? t("deactivate") : t("activate")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
