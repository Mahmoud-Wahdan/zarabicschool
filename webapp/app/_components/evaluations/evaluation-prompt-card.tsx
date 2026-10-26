import { getTranslations } from "next-intl/server";

import { Link } from "../../../i18n/navigation";
import { isEvaluationsReady } from "../../../lib/evaluations/service";
import { countEvaluationPrompts } from "../../../lib/evaluations/prompt";
import Icon from "../ui/icon";

/**
 * Post-session evaluation prompt (Phase 7, owner 2026-10-26): an in-app,
 * NON-BLOCKING card on the student/guardian dashboard after a session is COMPLETED.
 * Evaluations are OPTIONAL — the card only invites; no WhatsApp, nothing blocks.
 */
export default async function EvaluationPromptCard({ userId, academyId, role }: { userId: string; academyId: string; role: "STUDENT" | "GUARDIAN" }) {
  if (!(await isEvaluationsReady())) return null;
  const pending = await countEvaluationPrompts(userId, academyId, role);
  if (pending === 0) return null;
  const t = await getTranslations("evaluationPrompt");
  return (
    <section className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--line)] bg-white p-4">
      <p className="flex items-center gap-2 text-sm">
        <Icon name="rate_review" size={18} />
        {t("text", { count: pending })}
      </p>
      <Link href={role === "STUDENT" ? "/student/sessions" : "/guardian/reports"} className="cta-secondary rounded-lg px-3 py-1.5 text-xs">
        {t("action")}
      </Link>
    </section>
  );
}
