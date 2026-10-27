import { safeCallbackPath } from "../../lib/auth/callback-url";

/**
 * I-1 / D4: after signing in, the reader returns to where they came from — but only
 * to a same-site PATH from a small allowlist (no open redirect).
 */
describe("safeCallbackPath (JL-09)", () => {
  const sessionId = "3f1c2a4e-5b6d-4e7f-8a9b-0c1d2e3f4a5b";

  it("accepts the join redirect and localized in-app pages", () => {
    expect(safeCallbackPath(`/api/sessions/${sessionId}/join`)).toBe(`/api/sessions/${sessionId}/join`);
    expect(safeCallbackPath(`/api/sessions/${sessionId}/join?host=1`)).toBe(`/api/sessions/${sessionId}/join?host=1`);
    expect(safeCallbackPath("/ar/guardian/invoices")).toBe("/ar/guardian/invoices");
    expect(safeCallbackPath("/en/payments/paymob/return?order=123")).toBe("/en/payments/paymob/return?order=123");
  });

  it("rejects anything that could leave the site or reach another API", () => {
    for (const value of [
      undefined, null, "", ["/ar/student"], "https://evil.example", "//evil.example", "/\\evil.example",
      "/ar//evil.example", "javascript:alert(1)", "/api/admin/users", "/fr/student", "ar/student",
      `/api/sessions/${sessionId}/join?host=1&x=2`, "/ar/student\nx", `/${"a".repeat(600)}`,
    ]) {
      expect(safeCallbackPath(value as never)).toBeNull();
    }
  });
});
