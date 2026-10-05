import { NextResponse } from "next/server";

import { requireApiRole } from "../../../../../lib/dal";
import { fakeMessagingProvider } from "../../../../../lib/messaging/fake-provider";
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

  const { user, error } = await requireApiRole("ADMIN");
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
    });
  } catch (e) {
    if (e instanceof ProvisioningError) {
      return errorResponse(e.status, e.code, e.message, e.fieldErrors);
    }
    throw e;
  }

  for (const account of accounts) {
    try {
      await fakeMessagingProvider.sendCredentials(
        { userId: account.userId, phone: account.deliveryPhone },
        { username: account.username, tempPassword: account.tempPassword }
      );
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
