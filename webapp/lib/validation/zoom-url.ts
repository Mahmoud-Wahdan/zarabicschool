export const ZOOM_URL_MAX_LENGTH = 2000;
export const ZOOM_MEETING_ID_MIN_DIGITS = 9;
export const ZOOM_MEETING_ID_MAX_DIGITS = 13;

export type ZoomUrlInvalidReason =
  | "ZOOM_URL_REQUIRED"
  | "ZOOM_URL_TOO_LONG"
  | "ZOOM_URL_MALFORMED"
  | "ZOOM_URL_NOT_HTTPS"
  | "ZOOM_URL_INVALID_HOST"
  | "ZOOM_URL_CREDENTIALS"
  | "ZOOM_URL_NON_DEFAULT_PORT"
  | "ZOOM_URL_INVALID_PATH"
  | "ZOOM_URL_INVALID_MEETING_ID";

export type ZoomUrlValidation =
  | { ok: true }
  | { ok: false; reason: ZoomUrlInvalidReason };

export const zoomUrlReasonMessages: Record<ZoomUrlInvalidReason, string> = {
  ZOOM_URL_REQUIRED: "A Zoom link is required.",
  ZOOM_URL_TOO_LONG: "The Zoom link is too long.",
  ZOOM_URL_MALFORMED: "The Zoom link is not a valid URL.",
  ZOOM_URL_NOT_HTTPS: "Zoom links must use https.",
  ZOOM_URL_INVALID_HOST: "The Zoom link must point to zoom.us or a subdomain of zoom.us.",
  ZOOM_URL_CREDENTIALS: "The Zoom link must not contain a username or password.",
  ZOOM_URL_NON_DEFAULT_PORT: "The Zoom link must not contain a port.",
  ZOOM_URL_INVALID_PATH: "The Zoom link path must be a meeting join, webinar join, or web-client link.",
  ZOOM_URL_INVALID_MEETING_ID: "The meeting ID in the Zoom link must be 9 to 13 digits.",
};

function isZoomHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "zoom.us" || normalized.endsWith(".zoom.us");
}

function isValidMeetingPath(pathname: string): { valid: boolean; meetingId: string | null } {
  const segments = pathname.split("/").filter((segment) => segment.length > 0);
  if (segments.length < 2) return { valid: false, meetingId: null };
  const kind = segments[0];
  const id = segments[1];
  if (!/^\d+$/.test(id)) return { valid: false, meetingId: null };
  if (kind === "j" || kind === "s") {
    if (segments.length !== 2) return { valid: false, meetingId: null };
    return { valid: true, meetingId: id };
  }
  if (kind === "wc") {
    for (let index = 2; index < segments.length; index += 1) {
      if (!/^[A-Za-z0-9._-]+$/.test(segments[index])) return { valid: false, meetingId: null };
    }
    return { valid: true, meetingId: id };
  }
  return { valid: false, meetingId: null };
}

/**
 * Format-only validation of a Zoom meeting link.
 * This NEVER contacts Zoom and does NOT prove the meeting exists.
 * The check is deliberately generic: reasons never echo the link itself.
 */
export function validateZoomUrl(value: unknown): ZoomUrlValidation {
  if (typeof value !== "string") return { ok: false, reason: "ZOOM_URL_REQUIRED" };
  const trimmed = value.trim();
  if (trimmed.length === 0) return { ok: false, reason: "ZOOM_URL_REQUIRED" };
  if (trimmed.length > ZOOM_URL_MAX_LENGTH) return { ok: false, reason: "ZOOM_URL_TOO_LONG" };

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: "ZOOM_URL_MALFORMED" };
  }

  if (parsed.protocol !== "https:") return { ok: false, reason: "ZOOM_URL_NOT_HTTPS" };
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    return { ok: false, reason: "ZOOM_URL_CREDENTIALS" };
  }
  if (parsed.port !== "") return { ok: false, reason: "ZOOM_URL_NON_DEFAULT_PORT" };
  if (!isZoomHost(parsed.hostname)) return { ok: false, reason: "ZOOM_URL_INVALID_HOST" };

  const path = isValidMeetingPath(parsed.pathname);
  if (!path.valid) return { ok: false, reason: "ZOOM_URL_INVALID_PATH" };

  const idLength = (path.meetingId ?? "").length;
  if (idLength < ZOOM_MEETING_ID_MIN_DIGITS || idLength > ZOOM_MEETING_ID_MAX_DIGITS) {
    return { ok: false, reason: "ZOOM_URL_INVALID_MEETING_ID" };
  }

  return { ok: true };
}
