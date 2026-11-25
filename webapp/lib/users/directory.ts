import "server-only";

import { prisma } from "../prisma";

export function listDirectoryUsers(viewer: { academyId: string; role: string }) {
  return prisma.user.findMany({
    where: {
      academyId: viewer.academyId,
      ...(viewer.role === "ADMIN" ? {} : { role: { not: "ADMIN" as const } }),
    },
    orderBy: [{ role: "asc" }, { displayName: "asc" }],
    select: {
      id: true, username: true, displayName: true, email: true, phone: true,
      role: true, isActive: true, timezone: true, dateOfBirth: true,
      preferredLanguage: true, announcementsOptOut: true, createdAt: true,
    },
  });
}
