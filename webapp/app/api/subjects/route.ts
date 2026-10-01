import { NextResponse } from "next/server";

import { prisma } from "../../../lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  const subjects = await prisma.subject.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return NextResponse.json(subjects);
}
