"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";

const EVALUATION_ERROR_CODES = new Set([
  "EVALUATIONS_MIGRATION_PENDING",
  "SESSION_NOT_EVALUABLE",
  "EVALUATION_LOCKED",
  "EVALUATION_CONFLICT",
  "NOT_FOUND",
  "VALIDATION_ERROR",
]);

export type EvaluationCardProps = {
  sessionId: string;
  initialRating: number | null;
  initialComment: string | null;
  locked: boolean;
};

/**
 * Session evaluation form for the STUDENT and the GUARDIAN (Session 3, Slice B —
 * owner decision 2026-10-24; Stitch `zarabicschool_17` tokens). Rating 1..5 +
 * optional comment; one per (session, author); editable for 24h, then the server
 * rejects further edits (EVALUATION_LOCKED) and the card renders read-only.
 * Submissions go to POST /api/sessions/[id]/evaluations — same-origin.
 */
export default function EvaluationCard({ sessionId, initialRating, initialComment, locked }: EvaluationCardProps) {
  const tEval = useTranslations("evaluation");
  const locale = useLocale();
  const [rating, setRating] = useState<number | null>(initialRating);
  const [comment, setComment] = useState(initialComment ?? "");
  const [busy, setBusy] = useState(false);
  const [isLocked, setIsLocked] = useState(locked);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit() {
    setMessage("");
    setError("");
    if (rating === null) {
      setError(tEval("ratingRequired"));
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`/api/sessions/${sessionId}/evaluations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rating, comment }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        if (payload?.error?.code === "EVALUATION_LOCKED") {
          setIsLocked(true);
        }
        const code = payload?.error?.code;
        setError(typeof code === "string" && EVALUATION_ERROR_CODES.has(code) ? tEval(`errors.${code}`) : tEval("submitFailed"));
        return;
      }
      setRating(payload.data.rating as number);
      setComment(payload.data.comment ?? "");
      setMessage(tEval("submitted"));
    } catch {
      setError(tEval("submitFailed"));
    } finally {
      setBusy(false);
    }
  }

  if (isLocked) {
    return (
      <section className="z-card flex flex-col gap-2 rounded-xl p-4">
        <h2 className="text-title-md font-bold text-primary">{tEval("title")}</h2>
        {rating !== null ? (
          <p className="text-body-sm text-on-surface">
            {tEval("yourRating")}: <span aria-hidden="true">{"★".repeat(rating)}{"☆".repeat(5 - rating)}</span>
            <span className="sr-only">{tEval("ratingValue", { rating })}</span>
          </p>
        ) : null}
        {comment ? <p className="text-body-sm text-on-surface-variant">{comment}</p> : null}
        <p className="text-label-sm text-on-surface-variant">{tEval("locked")}</p>
      </section>
    );
  }

  return (
    <section className="z-card flex flex-col gap-3 rounded-xl p-4">
      <div>
        <h2 className="text-title-md font-bold text-primary">{tEval("title")}</h2>
        <p className="text-body-sm text-on-surface-variant">{tEval("hint")}</p>
      </div>
      <fieldset className="flex flex-wrap gap-1.5" aria-label={tEval("ratingLabel")}>
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setRating(value)}
            aria-pressed={rating === value}
            aria-label={tEval("ratingValue", { rating: value })}
            className={`h-10 w-10 rounded-full text-body-md font-semibold transition-colors ${
              rating !== null && value <= rating
                ? "bg-tertiary-container text-on-tertiary-container"
                : "bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest"
            }`}
          >
            {value}
          </button>
        ))}
      </fieldset>
      <label className="flex flex-col gap-1 text-label-sm text-on-surface-variant">
        {tEval("commentLabel")}
        <textarea
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          maxLength={2000}
          rows={3}
          dir={locale === "ar" ? "rtl" : "ltr"}
          className="z-input w-full"
        />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => void submit()} disabled={busy} className="btn btn-primary self-start">
          {busy ? tEval("saving") : tEval(initialRating === null ? "submit" : "update")}
        </button>
        <span className="text-label-sm text-on-surface-variant">{tEval("editableFor24h")}</span>
      </div>
      {message ? <p role="status" className="text-body-sm text-secondary">{message}</p> : null}
      {error ? <p role="alert" className="text-body-sm text-error">{error}</p> : null}
    </section>
  );
}
