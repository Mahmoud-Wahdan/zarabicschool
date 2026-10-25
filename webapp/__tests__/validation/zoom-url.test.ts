import {
  ZOOM_MEETING_ID_MAX_DIGITS,
  ZOOM_MEETING_ID_MIN_DIGITS,
  ZOOM_URL_MAX_LENGTH,
  validateZoomUrl,
  zoomUrlReasonMessages,
  type ZoomUrlInvalidReason,
} from "../../lib/validation/zoom-url";

function reasonOf(value: string): ZoomUrlInvalidReason {
  const result = validateZoomUrl(value);
  if (result.ok) throw new Error(`expected "${value}" to be rejected`);
  return result.reason;
}

function expectValid(value: string) {
  const result = validateZoomUrl(value);
  expect(result).toEqual({ ok: true });
}

describe("Zoom URL format validation (format check only)", () => {
  it("accepts canonical meeting join links", () => {
    expectValid("https://zoom.us/j/123456789");
    expectValid("https://zoom.us/j/12345678901");
    expectValid("https://zoom.us/j/1234567890123");
  });

  it("accepts subdomains of zoom.us", () => {
    expectValid("https://us02web.zoom.us/j/12345678901");
    expectValid("https://eu01web.zoom.us/s/987654321");
  });

  it("accepts webinar join links", () => {
    expectValid("https://zoom.us/s/123456789");
  });

  it("accepts web-client links with extra path segments and query strings", () => {
    expectValid("https://zoom.us/wc/123456789/start");
    expectValid("https://zoom.us/wc/123456789/join?pwd=abc123");
    expectValid("https://us05web.zoom.us/wc/876543210123/present?pwd=xyz");
  });

  it("accepts trailing slashes and surrounding whitespace", () => {
    expectValid("https://zoom.us/j/123456789/");
    expectValid("  https://zoom.us/j/123456789  ");
  });

  it("rejects lookalike hosts", () => {
    expect(reasonOf("https://zoom.us.evil.com/j/123456789")).toBe("ZOOM_URL_INVALID_HOST");
    expect(reasonOf("https://zoom-us.com/j/123456789")).toBe("ZOOM_URL_INVALID_HOST");
    expect(reasonOf("https://evil.com/j/123456789")).toBe("ZOOM_URL_INVALID_HOST");
    expect(reasonOf("https://zoom.us.attacker.io/j/123456789")).toBe("ZOOM_URL_INVALID_HOST");
    expect(reasonOf("https://myzoom.us/j/123456789")).toBe("ZOOM_URL_INVALID_HOST");
  });

  it("rejects the bare host without a dot boundary", () => {
    expect(reasonOf("https://notzoom.us/j/123456789")).toBe("ZOOM_URL_INVALID_HOST");
  });

  it("rejects non-https schemes", () => {
    expect(reasonOf("http://zoom.us/j/123456789")).toBe("ZOOM_URL_NOT_HTTPS");
    expect(reasonOf("ftp://zoom.us/j/123456789")).toBe("ZOOM_URL_NOT_HTTPS");
  });

  it("rejects javascript: and data: URLs before host parsing", () => {
    expect(reasonOf("javascript:alert(1)")).toBe("ZOOM_URL_NOT_HTTPS");
    expect(reasonOf("data:text/html,hello")).toBe("ZOOM_URL_NOT_HTTPS");
  });

  it("rejects embedded credentials", () => {
    expect(reasonOf("https://user:pass@zoom.us/j/123456789")).toBe("ZOOM_URL_CREDENTIALS");
    expect(reasonOf("https://user@zoom.us/j/123456789")).toBe("ZOOM_URL_CREDENTIALS");
  });

  it("rejects non-default ports", () => {
    expect(reasonOf("https://zoom.us:8443/j/123456789")).toBe("ZOOM_URL_NON_DEFAULT_PORT");
  });

  it("accepts the implicit default port", () => {
    expectValid("https://zoom.us:443/j/123456789");
  });

  it("rejects personal-room and unknown paths", () => {
    expect(reasonOf("https://zoom.us/my/rooms-name")).toBe("ZOOM_URL_INVALID_PATH");
    expect(reasonOf("https://zoom.us/")).toBe("ZOOM_URL_INVALID_PATH");
    expect(reasonOf("https://zoom.us/j")).toBe("ZOOM_URL_INVALID_PATH");
    expect(reasonOf("https://zoom.us/j/abc")).toBe("ZOOM_URL_INVALID_PATH");
    expect(reasonOf("https://zoom.us/j/123456789/extra")).toBe("ZOOM_URL_INVALID_PATH");
  });

  it("enforces the meeting id digit range", () => {
    expect(reasonOf("https://zoom.us/j/12345678")).toBe("ZOOM_URL_INVALID_MEETING_ID");
    expect(reasonOf("https://zoom.us/j/12345678901234")).toBe("ZOOM_URL_INVALID_MEETING_ID");
  });

  it("rejects malformed URLs and non-strings", () => {
    expect(reasonOf("not a url")).toBe("ZOOM_URL_MALFORMED");
    expect(reasonOf("https://")).toBe("ZOOM_URL_MALFORMED");
    expect(validateZoomUrl("").ok).toBe(false);
    expect(validateZoomUrl(null).ok).toBe(false);
    expect(validateZoomUrl(undefined).ok).toBe(false);
  });

  it("rejects oversized URLs", () => {
    const long = `https://zoom.us/j/123456789?pwd=${"a".repeat(ZOOM_URL_MAX_LENGTH)}`;
    expect(reasonOf(long)).toBe("ZOOM_URL_TOO_LONG");
  });

  it("exposes only generic messages (never echoes the link)", () => {
    for (const message of Object.values(zoomUrlReasonMessages)) {
      expect(message).not.toContain("zoom.us.evil.com");
      expect(message).not.toContain("https://");
      expect(message.length).toBeLessThan(200);
    }
  });

  it("keeps documented constants", () => {
    expect(ZOOM_MEETING_ID_MIN_DIGITS).toBe(9);
    expect(ZOOM_MEETING_ID_MAX_DIGITS).toBe(13);
    expect(ZOOM_URL_MAX_LENGTH).toBe(2000);
  });
});
