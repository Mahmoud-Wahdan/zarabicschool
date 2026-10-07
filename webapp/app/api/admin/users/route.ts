import bcrypt from "bcrypt";
import { NextResponse } from "next/server";

import { requireApiRole } from "../../../../lib/dal";
import { prisma } from "../../../../lib/prisma";
import { privilegedUserCreateSchema } from "../../../../lib/validation/management";

export async function GET() {
  const { user, error } = await requireApiRole("ADMIN");
  if (error) return error;

  const users = await prisma.user.findMany({
    where: { academyId: user.academyId, role: { in: ["ADMIN", "SUPERVISOR"] } },
    orderBy: [{ role: "asc" }, { displayName: "asc" }],
    select: {
      id: true,
      username: true,
      displayName: true,
      email: true,
      phone: true,
      role: true,
      isActive: true,
      createdAt: true,
    },
  });
  return NextResponse.json({ data: users });
}

export async function POST(request: Request) {
  const { user, error } = await requireApiRole("ADMIN");
  if (error) return error;

  const parsed = privilegedUserCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid privileged account data.", fields: parsed.error.flatten().fieldErrors } },
      { status: 400 },
    );
  }

  const input = parsed.data;
  const passwordHash = await bcrypt.hash(input.password, 12);
  try {
    const created = await prisma.user.create({
      data: {
        academyId: user.academyId,
        username: input.username.toLowerCase(),
        displayName: input.displayName,
        passwordHash,
        role: input.role,
        email: input.email || null,
        phone: input.phone || null,
        mustChangePassword: false,
        isActive: true,
      },
      select: { id: true, username: true, displayName: true, role: true, isActive: true },
    });
    return NextResponse.json({ data: created }, { status: 201 });
  } catch (cause) {
    if (cause && typeof cause === "object" && "code" in cause && cause.code === "P2002") {
      return NextResponse.json(
        { error: { code: "CONFLICT", message: "This username already exists in the academy." } },
        { status: 409 },
      );
    }
    throw cause;
  }
}
