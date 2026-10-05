import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { getLocale } from "next-intl/server";

import { authOptions } from "./auth";
import { prisma } from "./prisma";

export type AuthUser = {
  id: string;
  academyId: string;
  username: string;
  displayName: string;
  role: "ADMIN" | "TEACHER" | "STUDENT" | "GUARDIAN";
  mustChangePassword: boolean;
};

export const getAuthSession = cache(async (): Promise<AuthUser | null> => {
  const session = await getServerSession(authOptions);
  const id = session?.user?.id;
  if (!id) return null;

  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      academyId: true,
      username: true,
      displayName: true,
      role: true,
      isActive: true,
      mustChangePassword: true,
    },
  });

  if (!user || !user.isActive) return null;
  return user;
});

export async function requireRole(role: AuthUser["role"]): Promise<AuthUser> {
  const user = await getAuthSession();
  const locale = await getLocale();
  if (!user) redirect(`/${locale}/login`);
  if (user.mustChangePassword) redirect(`/${locale}/change-password`);
  if (user.role !== role) redirect(`/${locale}/${user.role.toLowerCase()}`);
  return user;
}

export async function requireApiRole(role: AuthUser["role"]) {
  const user = await getAuthSession();
  if (!user) {
    return {
      user: null,
      error: NextResponse.json(
        { error: { code: "UNAUTHORIZED", message: "Authentication is required." } },
        { status: 401 },
      ),
    };
  }
  if (user.mustChangePassword) {
    return {
      user: null,
      error: NextResponse.json(
        { error: { code: "MUST_CHANGE_PASSWORD", message: "Change your password before using the platform." } },
        { status: 403 },
      ),
    };
  }
  if (user.role !== role) {
    return {
      user: null,
      error: NextResponse.json(
        { error: { code: "FORBIDDEN", message: "You do not have access to this resource." } },
        { status: 403 },
      ),
    };
  }
  return { user, error: null };
}
