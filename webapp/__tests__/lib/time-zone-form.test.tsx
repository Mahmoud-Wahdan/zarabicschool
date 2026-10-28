import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";

jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn() }) }));

import TimeZoneForm from "../../app/[locale]/account/time-zone-form";
import ar from "../../messages/ar.json";
import en from "../../messages/en.json";

/**
 * S-03 account form (Impeccable polish pass): the first paint is the same on the
 * server and the browser — only the stored zone, no clock (both come after mount) —
 * and the note tells the truth about where the zone came from.
 */
const render = (locale: "ar" | "en", source: string) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={locale === "ar" ? ar : en} timeZone="Africa/Cairo">
      <TimeZoneForm current="Africa/Cairo" source={source} />
    </NextIntlClientProvider>,
  );

describe("account time zone form", () => {
  it("TZF-01: first paint has only the stored zone and no clock (hydration-safe)", () => {
    const html = render("en", "DEFAULT");
    expect(html.match(/<option/g)).toHaveLength(1);
    expect(html).toContain('value="Africa/Cairo"');
    expect(html).not.toContain("Your local time now");
  });

  it("TZF-02: the note matches the source, in both languages", () => {
    expect(render("en", "DEFAULT")).toContain("academy default zone");
    expect(render("en", "DEVICE")).toContain("Set from this device");
    expect(render("en", "USER")).toContain("You chose this zone");
    expect(render("en", "ADMIN")).toContain("The academy set this zone");
    expect(render("ar", "DEFAULT")).toContain("المنطقة الافتراضية للأكاديمية");
  });

  it("TZF-03: save starts disabled until another zone is picked", () => {
    expect(render("en", "USER")).toMatch(/<button[^>]*disabled=""[^>]*>Save time zone/);
  });
});
