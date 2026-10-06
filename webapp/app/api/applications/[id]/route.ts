import { NextResponse } from "next/server";

import { prisma } from "../../../../lib/prisma";import { requireApiRoles } from "../../../../lib/dal";
import { errorResponse } from "../../../../lib/request";

export const runtime = "nodejs";

type CreatedAccount = {
  userId: string;
  username: string;
  role: string;
  displayName: string;
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, error } = await requireApiRoles(["ADMIN", "SUPERVISOR"]);
  if (error) return error;

  const { id } = await params;

  const application = await prisma.application.findFirst({
    where: { id, academyId: user.academyId },
    select: {
      id: true,
      applicationType: true,
      status: true,
      details: true,
      contactPhone: true,
      contactEmail: true,
      createdAt: true,
      reviewedById: true,
      reviewedAt: true,
      approvedById: true,
      approvedAt: true,
      approvedUserId: true,
      rejectionReason: true,
    },
  });

  if (!application) {
    return errorResponse(404, "APPLICATION_NOT_FOUND", "Application not found.");
  }

  let createdAccounts: CreatedAccount[] = [];
  if (application.status === "APPROVED") {
    const records = await prisma.applicationRecord.findMany({
      where: { applicationId: application.id },
      select: {
        user: {
          select: {
            id: true,
            username: true,
            role: true,
            displayName: true,
          },
        },
      },
    });
    createdAccounts = records.map((record) => ({
      userId: record.user.id,
      username: record.user.username,
      role: record.user.role,
      displayName: record.user.displayName,
    }));
  }

  return NextResponse.json({
    application,
    createdAccounts,
  });
}
