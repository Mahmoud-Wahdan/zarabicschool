import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { ExternalLink } from "lucide-react";
import DashboardShell from "../../../../_components/dashboard-shell";
import { requireRoles } from "../../../../../lib/dal";
import { prisma } from "../../../../../lib/prisma";
import { Link } from "../../../../../i18n/navigation";
import ReviewActions from "./review-actions";
import ApplicationAudioPlayer from "./audio-player";

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
  const user = await requireRoles(["ADMIN"]);
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
      introVideoUrl: true,
      recitationAudioPath: true,
      recitationAudioFormat: true,
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
  const type = application.applicationType as "GUARDIAN" | "STUDENT" | "TEACHER";

  // Eligible teachers per subject entry (slug or id) for the optional approval-time assignment.
  const subjectTeachersByEntry: Record<string, { teacherId: string; displayName: string }[]> = {};
  if (type === "GUARDIAN" || type === "STUDENT") {
    const entries = type === "STUDENT"
      ? list(details.subjects)
      : [...new Set(children.flatMap((child) => list(child.subjects)))];
    if (entries.length > 0) {
      const subjects = await prisma.subject.findMany({
        where: { academyId: user.academyId, isActive: true },
        select: { id: true, slug: true },
      });
      const entryToSubjectId = new Map<string, string>();
      for (const entry of entries) {
        const match = subjects.find((subject) => subject.slug === entry || subject.id === entry);
        if (match) entryToSubjectId.set(entry, match.id);
      }
      const subjectIds = [...new Set(entryToSubjectId.values())];
      if (subjectIds.length > 0) {
        const teacherSubjects = await prisma.teacherSubject.findMany({
          where: { academyId: user.academyId, subjectId: { in: subjectIds } },
          select: {
            subjectId: true,
            teacher: { select: { id: true, user: { select: { displayName: true, isActive: true } } } },
          },
        });
        const subjectIdToEntry = new Map([...entryToSubjectId.entries()].map(([entry, subjectId]) => [subjectId, entry]));
        for (const row of teacherSubjects) {
          if (!row.teacher.user.isActive) continue;
          const entry = subjectIdToEntry.get(row.subjectId);
          if (!entry) continue;
          (subjectTeachersByEntry[entry] ??= []).push({
            teacherId: row.teacher.id,
            displayName: row.teacher.user.displayName,
          });
        }
      }
    }
  }

  const formatDate = (value: Date) =>
    new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { timeZone: user.timezone,
      dateStyle: "medium",
      timeStyle: "short",
    }).format(value);
  const label = (key: string) => t(`detail.${key}`);

  return (
    <DashboardShell role={user.role} userName={user.displayName}>
      <Link href="/admin/applications" className="text-sm font-semibold text-secondary hover:underline">
        ← {label("back")}
      </Link>
      <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-headline-md font-bold text-primary">
            {text(details.full_name) ?? label("notFound")}
          </h1>
          <p className="mt-1 text-body-sm text-on-surface-variant">
            {t(`type.${type}`)} · {t(`status.${application.status}`)}
          </p>
        </div>
        <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold">
          {t(`status.${application.status}`)}
        </span>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <section className="z-card rounded-xl p-5">
          <h2 className="font-semibold text-primary">{label("contactSection")}</h2>
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

        <section className="z-card rounded-xl p-5">
          <h2 className="font-semibold text-primary">{label("subjects")}</h2>
          <TagList values={list(details.subjects)} empty="—" />
          {type === "GUARDIAN" && (
            <>
              <h2 className="mt-6 font-semibold text-primary">{label("children")}</h2>
              <ul className="mt-3 space-y-3">
                {children.map((child, index) => (
                  <li key={`${String(child.name)}-${index}`} className="rounded-lg bg-surface p-3 text-sm">
                    <p className="font-semibold">{text(child.name) ?? `#${index + 1}`}</p>
                    {child.age != null && <p className="mt-1 text-on-surface-variant">{t("detail.childAge", { age: String(child.age) })}</p>}
                    <TagList values={list(child.subjects)} empty="—" />
                  </li>
                ))}
              </ul>
            </>
          )}
          {type === "STUDENT" && (
            <>
              <h2 className="mt-6 font-semibold text-primary">{label("guardianSection")}</h2>
              <dl className="mt-3 space-y-3 text-sm">
                <DetailRow label={label("guardianName")} value={text(details.guardian_name)} />
                <DetailRow label={label("guardianPhone")} value={text(details.guardian_phone)} />
                <DetailRow label={label("guardianRelationship")} value={text(details.guardian_relationship)} />
              </dl>
            </>
          )}
        </section>
      </div>

      {type === "TEACHER" && (
        <section className="mt-4 z-card rounded-xl p-5">
          <h2 className="font-semibold text-primary">{label("teacherMediaSection")}</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <dt className="text-xs font-semibold text-on-surface-variant">{label("introVideo")}</dt>
              <dd className="mt-2">
                {application.introVideoUrl || text(details.intro_video_url) ? (
                  <a
                    href={(application.introVideoUrl || text(details.intro_video_url))!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary/10"
                  >
                    <ExternalLink className="h-4 w-4 shrink-0 text-secondary" />
                    <span className="break-all">{label("openVideoLink")}</span>
                  </a>
                ) : (
                  <span className="text-sm text-on-surface-variant">—</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="mb-2 text-xs font-semibold text-on-surface-variant">{label("recitationAudio")}</dt>
              <dd>
                {application.recitationAudioPath ? (
                  <ApplicationAudioPlayer
                    applicationId={application.id}
                    format={application.recitationAudioFormat}
                  />
                ) : (
                  <span className="text-sm text-on-surface-variant">{label("noAudio")}</span>
                )}
              </dd>
            </div>
          </div>
        </section>
      )}

      <section className="mt-4 z-card rounded-xl p-5">
        <h2 className="font-semibold text-primary">{label("reviewSection")}</h2>
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
        subjectTeachersByEntry={subjectTeachersByEntry}
      />
    </DashboardShell>
  );
}

function DetailRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs font-semibold text-on-surface-variant">{label}</dt>
      <dd className="mt-1 break-words">{value ?? "—"}</dd>
    </div>
  );
}

function OptionalText({ label, value }: { label: string; value: string | null }) {
  return value ? (
    <div className="mt-4 border-t border-outline-variant pt-4 text-sm">
      <p className="text-xs font-semibold text-on-surface-variant">{label}</p>
      <p className="mt-1 whitespace-pre-wrap">{value}</p>
    </div>
  ) : null;
}

function TagList({ values, empty }: { values: string[]; empty: string }) {
  return values.length ? (
    <ul className="mt-3 flex flex-wrap gap-2">
      {values.map((value) => (
        <li key={value} className="rounded-full bg-secondary/10 px-2.5 py-1 text-xs">
          {value}
        </li>
      ))}
    </ul>
  ) : (
    <p className="mt-3 text-body-sm text-on-surface-variant">{empty}</p>
  );
}
