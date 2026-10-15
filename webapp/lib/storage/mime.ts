import "server-only";

/**
 * Attachment allowlist (owner decision 2026-10-14): images + PDF, max 10 MB.
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

export function detectAllowedMime(bytes: Buffer): { mime: string; ext: string } | null {
  const match = ALLOWED_TYPES.find((type) => type.matches(bytes));
  return match ? { mime: match.mime, ext: match.ext } : null;
}
