"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import ApproveForm from "./approve-form";
import CredentialsPanel from "./credentials-panel";

type Account = {
  key: string;
  role: string;
  username: string;
  displayName: string;
  tempPassword: string;
};

export default function ReviewActions({
  applicationId,
  applicationType,
  status,
  details,
  childCount,
}: {
  applicationId: string;
  applicationType: "GUARDIAN" | "STUDENT" | "TEACHER";
  status: string;
  details: Record<string, unknown>;
  childCount: number;
}) {
  const t = useTranslations("adminApplications");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [reason, setReason] = useState("");
  const [accounts, setAccounts] = useState<Account[] | null>(null);

  async function post(path: string, body?: unknown) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/applications/${applicationId}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const payload = (await response.json()) as {
        error?: { message?: string };
        accounts?: Account[];
      };
      if (!response.ok) {
        setError(payload.error?.message ?? t("errors.generic"));
        return null;
      }
      router.refresh();
      return payload;
    } catch {
      setError(t("errors.generic"));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    if (!reason.trim()) {
      setError(t("rejectForm.reasonRequired"));
      return;
    }
    const result = await post("reject", { reason });
    if (result) setShowReject(false);
  }

  if (accounts) return <CredentialsPanel accounts={accounts} />;
  if (status === "APPROVED") return null;

  return (
    <section className="mt-4 rounded-xl border border-[var(--line)] bg-white p-5">
      <h2 className="font-semibold text-[var(--navy)]">{t("actions.title")}</h2>
      {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}

      <div className="mt-4 flex flex-wrap gap-3">
        {status === "NEW" && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void post("review")}
            className="rounded-lg border border-[var(--navy)] px-4 py-2 text-sm font-semibold text-[var(--navy)] disabled:opacity-50"
          >
            {busy ? t("actions.submitting") : t("actions.markReviewed")}
          </button>
        )}
        {(status === "NEW" || status === "REVIEWED") && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => setShowReject((value) => !value)}
              className="rounded-lg border border-red-200 px-4 py-2 text-sm font-semibold text-red-700 disabled:opacity-50"
            >
              {t("actions.reject")}
            </button>
            <ApproveForm
              applicationType={applicationType}
              details={details}
              childCount={childCount}
              busy={busy}
              onSubmit={async (body) => {
                const result = await post("approve", body);
                if (result?.accounts) setAccounts(result.accounts);
              }}
              onError={setError}
            />
          </>
        )}
      </div>

      {showReject && (
        <div className="mt-4 max-w-xl rounded-lg border border-red-100 bg-red-50/50 p-4">
          <label className="text-sm font-semibold text-red-900" htmlFor="rejection-reason">
            {t("rejectForm.title")}
          </label>
          <textarea
            id="rejection-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={1000}
            rows={4}
            placeholder={t("rejectForm.placeholder")}
            className="mt-2 w-full rounded-lg border border-red-200 bg-white p-3 text-sm"
          />
          <div className="mt-3 flex gap-2">
            <button type="button" disabled={busy} onClick={() => void reject()} className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {busy ? t("actions.submitting") : t("rejectForm.confirm")}
            </button>
            <button type="button" onClick={() => setShowReject(false)} className="rounded-lg border px-4 py-2 text-sm font-semibold">
              {t("rejectForm.cancel")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
