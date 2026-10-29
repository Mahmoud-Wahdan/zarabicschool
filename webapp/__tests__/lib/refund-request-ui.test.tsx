import { readFileSync } from "node:fs";
import { join } from "node:path";

import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";

jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn() }) }));

import RefundRequestButton from "../../app/_components/invoices/refund-request-button";
import RefundRequestsAdmin from "../../app/_components/invoices/refund-requests-admin";
import ar from "../../messages/ar.json";
import en from "../../messages/en.json";

/**
 * S-15 screens (D74): the payer's "Request a refund" on a paid card invoice and its
 * states; the Admin's list of waiting requests with Refund / Reject. Both languages.
 */
const wrap = (locale: "ar" | "en", node: React.ReactNode) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={locale === "ar" ? ar : en} timeZone="Africa/Cairo">
      {node}
    </NextIntlClientProvider>,
  );

const row = {
  id: "11111111-1111-4111-8111-111111111111", status: "PENDING", createdAt: "2026-10-29T08:00:00.000Z", decidedAt: null, rejectionReason: null, invoiceRefundId: null, requestedBy: "Demo Guardian",
  invoice: { id: "22222222-2222-4222-8222-222222222222", amountMinor: "80000", currency: "EGP", sessionsPurchased: 8, paidAt: "2026-10-20T08:00:00.000Z", studentName: "Demo Student" },
};

describe("refund request screens (S-15)", () => {
  it("RRU-01: no request yet → the payer sees 'Request a refund' (en and ar)", () => {
    expect(wrap("en", <RefundRequestButton invoiceId={row.invoice.id} latest={null} />)).toContain("Request a refund");
    expect(wrap("ar", <RefundRequestButton invoiceId={row.invoice.id} latest={null} />)).toContain("طلب استرداد");
  });

  it("RRU-02: a waiting request shows its state and no second button; a rejection shows the reason and lets them ask again", () => {
    const waiting = wrap("en", <RefundRequestButton invoiceId={row.invoice.id} latest={{ status: "PENDING", rejectionReason: null }} />);
    expect(waiting).toContain("Refund request sent");
    expect(waiting).not.toContain("Request a refund</button>");
    const rejected = wrap("en", <RefundRequestButton invoiceId={row.invoice.id} latest={{ status: "REJECTED", rejectionReason: "Sessions already used" }} />);
    expect(rejected).toContain("Sessions already used");
    expect(rejected).toContain("Request a refund");
    expect(wrap("en", <RefundRequestButton invoiceId={row.invoice.id} latest={{ status: "APPROVED", rejectionReason: null }} />)).toContain("Refund approved");
  });

  it("RRU-03: the Admin list shows each waiting request with Refund and Reject; an empty list says so", () => {
    const html = wrap("en", <RefundRequestsAdmin requests={[row]} timeZone="Africa/Cairo" />);
    expect(html).toContain("Demo Student");
    expect(html).toContain("Demo Guardian");
    expect(html).toContain(">Refund sessions<");
    expect(html).toContain(">Reject<");
    expect(wrap("ar", <RefundRequestsAdmin requests={[]} timeZone="Africa/Cairo" />)).toContain("لا توجد طلبات استرداد");
  });

  it("RRU-04 (static): payer pages show the button only on PAID Paymob invoices; the Admin page lists the waiting requests", () => {
    for (const role of ["guardian", "student"]) {
      const page = readFileSync(join(process.cwd(), `app/[locale]/${role}/invoices/page.tsx`), "utf8");
      expect(page).toMatch(/invoice\.status === "PAID" && invoice\.provider === "PAYMOB"[\s\S]{0,80}<RefundRequestButton/);
    }
    const admin = readFileSync(join(process.cwd(), "app/[locale]/admin/invoices/page.tsx"), "utf8");
    expect(admin).toMatch(/listRefundRequests\(user\.academyId, "PENDING"\)/);
    expect(admin).toMatch(/<RefundRequestsAdmin/);
  });
});
