/**
 * Phone → WhatsApp addressing for the OpenWA adapter (owner, 2026-10-25).
 *
 * Students and guardians can live abroad, so a number that already carries a
 * country code (a leading "+" or "00") passes through unchanged. ONLY the
 * Egyptian local formats are rewritten to the Egyptian country code:
 *   01XXXXXXXXX (11 digits, local) → 201XXXXXXXXX
 *   1XXXXXXXXX  (10 digits, local without the trunk 0) → 201XXXXXXXXX
 * A bare "201XXXXXXXXX" (12 digits) is already international. Anything else is
 * refused instead of guessed — a guessed country code sends to a stranger.
 */
const EGYPT_LOCAL = /^0?(1[0125]\d{8})$/;
const EGYPT_INTERNATIONAL_NO_PLUS = /^201[0125]\d{8}$/;
// E.164: at most 15 digits, no leading zero after the country-code prefix.
const E164_DIGITS = /^[1-9]\d{6,14}$/;

/** International digits without "+" (e.g. "201012345678"), or null when not addressable. */
export function toInternationalDigits(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const compact = raw.replace(/[\s().-]/g, "");
  if (compact.startsWith("+")) {
    const digits = compact.slice(1);
    return E164_DIGITS.test(digits) ? digits : null;
  }
  if (compact.startsWith("00")) {
    const digits = compact.slice(2);
    return E164_DIGITS.test(digits) ? digits : null;
  }
  if (EGYPT_INTERNATIONAL_NO_PLUS.test(compact)) return compact;
  const local = EGYPT_LOCAL.exec(compact);
  if (local) return `20${local[1]}`;
  return null;
}

/** OpenWA individual chat id ("<digits>@c.us"), or null when not addressable. */
export function toWhatsAppChatId(raw: string | null | undefined): string | null {
  const digits = toInternationalDigits(raw);
  return digits ? `${digits}@c.us` : null;
}

/** wa.me click-to-chat link for a configured contact number, or null. */
export function toWaMeLink(raw: string | null | undefined): string | null {
  const digits = toInternationalDigits(raw);
  return digits ? `https://wa.me/${digits}` : null;
}
