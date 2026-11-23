"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

type Profile = { dateOfBirth: string; displayName: string; username: string; email: string; phone: string; preferredLanguage: string };
const inputs = [
  { key: "dateOfBirth", type: "date", complete: "bday", max: 10 },
  { key: "displayName", type: "text", complete: "name", max: 120 },
  { key: "username", type: "text", complete: "username", max: 30 },
  { key: "email", type: "email", complete: "email", max: 254 },
  { key: "phone", type: "tel", complete: "tel", max: 40 },
] as const;

export default function ProfileForm({ initial }: { initial: Profile }) {
  const t = useTranslations("account.profile");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const changes = Object.fromEntries(Object.entries(initial)
      .map(([key, original]) => [key, String(values.get(key) ?? "").trim(), original])
      .filter(([, value, original]) => value !== original)
      .map(([key, value]) => [key, value]));
    if (!Object.keys(changes).length) { setMessage(t("unchanged")); return; }
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/me/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(changes) });
      if (res.ok) {
        setMessage(t("saved"));
        router.refresh();
      } else {
        const body = await res.json().catch(() => null);
        const field = inputs.find(input => body?.error?.fields?.includes(input.key));
        setMessage(res.status === 409 ? t("taken") : field ? t("invalid", { field: t(field.key) }) : t("failed"));
      }
    } catch { setMessage(t("failed")); }
    finally { setBusy(false); }
  }
  return <form onSubmit={save} className="grid max-w-xl gap-4">
    <h2 className="text-lg font-semibold">{t("title")}</h2>
    {inputs.map(({ key, type, complete, max }) => <label key={key} className="grid gap-1 text-sm">
      {t(key)}
      <input className="z-input" type={type} dir={key === "displayName" ? "auto" : "ltr"} name={key} defaultValue={initial[key]}
        autoComplete={complete} maxLength={max} required={key === "displayName" || key === "username"} />
    </label>)}
    <label className="grid gap-1 text-sm">{t("language")}
      <select className="z-input" name="preferredLanguage" defaultValue={initial.preferredLanguage}>
        <option value="ar">العربية</option><option value="en">English</option>
      </select>
    </label>
    <button className="cta-primary justify-self-start rounded-xl px-4 py-2" disabled={busy}>{t("save")}</button>
    <p role="status">{message}</p>
  </form>;
}
