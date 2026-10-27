"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

type Outcome = "ATTENDED" | "STUDENT_ABSENT";
type Effect = {
  attendance: Outcome;
  deductsSession: boolean;
  releasesReservation: boolean;
  teacherCredited: false;
  sessionsLeftBefore: number;
  sessionsLeftAfter: number;
};
type Preview = { canResolve: true; effect: Effect } | { canResolve: false; blockCode: string; message: string };

/**
 * S-01 manual attendance resolution (D2, D36): choose the outcome + a reason, then a
 * confirmation step that shows the server-computed effect (attendance, package
 * effect, sessions left, teacher NOT credited) before anything is written. A blocked
 * case (e.g. no session left — owner: fix the package first) shows no confirm button.
 */
export default function AttendanceResolutionForm({ sessionId, studentId }: { sessionId: string; studentId: string }) {
  const t = useTranslations("attendanceResolution");
  const router = useRouter();
  const ids = useId();
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>("ATTENDED");
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const base = `/api/sessions/${sessionId}/students/${studentId}/attendance-resolution`;

  function blockText(code: string, fallback: string) {
    return t.has(`blocked.${code}`) ? t(`blocked.${code}`) : fallback;
  }

  async function review(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const response = await fetch(`${base}?outcome=${outcome}`);
    const payload = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) {
      setMessage(blockText(payload.error?.code ?? "", payload.error?.message ?? t("error")));
      return;
    }
    setPreview(payload.data as Preview);
  }

  async function confirm() {
    setBusy(true);
    setMessage("");
    const response = await fetch(base, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ outcome, reason, confirm: true }),
    });
    const payload = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) {
      setMessage(blockText(payload.error?.code ?? "", payload.error?.message ?? t("error")));
      setPreview(null);
      return;
    }
    setMessage(t("done"));
    router.refresh();
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="self-start rounded-lg border border-outline-variant px-3 py-1.5 text-label-md font-semibold text-primary">
        {t("open")}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-outline-variant bg-surface-container-lowest p-3">
      {preview === null ? (
        <form onSubmit={review} className="flex flex-col gap-3">
          <fieldset className="flex flex-col gap-1">
            <legend className="text-label-md font-bold text-primary">{t("title")}</legend>
            <p className="text-body-sm text-on-surface-variant">{t("hint")}</p>
            {(["ATTENDED", "STUDENT_ABSENT"] as const).map((value) => (
              <label key={value} className="flex items-center gap-2 text-body-sm">
                <input type="radio" name={`${ids}-outcome`} value={value} checked={outcome === value} onChange={() => setOutcome(value)} />
                {t(`outcome.${value}`)}
              </label>
            ))}
          </fieldset>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${ids}-reason`} className="text-label-md font-semibold text-primary">{t("reasonLabel")}</label>
            <textarea
              id={`${ids}-reason`}
              required
              minLength={5}
              maxLength={1000}
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              aria-describedby={`${ids}-reason-hint`}
              className="z-input w-full"
            />
            <p id={`${ids}-reason-hint`} className="text-label-sm text-on-surface-variant">{t("reasonHint")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button disabled={busy} className="cta-primary rounded-lg px-3 py-1.5 text-label-md disabled:opacity-50">{t("review")}</button>
            <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-outline-variant px-3 py-1.5 text-label-md">{t("cancel")}</button>
          </div>
        </form>
      ) : preview.canResolve ? (
        <div className="flex flex-col gap-2">
          <p className="text-label-md font-bold text-primary">{t("effectTitle")}</p>
          <ul className="list-disc ps-5 text-body-sm">
            <li>{t(`effect.attendance.${preview.effect.attendance}`)}</li>
            <li>{preview.effect.deductsSession ? t("effect.deducts") : preview.effect.releasesReservation ? t("effect.releases") : t("effect.noPackageChange")}</li>
            <li>{t("effect.sessionsLeft", { before: preview.effect.sessionsLeftBefore, after: preview.effect.sessionsLeftAfter })}</li>
            <li className="font-semibold">{t("effect.teacherNotCredited")}</li>
            <li>{t("effect.reportStillAccepted")}</li>
          </ul>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => void confirm()} className="cta-primary rounded-lg px-3 py-1.5 text-label-md disabled:opacity-50">{t("confirm")}</button>
            <button type="button" onClick={() => setPreview(null)} className="rounded-lg border border-outline-variant px-3 py-1.5 text-label-md">{t("back")}</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-body-sm font-semibold text-error">{blockText(preview.blockCode, preview.message)}</p>
          <button type="button" onClick={() => setPreview(null)} className="self-start rounded-lg border border-outline-variant px-3 py-1.5 text-label-md">{t("back")}</button>
        </div>
      )}
      <p aria-live="polite" className="text-body-sm text-on-surface-variant">{message}</p>
    </div>
  );
}
