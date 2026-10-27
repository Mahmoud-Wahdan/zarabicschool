import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

import WhatsAppPhoneLink from "../../app/_components/ui/whatsapp-phone-link";

/**
 * S-05 / D17 (owner, 2026-10-27): a plain wa.me icon next to phone numbers in the
 * staff (Admin/Supervisor) student/teacher/guardian views. It opens the staff
 * member's own WhatsApp — never OpenWA; numbers normalized to international digits;
 * `rel="noopener noreferrer"`; numbers never logged.
 */
describe("WhatsApp icon next to phone numbers (S-05)", () => {
  it("WAI-01: an Egyptian local number links to wa.me with international digits", () => {
    const html = renderToStaticMarkup(<WhatsAppPhoneLink phone="010 1234 5678" label="WhatsApp" />);
    expect(html).toContain('href="https://wa.me/201012345678"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('aria-label="WhatsApp"');
    expect(html).toContain("010 1234 5678");
  });

  it("WAI-02: an international number keeps its country code", () => {
    const html = renderToStaticMarkup(<WhatsAppPhoneLink phone="+49 151 23456789" label="WhatsApp" />);
    expect(html).toContain('href="https://wa.me/4915123456789"');
  });

  it("WAI-03: an unaddressable or missing number shows no link (never a guessed country code)", () => {
    for (const phone of ["12345", "abc", "", null]) {
      const html = renderToStaticMarkup(<WhatsAppPhoneLink phone={phone} label="WhatsApp" />);
      expect(html).not.toContain("wa.me");
    }
  });

  it("WAI-04 (static): the component never logs and never calls the messaging provider", () => {
    const source = readFileSync(join(process.cwd(), "app/_components/ui/whatsapp-phone-link.tsx"), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/console\.|getMessagingProvider|openwa|lib\/messaging\/provider/i);
  });

  it("WAI-05 (static): the staff profiles list renders it; the API gives phones to Admin/Supervisor only", () => {
    const panel = readFileSync(join(process.cwd(), "app/[locale]/admin/profiles-panel.tsx"), "utf8");
    expect(panel).toContain("<WhatsAppPhoneLink");
    const route = readFileSync(join(process.cwd(), "app/api/admin/profiles/route.ts"), "utf8");
    expect(route).toMatch(/requireApiRoles\(\["ADMIN", "SUPERVISOR"\]\)/);
  });
});
