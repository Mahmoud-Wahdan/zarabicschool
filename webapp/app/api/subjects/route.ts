import { NextResponse } from "next/server";

import { prisma } from "../../../lib/prisma";

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
