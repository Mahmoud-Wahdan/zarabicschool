import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import DashboardShell from "../../../../_components/dashboard-shell";
import { requireRole } from "../../../../../lib/dal";
import { prisma } from "../../../../../lib/prisma";
import { Link } from "../../../../../i18n/navigation";
import ReviewActions from "./review-actions";

type Details = Record<string, unknown>;

function asDetails(value: unknown): Details {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Details) : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function list(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export default async function AdminApplicationDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const user = await requireRole("ADMIN");
  const { locale, id } = await params;
  const t = await getTranslations({ locale, namespace: "adminApplications" });
  const application = await prisma.application.findFirst({
    where: { id, academyId: user.academyId },
    select: {
      id: true,
      applicationType: true,
      status: true,
      details: true,
      contactPhone: true,
      contactEmail: true,
      createdAt: true,
      reviewedAt: true,
      approvedAt: true,
      rejectionReason: true,
    },
  });

  if (!application) notFound();

  const details = asDetails(application.details);
  const children = Array.isArray(details.children)
    ? details.children.filter(
        (child): child is { name?: unknown; age?: unknown; subjects?: unknown } =>
          Boolean(child) && typeof child === "object"
      )
    : [];
  const formatDate = (value: Date) =>
    new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(value);
  const label = (key: string) => t(`detail.${key}`);
  const type = application.applicationType as "GUARDIAN" | "STUDENT" | "TEACHER";

  return (
    <DashboardShell role={user.role} userName={user.displayName}>
      <Link href="/admin/applications" className="text-sm font-semibold text-[var(--emerald)] hover:underline">
        ← {label("back")}
      </Link>
      <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[var(--navy)]">
            {text(details.full_name) ?? label("notFound")}
          </h1>
          <p className="mt-1 text-sm opacity-70">
            {t(`type.${type}`)} · {t(`status.${application.status}`)}
          </p>
        </div>
        <span className="rounded-full bg-[var(--navy)]/10 px-3 py-1 text-xs font-semibold">
          {t(`status.${application.status}`)}
        </span>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-[var(--line)] bg-white p-5">
          <h2 className="font-semibold text-[var(--navy)]">{label("contactSection")}</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <DetailRow label={label("phone")} value={application.contactPhone} />
            <DetailRow label={label("email")} value={application.contactEmail} />
            <DetailRow label={label("timezone")} value={text(details.timezone)} />
            <DetailRow label={label("preferredLanguage")} value={text(details.preferred_language)} />
            <DetailRow label={label("preferredTimes")} value={text(details.preferred_times)} />
            <DetailRow label={label("availableTimes")} value={text(details.available_times)} />
            <DetailRow label={label("dateOfBirth")} value={text(details.date_of_birth)} />
            <DetailRow label={label("level")} value={text(details.level)} />
            <DetailRow label={label("yearsExperience")} value={details.years_experience != null ? String(details.years_experience) : null} />
          </dl>
          <OptionalText label={label("qualifications")} value={text(details.qualifications)} />
          <OptionalText label={label("notes")} value={text(details.notes)} />
        </section>

        <section className="rounded-xl border border-[var(--line)] bg-white p-5">
          <h2 className="font-semibold text-[var(--navy)]">{label("subjects")}</h2>
          <TagList values={list(details.subjects)} empty="—" />
          {type === "GUARDIAN" && (
            <>
              <h2 className="mt-6 font-semibold text-[var(--navy)]">{label("children")}</h2>
              <ul className="mt-3 space-y-3">
                {children.map((child, index) => (
                  <li key={`${String(child.name)}-${index}`} className="rounded-lg bg-[var(--background)] p-3 text-sm">
                    <p className="font-semibold">{text(child.name) ?? `#${index + 1}`}</p>
                    {child.age != null && <p className="mt-1 opacity-70">{t("detail.childAge", { age: String(child.age) })}</p>}
                    <TagList values={list(child.subjects)} empty="—" />
                  </li>
                ))}
              </ul>
            </>
          )}
          {type === "STUDENT" && (
            <>
              <h2 className="mt-6 font-semibold text-[var(--navy)]">{label("guardianSection")}</h2>
              <dl className="mt-3 space-y-3 text-sm">
                <DetailRow label={label("guardianName")} value={text(details.guardian_name)} />
                <DetailRow label={label("guardianPhone")} value={text(details.guardian_phone)} />
                <DetailRow label={label("guardianRelationship")} value={text(details.guardian_relationship)} />
              </dl>
            </>
          )}
        </section>
      </div>

      <section className="mt-4 rounded-xl border border-[var(--line)] bg-white p-5">
        <h2 className="font-semibold text-[var(--navy)]">{label("reviewSection")}</h2>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <DetailRow label={label("reviewedAt")} value={application.reviewedAt ? formatDate(application.reviewedAt) : null} />
          <DetailRow label={label("approvedAt")} value={application.approvedAt ? formatDate(application.approvedAt) : null} />
          <DetailRow label={label("rejectionReason")} value={application.rejectionReason} />
          <DetailRow label={label("submittedAt")} value={formatDate(application.createdAt)} />
        </dl>
      </section>

      <ReviewActions
        applicationId={application.id}
        applicationType={type}
        status={application.status}
        details={details}
        childCount={children.length}
      />
    </DashboardShell>
  );
}

function DetailRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs font-semibold opacity-60">{label}</dt>
      <dd className="mt-1 break-words">{value ?? "—"}</dd>
    </div>
  );
}

function OptionalText({ label, value }: { label: string; value: string | null }) {
  return value ? (
    <div className="mt-4 border-t border-[var(--line)] pt-4 text-sm">
      <p className="text-xs font-semibold opacity-60">{label}</p>
      <p className="mt-1 whitespace-pre-wrap">{value}</p>
    </div>
  ) : null;
}

function TagList({ values, empty }: { values: string[]; empty: string }) {
  return values.length ? (
    <ul className="mt-3 flex flex-wrap gap-2">
      {values.map((value) => (
        <li key={value} className="rounded-full bg-[var(--emerald)]/10 px-2.5 py-1 text-xs">
          {value}
        </li>
      ))}
    </ul>
  ) : (
    <p className="mt-3 text-sm opacity-60">{empty}</p>
  );
}
