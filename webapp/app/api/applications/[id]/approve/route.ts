import { NextResponse } from "next/server";

import { requireApiRoles } from "../../../../../lib/dal";
import { getMessagingProvider } from "../../../../../lib/messaging/provider";
import { prisma } from "../../../../../lib/prisma";
import {
  approveApplication,
  ProvisioningError,
} from "../../../../../lib/provisioning";
import { errorResponse, isSameOrigin } from "../../../../../lib/request";
import { approveApplicationSchema } from "../../../../../lib/validation/approve";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isSameOrigin(request.headers)) {
    return errorResponse(403, "ORIGIN_NOT_ALLOWED", "Request origin is not allowed.");
  }

  const { user, error } = await requireApiRoles(["ADMIN"]);
  if (error) return error;

  const { id } = await params;

  let raw: unknown;
  const contentLength = Number(request.headers.get("content-length") || "0");
  if (contentLength === 0) {
    raw = {};
  } else {
    try {
      raw = await request.json();
    } catch {
      return errorResponse(400, "INVALID_JSON", "The request body must be valid JSON.");
    }
  }

  const parsed = approveApplicationSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors as Record<string, string[]>;
    return errorResponse(400, "VALIDATION_ERROR", "Please correct the highlighted fields.", fieldErrors);
  }

  const body = parsed.data;

  let accounts;
  try {
    accounts = await approveApplication({
      applicationId: id,
      adminId: user.id,
      academyId: user.academyId,
      relationship: body.relationship,
      existingGuardianId: body.existingGuardianId,
      createGuardian: body.createGuardian
        ? {
            full_name: body.createGuardian.full_name,
            phone_whatsapp: body.createGuardian.phone_whatsapp,
            relationship: body.createGuardian.relationship,
          }
        : undefined,
      accounts: body.accounts,
      teachers: body.teachers,
    });
  } catch (e) {
    if (e instanceof ProvisioningError) {
      return errorResponse(e.status, e.code, e.message, e.fieldErrors);
    }
    throw e;
  }

  for (const account of accounts) {
    try {
      const provider = getMessagingProvider();
      const result = await provider.sendCredentials(
        { userId: account.userId, phone: account.deliveryPhone },
        { username: account.username, tempPassword: account.tempPassword }
      );
      if (!result.ok) {
        // Redacted failure row so Admin can retry when WhatsApp is connected
        // (the job table doubles as the NotificationLog). Never stores the
        // password. A dedup-key collision (repeated failure for the same
        // account+key) refreshes the existing row instead of being lost.
        const failureData = {
          status: "FAILED" as const,
          lastError: result.error ?? "Messaging provider failed.",
        };
        try {
          await prisma.notificationJob.create({
            data: {
              academyId: user.academyId,
              recipientUserId: account.userId,
              kind: "CREDENTIALS",
              dedupKey: `CREDENTIALS:${account.userId}:${account.key}`,
              scheduledFor: new Date(),
              ...failureData,
            },
            select: { id: true },
          });
        } catch {
          await prisma.notificationJob.updateMany({
            where: { dedupKey: `CREDENTIALS:${account.userId}:${account.key}` },
            data: failureData,
          });
        }
      }
    } catch {
      // Delivery failure must not roll back the approval nor reveal passwords.
    }
  }

  const response = NextResponse.json(
    {
      accounts: accounts.map((account) => ({
        key: account.key,
        userId: account.userId,
        role: account.role,
        username: account.username,
        displayName: account.displayName,
        tempPassword: account.tempPassword,
      })),
    },
    { status: 201 }
  );
  response.headers.set("Cache-Control", "no-store");
  return response;
}
