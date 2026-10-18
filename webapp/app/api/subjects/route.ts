import { NextResponse } from "next/server";

import { prisma } from "../../../lib/prisma";
import { requireApiRoles } from "../../../lib/dal";
import { subjectCreateSchema } from "../../../lib/validation/management";

export const runtime = "nodejs";

export async function GET() {
  const subjects = await prisma.subject.findMany({
    where: { isActive: true },
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
