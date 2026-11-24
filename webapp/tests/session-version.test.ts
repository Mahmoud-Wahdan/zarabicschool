import { isSessionVersionCurrent } from "../lib/auth/session-version";

describe("isSessionVersionCurrent", () => {
  test("missing and zero token versions remain valid for version-zero accounts", () => {
    expect(isSessionVersionCurrent(undefined, 0)).toBe(true);
    expect(isSessionVersionCurrent(0, 0)).toBe(true);
  });

  test("matching nonzero and current versions are accepted", () => {
    expect(isSessionVersionCurrent(3, 3)).toBe(true);
  });

  test("older and mismatched token versions are rejected", () => {
    expect(isSessionVersionCurrent(2, 3)).toBe(false);
    expect(isSessionVersionCurrent(4, 3)).toBe(false);
  });
});
