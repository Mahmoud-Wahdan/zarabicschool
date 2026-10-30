import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";

jest.mock("next/navigation", () => ({
  ...jest.requireActual("next/navigation"),
  useRouter: () => ({ refresh: jest.fn(), replace: jest.fn(), push: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => "/ar/admin/schedule",
  useSearchParams: () => new URLSearchParams(),
}));

import BoardGrid, { type BoardGridRow } from "../../app/_components/schedule-board/board-grid";
import ar from "../../messages/ar.json";
import en from "../../messages/en.json";

/**
 * S-16 (D91) grid: sessions sit at their real times (logical inset, so RTL mirrors),
 * a session links to its admin page, a group shows "Group (n)", cancelled/missed are
 * struck through, an over-threshold teacher is highlighted, and no Zoom link exists.
 */
const wrap = (locale: "ar" | "en", node: React.ReactNode) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={locale === "ar" ? ar : en} timeZone="Africa/Cairo">
      {node}
    </NextIntlClientProvider>,
  );

const rows: BoardGridRow[] = [
  {
    teacherId: "t1", teacherName: "Demo Teacher", day: "2026-09-15",
    totals: { sessions: 2, minutes: 420, overThreshold: true },
    sessions: [
      { id: "s1", start: "2026-09-15T06:00:00.000Z", end: "2026-09-15T07:00:00.000Z", status: "SCHEDULED", type: "PRIVATE", studentNames: ["Lina"], studentCount: 1, href: "/admin/sessions/s1" },
      { id: "s2", start: "2026-09-15T08:00:00.000Z", end: "2026-09-15T14:00:00.000Z", status: "SCHEDULED", type: "GROUP", studentNames: ["A", "B", "C"], studentCount: 3, href: "/admin/sessions/s2" },
      { id: "s3", start: "2026-09-15T15:00:00.000Z", end: "2026-09-15T16:00:00.000Z", status: "CANCELLED", type: "PRIVATE", studentNames: ["Omar"], studentCount: 1, href: "/admin/sessions/s3" },
    ],
  },
];

describe("schedule board grid (S-16)", () => {
  it("SBG-01: each session links to its admin page and starts at its local time (09:00 Cairo)", () => {
    const html = wrap("en", <BoardGrid rows={rows} timeZone="Africa/Cairo" locale="en" view="day" thresholdMinutes={360} />);
    expect(html).toContain('href="/en/admin/sessions/s1"');
    expect(html).toContain("09:00–10:00");
    expect(html).toContain("Group (3)");
    expect(html).toContain("inset-inline-start");
    expect(html).not.toMatch(/zoom\.us|zoomJoinUrl/);
  });

  it("SBG-02: cancelled sessions are struck through, an over-threshold teacher is highlighted, in Arabic too", () => {
    const html = wrap("ar", <BoardGrid rows={rows} timeZone="Africa/Cairo" locale="ar" view="day" thresholdMinutes={360} />);
    expect(html).toMatch(/line-through[^"]*"[^>]*title="Omar/);
    expect(html).toContain("bg-error-container");
    expect(html).toContain("مجموعة (3)");
  });

  it("SBG-03: the compact strip under the form has no links and shows the draft outlined", () => {
    const draft: BoardGridRow = { ...rows[0], sessions: [...rows[0].sessions, { id: "draft", start: "2026-09-15T10:00:00.000Z", end: "2026-09-15T11:00:00.000Z", status: "SCHEDULED", type: "PRIVATE", studentNames: ["New"], studentCount: 1, href: "", draft: true }] };
    const html = wrap("en", <BoardGrid rows={[draft]} timeZone="Africa/Cairo" locale="en" view="day" thresholdMinutes={360} compact />);
    expect(html).not.toContain("href=");
    expect(html).toContain("border-dashed border-primary");
  });
});
