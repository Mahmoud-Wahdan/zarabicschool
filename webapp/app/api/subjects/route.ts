import { NextResponse } from "next/server";

import { prisma } from "../../../lib/prisma";
import { getAuthSession, requireApiRoles } from "../../../lib/dal";
import { subjectCreateSchema } from "../../../lib/validation/management";
import { requireSameOrigin } from "../../../lib/request";

export const runtime = "nodejs";

/** The academy the public application form belongs to (same as POST /api/applications). */
const PUBLIC_APPLICATION_ACADEMY = "Zarabicschool";

/**
 * Active subjects of ONE academy (tenancy fix, Phase 8 OWASP A01, 2026-10-26): a
 * signed-in user gets their own academy's subjects; the anonymous public application
 * form gets the academy it posts to (the application route accepts only that
 * academy's subjects). Before, every academy's subjects were listed to everyone.
 */
export async function GET() {
  const user = await getAuthSession();
  const academyId = user
    ? user.academyId
    : (await prisma.academy.findUnique({ where: { name: PUBLIC_APPLICATION_ACADEMY }, select: { id: true } }))?.id;
  if (!academyId) return NextResponse.json([]);
  const subjects = await prisma.subject.findMany({
    where: { isActive: true, academyId },
    select: {
      id: true,
      slug: true,
      nameAr: true,
      nameEn: true,
      descriptionAr: true,
      descriptionEn: true,
      icon: true,
      sortOrder: true,
    },
    orderBy: { sortOrder: "asc" },
  });

  return NextResponse.json(subjects);
}

export async function POST(request: Request) {
  const crossOrigin = requireSameOrigin(request);
  if (crossOrigin) return crossOrigin;
  // CONTEXT §4: subjects are an operational surface — Admin AND Supervisor.
  const { user, error } = await requireApiRoles(["ADMIN", "SUPERVISOR"]);
  if (error) return error;
  const parsed = subjectCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid subject data.", fields: parsed.error.flatten().fieldErrors } }, { status: 400 });
  }
  try {
    const subject = await prisma.subject.create({
      data: {
        academyId: user.academyId,
        ...parsed.data,
        descriptionAr: parsed.data.descriptionAr || null,
        descriptionEn: parsed.data.descriptionEn || null,
        icon: parsed.data.icon || null,
      },
    });
    return NextResponse.json({ data: subject }, { status: 201 });
  } catch (cause) {
    if (cause && typeof cause === "object" && "code" in cause && cause.code === "P2002") {
      return NextResponse.json({ error: { code: "CONFLICT", message: "This subject slug already exists." } }, { status: 409 });
    }
    throw cause;
  }
}
