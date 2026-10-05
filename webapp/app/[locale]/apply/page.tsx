import { getLocale } from "next-intl/server";

import { prisma } from "../../../lib/prisma";
import ApplyRoles from "../../_components/landing/apply-roles";
import ApplyForm from "./apply-form";

const validRoles = ["guardian", "student", "teacher"] as const;
type ValidRole = (typeof validRoles)[number];

export default async function ApplyPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const { type } = await searchParams;
  const locale = await getLocale();

  const role: ValidRole | undefined =
    typeof type === "string" && validRoles.includes(type as ValidRole)
      ? (type as ValidRole)
      : undefined;

  if (!role) {
    return (
      <div className="py-6 sm:py-12">
        <ApplyRoles />
      </div>
    );
  }

  let subjects: {
    id: string;
    slug: string;
    nameAr: string;
    nameEn: string;
  }[] = [];

  try {
    subjects = await prisma.subject.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      select: {
        id: true,
        slug: true,
        nameAr: true,
        nameEn: true,
      },
    });
  } catch {
    subjects = [];
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
      <ApplyForm type={role} subjects={subjects} locale={locale} />
    </div>
  );
}
