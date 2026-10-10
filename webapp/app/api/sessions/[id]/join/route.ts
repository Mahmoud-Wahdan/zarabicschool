import { NextResponse } from "next/server";

import { requireApiRoles } from "../../../../../lib/dal";
import { prisma } from "../../../../../lib/prisma";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireApiRoles(["ADMIN", "SUPERVISOR", "TEACHER", "STUDENT", "GUARDIAN"]);
  if (error) return error;
  const { id } = await params;
  const session = await prisma.session.findFirst({
    where: {
      id,
      academyId: user.academyId,
      status: "SCHEDULED",
      OR: [
        ...(user.role === "ADMIN" || user.role === "SUPERVISOR" ? [{}] : []),
        ...(user.role === "TEACHER" ? [{ teacher: { userId: user.id } }] : []),
        ...(user.role === "STUDENT" ? [{ students: { some: { student: { userId: user.id } } } }] : []),
        ...(user.role === "GUARDIAN" ? [{ students: { some: { student: { guardian: { userId: user.id } } } } }] : []),
      ],
    },
    select: { zoomJoinUrl: true, id: true },
  });
  if (!session) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Session not found." } }, { status: 404 });
  if (!session.zoomJoinUrl.startsWith("https://")) {
    return NextResponse.json({ error: { code: "CONFLICT", message: "The session link is not available." } }, { status: 409 });
  }
  await prisma.sessionJoinClick.create({ data: { sessionId: session.id, userId: user.id } });
  return NextResponse.redirect(session.zoomJoinUrl);
}
