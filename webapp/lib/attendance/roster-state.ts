/**
 * Per-student session state for staff views, DERIVED from time + reports (+ a manual
 * resolution) — no stored status (S-01, D36d). The report-driven state machine is
 * untouched: a manual resolution is not a report, so the session keeps "awaiting
 * reports" and the teacher's late-report reminders continue.
 */
export type RosterState =
  | "CANCELLED"
  | "NOT_ENDED"
  | "ENDED_REPORT_PENDING"
  | "RESOLVED_REPORT_PENDING"
  | "REPORT_SUBMITTED"
  | "REPORT_REJECTED"
  | "REPORT_APPROVED";

export function deriveRosterState(input: {
  sessionStatus: string;
  scheduledEnd: Date;
  now: Date;
  reportStatus: string | null;
  resolutionOutcome: string | null;
}): RosterState {
  if (input.sessionStatus === "CANCELLED" || input.sessionStatus === "MISSED") return "CANCELLED";
  if (input.reportStatus === "APPROVED" || input.reportStatus === "ARCHIVED") return "REPORT_APPROVED";
  if (input.reportStatus === "SUBMITTED") return "REPORT_SUBMITTED";
  if (input.reportStatus === "REJECTED") return "REPORT_REJECTED";
  if (input.now < input.scheduledEnd) return "NOT_ENDED";
  return input.resolutionOutcome ? "RESOLVED_REPORT_PENDING" : "ENDED_REPORT_PENDING";
}
