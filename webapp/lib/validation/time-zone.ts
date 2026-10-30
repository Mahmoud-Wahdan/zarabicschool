/** A real IANA zone name (or "UTC") that Intl accepts — pure, safe for Zod schemas. */
const IANA_NAME = /^[A-Za-z][A-Za-z_]*(\/[A-Za-z0-9_+-]+){1,2}$/;

export function isValidTimeZone(name: string): boolean {
  if (typeof name !== "string" || name.length === 0 || name.length > 80) return false;
  if (name !== "UTC" && !IANA_NAME.test(name)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: name });
    return true;
  } catch {
    return false;
  }
}
