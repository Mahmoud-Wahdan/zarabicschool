import "server-only";

/**
 * Attachment allowlist (owner decision 2026-10-14): images + PDF, max 10 MB.
 * Report attachments additionally accept AUDIO (owner, 2026-10-25 — Cloudinary
 * switch: "images, PDF, audio"); payment proofs stay images + PDF.
 * The MIME type is validated by CONTENT SIGNATURE (magic bytes), never by the
 * client-supplied filename or Content-Type — a renamed .exe is rejected.
 */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

type AllowedType = { mime: string; ext: string; matches: (bytes: Buffer) => boolean };

function startsWith(bytes: Buffer, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

const ALLOWED_TYPES: AllowedType[] = [
  { mime: "image/jpeg", ext: "jpg", matches: (bytes) => startsWith(bytes, [0xff, 0xd8, 0xff]) },
  {
    mime: "image/png",
    ext: "png",
    matches: (bytes) => startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  },
  {
    mime: "image/webp",
    ext: "webp",
    matches: (bytes) => startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8),
  },
  {
    mime: "application/pdf",
    ext: "pdf",
    matches: (bytes) => startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]),
  },
];

const AUDIO_TYPES: AllowedType[] = [
  // MP3: an ID3v2 tag, or a bare MPEG-1 Layer III frame sync.
  {
    mime: "audio/mpeg",
    ext: "mp3",
    matches: (bytes) =>
      startsWith(bytes, [0x49, 0x44, 0x33]) ||
      startsWith(bytes, [0xff, 0xfb]) ||
      startsWith(bytes, [0xff, 0xf3]) ||
      startsWith(bytes, [0xff, 0xf2]),
  },
  // M4A / MP4 audio: ISO-BMFF "ftyp" box. Mobile voice recorders use varying
  // brands (isom, mp42, mp41, 3gp4/5/6 on Android; M4A on iOS); restricting to
  // "M4A " rejected most Android recordings. Accepting any ftyp is safe because
  // this entry is only in AUDIO_TYPES (used for the "audio" and "report"
  // profiles — both audio-upload contexts where the user chose an audio file).
  {
    mime: "audio/mp4",
    ext: "m4a",
    matches: (bytes) =>
      startsWith(bytes, [0x66, 0x74, 0x79, 0x70], 4) &&
      (startsWith(bytes, [0x4d, 0x34, 0x41, 0x20], 8) ||  // M4A  (Apple)
       startsWith(bytes, [0x69, 0x73, 0x6f, 0x6d], 8) ||  // isom (Android/Samsung)
       startsWith(bytes, [0x6d, 0x70, 0x34, 0x32], 8) ||  // mp42 (Google Recorder)
       startsWith(bytes, [0x6d, 0x70, 0x34, 0x31], 8) ||  // mp41
       startsWith(bytes, [0x33, 0x67, 0x70], 8)),          // 3gp* (Android 3GP audio)
  },
  { mime: "audio/ogg", ext: "ogg", matches: (bytes) => startsWith(bytes, [0x4f, 0x67, 0x67, 0x53]) },
  {
    mime: "audio/wav",
    ext: "wav",
    matches: (bytes) => startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x41, 0x56, 0x45], 8),
  },
];

/**
 * `profile` "report" = images + PDF + audio (report attachments);
 * "proof" = images + PDF (payment proofs; the default);
 * "audio" = MP3, M4A, OGG, WAV (Quran recitation audio).
 */
export function detectAllowedMime(
  bytes: Buffer,
  profile: "report" | "proof" | "audio" = "proof",
): { mime: string; ext: string } | null {
  const candidates =
    profile === "report"
      ? [...ALLOWED_TYPES, ...AUDIO_TYPES]
      : profile === "audio"
        ? AUDIO_TYPES
        : ALLOWED_TYPES;
  const match = candidates.find((type) => type.matches(bytes));
  return match ? { mime: match.mime, ext: match.ext } : null;
}
