import { getLocale, getTranslations } from "next-intl/server";

import { getAuthSession } from "../../../lib/dal";

export async function generateMetadata() {
  const t = await getTranslations("joinStatus");
  return { title: `${t("title")} | Zarabicschool` };
}

const KNOWN_REASONS = new Set([
  "JOIN_NOT_YET_OPEN",
  "JOIN_WINDOW_CLOSED",
  "NOT_FOUND",
  "RATE_LIMITED",
  "NO_HOST_LINK",
  "INVALID_ZOOM_URL",
]);

/**
 * Readable answer for a join link opened in a browser (I-1, owner 2026-10-27). The
 * join redirect sends browsers here with a reason CODE only — never a link, a
 * session id or a name. Unknown codes show a generic line.
 */
export default async function JoinStatusPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string | string[] }>;
}) {
  const [{ reason }, user, t, locale] = await Promise.all([
    searchParams,
    getAuthSession(),
    getTranslations("joinStatus"),
    getLocale(),
  ]);
  const code = typeof reason === "string" && KNOWN_REASONS.has(reason) ? reason : "UNKNOWN";

  return (
    <main className="flex min-h-screen flex-1 flex-col items-center justify-center bg-surface p-4 md:p-6">
      <div className="w-full max-w-lg rounded-xl bg-surface-container-lowest p-8 shadow-md">
        <h1 className="text-headline-sm font-bold text-primary">{t("title")}</h1>
        <p className="mt-6 text-body-md text-on-surface-variant">{t(`reason.${code}`)}</p>
        <a
          href={user ? `/${locale}/${user.role.toLowerCase()}` : `/${locale}/login`}
          className="mt-8 inline-block font-bold text-primary underline-offset-4 hover:underline"
        >
          {user ? t("toDashboard") : t("toLogin")}
        </a>
      </div>
    </main>
  );
}
