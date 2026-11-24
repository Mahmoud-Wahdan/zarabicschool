/**
 * Compares the JWT `sessionVersion` claim against the user's stored version.
 * Missing token claims (issued before version tracking) are treated as version 0.
 */
export function isSessionVersionCurrent(
  tokenVersion: number | undefined,
  currentVersion: number,
): boolean {
  return (tokenVersion ?? 0) === currentVersion;
}
