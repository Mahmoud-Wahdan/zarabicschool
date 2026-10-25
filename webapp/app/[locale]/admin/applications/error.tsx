"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";

export default function AdminApplicationsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const common = useTranslations("common");

  useEffect(() => {
    // The error digest identifies the failure server-side; no PII is logged here.
    console.error("admin applications segment error", error.digest ?? "");
  }, [error]);

  return (
    <div role="alert" className="mx-auto max-w-md rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
      <h1 className="text-lg font-bold text-red-900">{common("errorTitle")}</h1>
      <p className="mt-2 text-sm text-red-800">{common("errorBody")}</p>
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
