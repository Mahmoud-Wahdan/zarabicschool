/**
 * Test requests come from the app's own origin. The B3 same-origin guard
 * (`lib/request.ts` isSameOrigin) compares the Origin's host with the Host header
 * outside production, so every mutation built by a test carries both. Dedicated
 * tests (`__tests__/lib/same-origin-guard.test.ts`) prove that a missing or foreign
 * Origin is refused with 403 ORIGIN_NOT_ALLOWED.
 */
export const TEST_ORIGIN = "http://localhost:3000";

export function sameOriginHeaders(headers?: Record<string, string>): Record<string, string> {
  return { origin: TEST_ORIGIN, host: new URL(TEST_ORIGIN).host, ...headers };
}
