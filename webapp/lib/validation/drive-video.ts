export const DRIVE_LINK_MAX_LENGTH = 500;

/**
 * Owner task (2026-11-02): the teacher application requires an intro/explanation
 * video as a Google Drive link. The server NEVER fetches or opens the link — this
 * is format-only validation, exactly like lib/validation/zoom-url.ts.
 *
 * Parse with `new URL()` only (no includes()/weak regex):
 * - protocol exactly `https:` (rejects javascript:, data:, http: and everything else)
 * - hostname exactly `drive.google.com` or `docs.google.com` (lookalike subdomains rejected)
 * - max 500 characters
 * Reasons never echo the link itself.
 */
export type DriveLinkInvalidReason =
  | "DRIVE_LINK_REQUIRED"
  | "DRIVE_LINK_TOO_LONG"
  | "DRIVE_LINK_MALFORMED"
  | "DRIVE_LINK_NOT_HTTPS"
  | "DRIVE_LINK_INVALID_HOST";

export type DriveLinkValidation =
  | { ok: true }
  | { ok: false; reason: DriveLinkInvalidReason };

export const driveLinkReasonMessages: Record<DriveLinkInvalidReason, string> = {
  DRIVE_LINK_REQUIRED: "An intro video Google Drive link is required.",
  DRIVE_LINK_TOO_LONG: "The intro video link is too long (500 characters maximum).",
  DRIVE_LINK_MALFORMED: "The intro video link is not a valid URL.",
  DRIVE_LINK_NOT_HTTPS: "The intro video link must be a secure https:// Google Drive link.",
  DRIVE_LINK_INVALID_HOST: "The intro video link must point to drive.google.com or docs.google.com.",
};

function isDriveHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "drive.google.com" || normalized === "docs.google.com";
}

export function validateDriveLink(value: unknown): DriveLinkValidation {
  if (typeof value !== "string") return { ok: false, reason: "DRIVE_LINK_REQUIRED" };
  const trimmed = value.trim();
  if (trimmed.length === 0) return { ok: false, reason: "DRIVE_LINK_REQUIRED" };
  if (trimmed.length > DRIVE_LINK_MAX_LENGTH) return { ok: false, reason: "DRIVE_LINK_TOO_LONG" };

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: "DRIVE_LINK_MALFORMED" };
  }

  if (parsed.protocol !== "https:") return { ok: false, reason: "DRIVE_LINK_NOT_HTTPS" };
  if (!isDriveHost(parsed.hostname)) return { ok: false, reason: "DRIVE_LINK_INVALID_HOST" };

  return { ok: true };
}
