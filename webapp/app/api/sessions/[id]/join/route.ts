import { NextResponse } from "next/server";

import { requireApiRoles } from "../../../../../lib/dal";
import { prisma } from "../../../../../lib/prisma";
import { validateZoomUrl } from "../../../../../lib/validation/zoom-url";

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
  // Format check of the stored link (covers legacy non-conforming links) — never echo the link.
  if (!validateZoomUrl(session.zoomJoinUrl).ok) {
    return NextResponse.json(
      { error: { code: "INVALID_ZOOM_URL", message: "The stored session link does not have a valid Zoom format. Ask an Admin to replace it." } },
      { status: 409 },
    );
  }
  await prisma.sessionJoinClick.create({ data: { sessionId: session.id, userId: user.id } });
  return NextResponse.redirect(session.zoomJoinUrl);
}
