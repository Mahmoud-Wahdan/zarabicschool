import { getTranslations } from "next-intl/server";

import DashboardShell from "../../../_components/dashboard-shell";
import { requireRoles } from "../../../../lib/dal";
import { prisma } from "../../../../lib/prisma";
import { Link, Link as LocaleLink } from "../../../../i18n/navigation";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "adminApplications" });
  return { title: `${t("title")} | Zarabicschool` };
}

const validStatuses = ["NEW", "REVIEWED", "APPROVED", "REJECTED"] as const;
type StatusValue = (typeof validStatuses)[number];
const validTypes = ["GUARDIAN", "STUDENT", "TEACHER"] as const;
type TypeValue = (typeof validTypes)[number];

const pageSize = 20;

type ApplicationListItem = {
  id: string;
  applicationType: TypeValue;
  fullName: string;
  status: string;
  createdAt: Date;
  reviewedAt: Date | null;
};

const statusBadgeClasses: Record<string, string> = {
  NEW: "bg-[var(--gold)]/15 text-[var(--navy)]",
  REVIEWED: "bg-sky-100 text-sky-800",
  APPROVED: "bg-emerald-100 text-emerald-800",
  REJECTED: "bg-red-100 text-red-800",
};

export default async function AdminApplicationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string; type?: string; page?: string }>;
}) {
  const user = await requireRoles(["ADMIN", "SUPERVISOR"]);
  const { locale } = await params;
  const { status: statusParam, type: typeParam, page: pageParam } = await searchParams;
  const t = await getTranslations({ locale, namespace: "adminApplications" });

  const status: StatusValue | undefined = validStatuses.includes(statusParam as StatusValue)
    ? (statusParam as StatusValue)
    : undefined;
  const type: TypeValue | undefined = validTypes.includes(typeParam as TypeValue)
    ? (typeParam as TypeValue)
    : undefined;
  const pageNum = Number(pageParam || "1");
  const page = Number.isFinite(pageNum) && pageNum >= 1 ? Math.floor(pageNum) : 1;

  let applications: ApplicationListItem[] = [];
  let total = 0;
  let loadFailed = false;
  try {
    const where = {
      academyId: user.academyId,
      ...(status ? { status: status as never } : {}),
      ...(type ? { applicationType: type as never } : {}),
    };
    const [rows, count] = await Promise.all([
      prisma.application.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          applicationType: true,
          status: true,
          createdAt: true,
          reviewedAt: true,
          details: true,
        },
      }),
      prisma.application.count({ where }),
    ]);
    total = count;
    applications = rows.map((row) => {
      const details = row.details as { full_name?: string } | null;
      return {
        id: row.id,
        applicationType: row.applicationType as TypeValue,
        fullName: details?.full_name ?? "",
        status: String(row.status),
        createdAt: row.createdAt,
        reviewedAt: row.reviewedAt,
      };
    });
  } catch {
    loadFailed = true;
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function filterHref(next: { status?: string | null; type?: string | null }) {
    const search = new URLSearchParams();
    const nextStatus = "status" in next ? next.status : status;
    const nextType = "type" in next ? next.type : type;
    if (nextStatus) search.set("status", nextStatus);
    if (nextType) search.set("type", nextType);
    const query = search.toString();
    return `/admin/applications${query ? `?${query}` : ""}`;
  }

  function pageHref(nextPage: number) {
    const search = new URLSearchParams();
    if (status) search.set("status", status);
    if (type) search.set("type", type);
    if (nextPage > 1) search.set("page", String(nextPage));
    const query = search.toString();
    return `/admin/applications${query ? `?${query}` : ""}`;
  }

  const formatDate = (value: Date) =>
    new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(value);

  return (
    <DashboardShell role={user.role} userName={user.displayName}>
      <h1 className="text-xl font-bold text-[var(--navy)]">{t("title")}</h1>
      <p className="mt-1 text-sm text-[var(--foreground)] opacity-70">{t("subtitle")}</p>

      {loadFailed ? (
        <div
          role="alert"
          className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
        >
          {t("states.loadFailed")}
        </div>
      ) : (
        <>
          <div className="mt-6 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-[var(--foreground)] opacity-60">
                {t("filters.status")}:
              </span>
              {([undefined, ...validStatuses] as (StatusValue | undefined)[]).map((value) => (
                <LocaleLink
                  key={value ?? "all"}
                  href={filterHref({ status: value })}
                  aria-current={status === value ? "true" : undefined}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                    status === value
                      ? "border-[var(--navy)] bg-[var(--navy)] text-white"
                      : "border-[var(--line)] bg-white text-[var(--foreground)] hover:border-[var(--navy)]"
                  }`}
                >
                  {value ? t(`status.${value}`) : t("filters.all")}
                </LocaleLink>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-[var(--foreground)] opacity-60">
                {t("filters.type")}:
              </span>
              {([undefined, ...validTypes] as (TypeValue | undefined)[]).map((value) => (
                <LocaleLink
                  key={value ?? "all"}
                  href={filterHref({ type: value })}
                  aria-current={type === value ? "true" : undefined}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                    type === value
                      ? "border-[var(--navy)] bg-[var(--navy)] text-white"
                      : "border-[var(--line)] bg-white text-[var(--foreground)] hover:border-[var(--navy)]"
                  }`}
                >
                  {value ? t(`type.${value}`) : t("filters.all")}
                </LocaleLink>
              ))}
            </div>
          </div>

          {applications.length === 0 ? (
            <div className="mt-6 rounded-xl border border-[var(--line)] bg-white p-8 text-center text-sm text-[var(--foreground)] opacity-70">
              {t("states.empty")}
            </div>
          ) : (
            <>
              <div className="mt-6 hidden overflow-hidden rounded-xl border border-[var(--line)] bg-white md:block">
                <table className="w-full text-start text-sm">
                  <thead className="border-b border-[var(--line)] bg-[var(--background)] text-start">
                    <tr>
                      <th scope="col" className="px-4 py-3 text-start font-semibold text-[var(--navy)]">
                        {t("table.name")}
                      </th>
                      <th scope="col" className="px-4 py-3 text-start font-semibold text-[var(--navy)]">
                        {t("table.type")}
                      </th>
                      <th scope="col" className="px-4 py-3 text-start font-semibold text-[var(--navy)]">
                        {t("table.status")}
                      </th>
                      <th scope="col" className="px-4 py-3 text-start font-semibold text-[var(--navy)]">
                        {t("table.date")}
                      </th>
                      <th scope="col" className="px-4 py-3 text-start font-semibold text-[var(--navy)]">
                        <span className="sr-only">{t("table.actions")}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {applications.map((application) => (
                      <tr key={application.id} className="border-b border-[var(--line)] last:border-b-0">
                        <td className="px-4 py-3 font-medium text-[var(--navy)]">{application.fullName}</td>
                        <td className="px-4 py-3">{t(`type.${application.applicationType}`)}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusBadgeClasses[application.status] ?? "bg-[var(--background)]"}`}
                          >
                            {t(`status.${application.status}`)}
                          </span>
                        </td>
                        <td className="px-4 py-3 opacity-70">{formatDate(application.createdAt)}</td>
                        <td className="px-4 py-3 text-end">
                          <LocaleLink 
                            href={`/admin/applications/${application.id}`}
                            className="font-semibold text-[var(--emerald)] hover:underline"
                          >
                            {t("table.view")}
                          </LocaleLink>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <ul className="mt-6 space-y-3 md:hidden">
                {applications.map((application) => (
                  <li
                    key={application.id}
                    className="rounded-xl border border-[var(--line)] bg-white p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-[var(--navy)]">{application.fullName}</p>
                        <p className="mt-1 text-xs text-[var(--foreground)] opacity-70">
                          {t(`type.${application.applicationType}`)}
                        </p>
                        <p className="mt-1 text-xs text-[var(--foreground)] opacity-60">
                          {formatDate(application.createdAt)}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${statusBadgeClasses[application.status] ?? "bg-[var(--background)]"}`}
                      >
                        {t(`status.${application.status}`)}
                      </span>
                    </div>
                    <div className="mt-3 text-end">
                      <Link
                        href={`/admin/applications/${application.id}`}
                        className="text-sm font-semibold text-[var(--emerald)] hover:underline"
                      >
                        {t("table.view")}
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>

              <nav
                aria-label={t("pagination.pageInfo", { page, totalPages })}
                className="mt-6 flex items-center justify-between gap-3"
              >
                {page > 1 ? (
                  <Link
                    href={pageHref(page - 1)}
                    className="rounded-lg border border-[var(--line)] bg-white px-4 py-2 text-sm font-semibold text-[var(--navy)] hover:border-[var(--navy)]"
                  >
                    {t("pagination.previous")}
                  </Link>
                ) : (
                  <span />
                )}
                <span className="text-xs text-[var(--foreground)] opacity-70">
                  {t("pagination.pageInfo", { page, totalPages })}
                </span>
                {page < totalPages ? (
                  <Link
                    href={pageHref(page + 1)}
                    className="rounded-lg border border-[var(--line)] bg-white px-4 py-2 text-sm font-semibold text-[var(--navy)] hover:border-[var(--navy)]"
                  >
                    {t("pagination.next")}
                  </Link>
                ) : (
                  <span />
                )}
              </nav>
            </>
          )}
        </>
      )}
    </DashboardShell>
  );
}
