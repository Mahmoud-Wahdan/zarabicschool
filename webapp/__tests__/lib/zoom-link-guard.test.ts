import { replaceRawZoomLinks } from "../../lib/messaging/zoom-link-guard";

/**
 * Owner (2026-10-26, again 2026-10-31): no WhatsApp message ever carries a raw Zoom
 * link. The last step before sending replaces any Zoom URL — from any builder, an
 * Admin message or an announcement — with the platform join link of the session
 * (which logs the click, then redirects to Zoom), or a pointer to the platform.
 */
describe("replaceRawZoomLinks", () => {
  const platform = "https://academy.example/api/sessions/11111111-1111-4111-8111-111111111111/join";

  it("ZG-01: a Zoom join link becomes the session's platform link", () => {
    const out = replaceRawZoomLinks("رابط الحضور: https://us05web.zoom.us/j/123456789?pwd=abc", { platformLink: platform, language: "ar" });
    expect(out).toBe(`رابط الحضور: ${platform}`);
  });

  it("ZG-02: every Zoom form is caught (subdomains, /s/ host links, zoom.com, http, no scheme)", () => {
    const text = [
      "https://zoom.us/s/987654321?zak=x",
      "http://company.zoom.us/j/1",
      "https://app.zoom.com/wc/join/2",
      "zoom.us/j/3",
      "https://us02web.zoom.us/my/teacher.name.",
    ].join(" | ");
    const out = replaceRawZoomLinks(text, { platformLink: platform, language: "en" });
    expect(out).not.toMatch(/zoom\.(us|com)/i);
    expect(out.split(platform)).toHaveLength(6);
    expect(out.endsWith(".")).toBe(true);
  });

  it("ZG-03: without a session link the reader is pointed to the platform", () => {
    expect(replaceRawZoomLinks("Join https://zoom.us/j/1 now", { platformLink: null, language: "en" })).toBe("Join (the session link is on the platform) now");
    expect(replaceRawZoomLinks("ادخل https://zoom.us/j/1", { platformLink: null, language: "ar" })).toBe("ادخل (رابط الحصة على المنصة)");
  });

  it("ZG-04: text without Zoom links is unchanged, and look-alike hosts are left alone", () => {
    const text = `Reminder: join from the platform: ${platform} — see notzoom.usa.example.org`;
    expect(replaceRawZoomLinks(text, { platformLink: platform, language: "en" })).toBe(text);
  });
});
