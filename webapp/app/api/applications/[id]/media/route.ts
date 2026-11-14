import { NextResponse } from "next/server";
import { prisma } from "../../../../../lib/prisma";
import { requireApiRoles } from "../../../../../lib/dal";
import { errorResponse } from "../../../../../lib/request";
import { getStorageProviderFor } from "../../../../../lib/storage";
import type { StorageProviderName } from "../../../../../lib/storage/provider";

export const runtime = "nodejs";

const SIGNED_URL_EXPIRES_SECONDS = 900; // 15 minutes (owner decision)

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, error } = await requireApiRoles(["ADMIN"]);
  if (error) return error;

  const { id } = await params;
  if (!id) {
    return errorResponse(400, "INVALID_ID", "Application ID is required.");
  }

  const application = await prisma.application.findFirst({
    where: { id, academyId: user.academyId },
    select: {
      id: true,
      recitationAudioPath: true,
      recitationAudioStorageProvider: true,
      recitationAudioResourceType: true,
      recitationAudioFormat: true,
    },
  });

  if (!application) {
    return errorResponse(404, "NOT_FOUND", "Application not found.");
  }

  if (!application.recitationAudioPath) {
    return errorResponse(404, "AUDIO_NOT_FOUND", "No recitation audio attached to this application.");
  }

  const providerName = (application.recitationAudioStorageProvider || "cloudinary") as StorageProviderName;
  const provider = getStorageProviderFor(providerName);
  if (!provider) {
    return errorResponse(503, "STORAGE_NOT_CONFIGURED", "Storage provider is not configured.");
  }

  try {
    const signedUrl = await provider.createSignedUrl(
      {
        key: application.recitationAudioPath,
        resourceType: application.recitationAudioResourceType,
        format: application.recitationAudioFormat,
      },
      SIGNED_URL_EXPIRES_SECONDS,
    );

    // Never leak storage path, public_id or provider details in response
    return NextResponse.json({
      url: signedUrl,
      expiresIn: SIGNED_URL_EXPIRES_SECONDS,
    });
  } catch {
    return errorResponse(500, "SIGN_FAILED", "Failed to generate signed media URL.");
  }
}
