"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";

export default function TeacherSessionsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("sessions");
  const common = useTranslations("common");

  useEffect(() => {
    // The error digest identifies the failure server-side; no session data is logged here.
    console.error("teacher sessions segment error", error.digest ?? "");
  }, [error]);

  return (
    <div role="alert" className="mx-auto max-w-md rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
      <h1 className="text-lg font-bold text-red-900">{t("error")}</h1>
      <button
        type="button"
        onClick={reset}
        className="mt-4 rounded-lg bg-[var(--emerald)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
      >
        {common("retry")}
      </button>
    </div>
  );
}
