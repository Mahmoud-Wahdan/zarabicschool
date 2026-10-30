import { monthGrid, parseMonthParam, parseView, shiftMonth } from "../../lib/calendar/month";

describe("calendar month helpers", () => {
  it("CM-01: a month grid starts on a Saturday, ends on a Friday and covers every day of the month", () => {
    const grid = monthGrid("2026-11");
    expect(new Date(`${grid.days[0]}T12:00:00Z`).getUTCDay()).toBe(6);
    expect(new Date(`${grid.days[grid.days.length - 1]}T12:00:00Z`).getUTCDay()).toBe(5);
    expect(grid.days.length % 7).toBe(0);
    expect(grid.days).toContain("2026-11-01");
    expect(grid.days).toContain("2026-11-30");
    expect(grid.first).toBe("2026-11-01");
    expect(grid.last).toBe("2026-11-30");
  });

  it("CM-02: shiftMonth crosses year ends both ways", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-02", 0)).toBe("2026-02");
  });

  it("CM-03: invalid month and view values fall back safely", () => {
    const now = new Date("2026-10-31T22:30:00Z"); // 1 Nov 00:30 in Cairo (UTC+2 after summer time ends)
    expect(parseMonthParam("2026-13", now, "Africa/Cairo")).toBe("2026-11");
    expect(parseMonthParam("<script>", now, "UTC")).toBe("2026-10");
    expect(parseMonthParam("2026-02", now, "UTC")).toBe("2026-02");
    expect(parseView("month")).toBe("month");
    expect(parseView("table")).toBe("table");
    expect(parseView("nope")).toBe("week");
  });
});
