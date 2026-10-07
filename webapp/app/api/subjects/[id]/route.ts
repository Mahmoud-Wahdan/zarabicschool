import { NextResponse } from "next/server";

import { requireApiRole } from "../../../../lib/dal";
import { prisma } from "../../../../lib/prisma";
import { subjectUpdateSchema } from "../../../../lib/validation/management";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireApiRole("ADMIN");
  if (error) return error;
  const { id } = await params;
  const parsed = subjectUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid subject data.", fields: parsed.error.flatten().fieldErrors } }, { status: 400 });
  }
  const existing = await prisma.subject.findFirst({ where: { id, academyId: user.academyId }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Subject not found." } }, { status: 404 });
  try {
    const subject = await prisma.subject.update({
      where: { id },
      data: {
        ...parsed.data,
        descriptionAr: parsed.data.descriptionAr === undefined ? undefined : parsed.data.descriptionAr || null,
        descriptionEn: parsed.data.descriptionEn === undefined ? undefined : parsed.data.descriptionEn || null,
        icon: parsed.data.icon === undefined ? undefined : parsed.data.icon || null,
      },
    });
    return NextResponse.json({ data: subject });
  } catch (cause) {
    if (cause && typeof cause === "object" && "code" in cause && cause.code === "P2002") {
      return NextResponse.json({ error: { code: "CONFLICT", message: "This subject slug already exists." } }, { status: 409 });
    }
    throw cause;
  }
}
