import EvaluationCard from "./evaluation-card";

/**
 * Collapsed "Evaluate the session" entry for list cards (student sessions/reports,
 * guardian reports). Callers render it only for an ENDED session the viewer was on
 * the roster for; the evaluations API re-checks both rules server-side.
 */
export default function EvaluateSessionDetails({
  sessionId,
  label,
  evaluation,
}: {
  sessionId: string;
  label: string;
  evaluation: { rating: number; comment: string | null; locked: boolean } | null;
}) {
  return (
    <details className="mt-2 border-t border-[var(--line)] pt-2">
      <summary className="cursor-pointer text-sm font-semibold text-[var(--navy)]">{label}</summary>
      <div className="mt-3">
        <EvaluationCard
          sessionId={sessionId}
          initialRating={evaluation?.rating ?? null}
          initialComment={evaluation?.comment ?? null}
          locked={evaluation?.locked ?? false}
        />
      </div>
    </details>
  );
}
