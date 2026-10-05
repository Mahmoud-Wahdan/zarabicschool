"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

type Account = { key: string; role: string; username: string; displayName: string; tempPassword: string };

export default function CredentialsPanel({ accounts }: { accounts: Account[] }) {
  const t = useTranslations("adminApplications");
  const [hidden, setHidden] = useState(false);
  const [copied, setCopied] = useState("");

  async function copy(value: string, key: string) {
    await navigator.clipboard.writeText(value);
    setCopied(key);
    window.setTimeout(() => setCopied(""), 1500);
  }

  if (hidden) return <p className="mt-4 text-sm text-emerald-700">{t("credentials.done")}</p>;

  return (
    <section className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-5">
      <h2 className="font-semibold text-amber-950">{t("credentials.title")}</h2>
      <p className="mt-2 text-sm text-amber-900">{t("credentials.warning")}</p>
      <div className="mt-4 space-y-3">
        {accounts.map((account) => (
          <div key={account.key} className="rounded-lg bg-white p-3 text-sm">
            <p className="font-semibold">{account.displayName}</p>
            <CredentialRow label={t("credentials.username")} value={account.username} copied={copied === `${account.key}-username`} onCopy={() => void copy(account.username, `${account.key}-username`)} t={t} />
            <CredentialRow label={t("credentials.tempPassword")} value={account.tempPassword} copied={copied === `${account.key}-password`} onCopy={() => void copy(account.tempPassword, `${account.key}-password`)} t={t} />
          </div>
        ))}
      </div>
      <button type="button" onClick={() => setHidden(true)} className="mt-4 rounded-lg bg-[var(--navy)] px-4 py-2 text-sm font-semibold text-white">
        {t("credentials.done")}
      </button>
    </section>
  );
}

function CredentialRow({ label, value, copied, onCopy, t }: { label: string; value: string; copied: boolean; onCopy: () => void; t: (key: string) => string }) {
  return <div className="mt-2 flex items-center gap-2"><span className="w-32 text-xs opacity-60">{label}</span><code className="min-w-0 flex-1 break-all rounded bg-slate-100 px-2 py-1">{value}</code><button type="button" onClick={onCopy} className="shrink-0 text-xs font-semibold text-[var(--emerald)]">{copied ? t("credentials.copied") : t("credentials.copy")}</button></div>;
}
